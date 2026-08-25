"""
KAKSHA -- LLM output guardrails.

The architectural rule is that the LLM explains numbers it is given and never
produces numbers of its own.  Stating that rule in a system prompt is necessary
but not sufficient: a prompt is a request, not a guarantee.  This module turns
it into a mechanical check.

THE NUMERIC AUDIT
-----------------
After generation, every number in the model's output is extracted and matched
against the set of values that were actually supplied to it.  A number that
cannot be traced to an input is an INVENTED VALUE, and the response is marked
as failing audit.

Matching allows for legitimate presentation changes:
  * rounding to fewer significant figures (3.376521 -> 3.38, 3.4)
  * unit conversion between km and m, km/s and m/s, hours and minutes
  * ordinals and small counting numbers ("the two objects", "#1")
  * the year/month/day/hour/minute components of supplied timestamps

Anything else is flagged.  The audit result travels to the client, so the UI
can show that the explanation was checked rather than merely trusted.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

# Numbers up to this value are treated as ordinary prose counting words and are
# not audited ("the two objects", "all 12 checks", "rank 3").
SMALL_INTEGER_ALLOWANCE = 100

# Exact-match tolerance.  Deliberately tight: a broad relative window combined
# with unit expansion creates FALSE MATCHES, where an invented number happens to
# land near some scaled version of a real one.  Legitimate rounding is handled
# explicitly below instead, which is both stricter and more accurate.
MATCH_RTOL = 1e-9
MATCH_ATOL = 1e-12
# Significant-figure roundings a model may reasonably use when quoting a value.
SIGNIFICANT_FIGURES = (1, 2, 3, 4, 5, 6)

_NUMBER_RE = re.compile(
    r"[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?"
)


@dataclass(slots=True)
class AuditResult:
    """Outcome of checking one generated explanation."""

    passed: bool
    numbers_found: int
    numbers_verified: int
    unverified: list[float] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "passed": self.passed,
            "numbers_found": self.numbers_found,
            "numbers_verified": self.numbers_verified,
            "unverified_values": self.unverified,
            "notes": self.notes,
            "method": (
                "Every numeral in the generated text is matched against the values "
                "supplied to the model, allowing for rounding and unit conversion. "
                "Unmatched numerals are reported as unverified."
            ),
        }


def collect_numbers(payload: Any, into: set[float] | None = None) -> set[float]:
    """Recursively gather every finite number appearing in a payload."""
    acc = into if into is not None else set()

    if isinstance(payload, bool):
        return acc
    if isinstance(payload, (int, float)):
        f = float(payload)
        if math.isfinite(f):
            acc.add(f)
        return acc
    if isinstance(payload, str):
        # Timestamps and numeric strings still count as supplied values.  Both
        # signs are added because an ISO date like "2026-08-25" tokenises the
        # separators as minus signs, and the model quoting "25" is quoting the
        # day of month, not inventing a negative number.
        for match in _NUMBER_RE.finditer(payload):
            try:
                value = float(match.group().replace(",", ""))
            except ValueError:
                continue
            acc.add(value)
            acc.add(abs(value))
        return acc
    if isinstance(payload, dict):
        for key, value in payload.items():
            collect_numbers(key, acc)
            collect_numbers(value, acc)
        return acc
    if isinstance(payload, (list, tuple, set)):
        for item in payload:
            collect_numbers(item, acc)
        return acc
    return acc


def _expand_units(values: Iterable[float]) -> set[float]:
    """
    Add the unit-converted forms of every supplied value.

    A model told "3.3765 km" may legitimately write "3,376 metres". That is a
    presentation change, not a new number, so both forms are acceptable.
    """
    expanded: set[float] = set()
    for v in values:
        if not math.isfinite(v):
            continue
        expanded.add(v)
        expanded.add(abs(v))
        for factor in (1000.0, 0.001, 60.0, 1.0 / 60.0, 3600.0, 1.0 / 3600.0, 100.0):
            scaled = v * factor
            if math.isfinite(scaled) and abs(scaled) < 1e15:
                expanded.add(abs(scaled))
    return expanded


def _round_sig(value: float, figures: int) -> float:
    """Round to a number of significant figures."""
    if value == 0.0 or not math.isfinite(value):
        return value
    return round(value, -int(math.floor(math.log10(abs(value)))) + (figures - 1))


def _matches(candidate: float, allowed: set[float], decimals: int) -> bool:
    """
    Whether `candidate` is a legitimate presentation of some supplied value.

    Accepted transformations are exactly the ones that do not change meaning:
      * the value itself,
      * the value rounded to the number of decimals the model actually wrote,
      * the value rounded to any reasonable number of significant figures.

    Anything else is an invented number.  Note this is checked against the
    unit-expanded set, so "3376 metres" for 3.376 km still matches.
    """
    c = abs(candidate)
    if c == 0.0:
        return True
    for a in allowed:
        if a == 0.0:
            continue
        if math.isclose(c, a, rel_tol=MATCH_RTOL, abs_tol=MATCH_ATOL):
            return True
        if round(a, decimals) == round(c, decimals):
            return True
        for figures in SIGNIFICANT_FIGURES:
            if math.isclose(_round_sig(a, figures), c, rel_tol=1e-9, abs_tol=1e-12):
                return True
    return False


def audit_numbers(text: str, supplied: dict[str, Any]) -> AuditResult:
    """
    Verify that every number in `text` traces back to `supplied`.

    This is the mechanical enforcement of "the LLM may not invent values".
    """
    allowed = _expand_units(collect_numbers(supplied))

    found: list[tuple[float, str]] = []
    for match in _NUMBER_RE.finditer(text):
        raw = match.group().replace(",", "")
        try:
            found.append((float(raw), raw))
        except ValueError:
            continue

    unverified: list[float] = []
    verified = 0
    for value, raw in found:
        if abs(value) <= SMALL_INTEGER_ALLOWANCE and float(value).is_integer():
            verified += 1
            continue
        decimals = len(raw.split(".")[1]) if "." in raw else 0
        if _matches(value, allowed, decimals):
            verified += 1
        else:
            unverified.append(value)

    notes: list[str] = []
    if unverified:
        notes.append(
            f"{len(unverified)} numeral(s) in the explanation could not be traced to "
            "the supplied numerical result. The explanation is shown with this "
            "warning attached; the underlying values in the panels are unaffected."
        )

    return AuditResult(
        passed=not unverified,
        numbers_found=len(found),
        numbers_verified=verified,
        unverified=sorted(set(unverified)),
        notes=notes,
    )


FORBIDDEN_CLAIM_PATTERNS = [
    (
        re.compile(r"probability of collision", re.I),
        "claims an operational probability of collision",
    ),
    (
        re.compile(r"\bwill (?:collide|hit|strike|impact)\b", re.I),
        "asserts a collision as certain",
    ),
    (
        re.compile(r"\b(?:certain|guaranteed|definitely) (?:to )?(?:collide|impact)", re.I),
        "asserts certainty about a collision",
    ),
    (
        re.compile(r"\bI (?:calculated|computed|derived|determined)\b", re.I),
        "claims to have performed the calculation itself",
    ),
]


# Words that, appearing shortly before a flagged phrase, invert its meaning.
# "This is NOT an operational probability of collision" is exactly the sentence
# the system is supposed to print, so flagging it would be backwards.
_NEGATION_RE = re.compile(
    r"\b(?:not|never|cannot|isn't|is not|rather than|no)\b[^.;]{0,60}$", re.I
)
# How far back to look for a negation before a flagged phrase.
_NEGATION_LOOKBACK = 80


def _is_negated(text: str, start: int) -> bool:
    """Whether the phrase beginning at `start` sits inside a negation."""
    window = text[max(0, start - _NEGATION_LOOKBACK) : start]
    return bool(_NEGATION_RE.search(window))


def check_claims(text: str, is_operational_pc: bool) -> list[str]:
    """
    Detect language that overstates what the pipeline can support.

    "Probability of collision" is only permitted when a published covariance
    was actually used -- which, for public GP data, it never is.  A DENIAL of
    such a claim is not a violation, so each match is checked for a preceding
    negation before being reported.
    """
    violations: list[str] = []
    for pattern, description in FORBIDDEN_CLAIM_PATTERNS:
        match = None
        for candidate in pattern.finditer(text):
            if not _is_negated(text, candidate.start()):
                match = candidate
                break
        if match is None:
            continue
        if description.startswith("claims an operational probability") and is_operational_pc:
            continue
        violations.append(description)
    return violations
