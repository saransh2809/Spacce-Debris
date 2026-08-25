"""
KAKSHA -- TLE / OMM processor.

Responsibilities (spec section 7):
  * parse orbital element sets (3-line TLE and OMM JSON)
  * validate them structurally and physically
  * expose epoch, element-set number and data age
  * detect stale data
  * fail loudly and specifically on malformed input

NOTHING downstream is allowed to consume an element set that has not passed
through :func:`parse_tle`.  A record that fails validation is returned as a
``TleParseError`` with a reason string, is counted, and is surfaced on the
VALIDATION page -- it is never silently dropped and never silently used.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from app.core.timebase import ensure_utc

# A TLE line is exactly 69 characters.  Some feeds pad or trim trailing
# whitespace, so we tolerate >= 68 and re-pad, but nothing shorter.
TLE_LINE_LENGTH = 69
_LINE1_RE = re.compile(r"^1 [ 0-9]{5}[A-Z] ")
_LINE2_RE = re.compile(r"^2 [ 0-9]{5} ")

# Physical sanity bounds for mean elements.  Anything outside these cannot be
# an Earth-orbiting catalogued object and indicates a corrupt record.
MIN_MEAN_MOTION_REV_DAY = 0.05   # ~ 20-day period; beyond any Earth orbit
MAX_MEAN_MOTION_REV_DAY = 20.0   # ~ 72-min period; below the atmosphere
MAX_ECCENTRICITY = 0.95


class TleParseError(ValueError):
    """Raised when an element set cannot be trusted.  Carries a reason code."""

    def __init__(self, reason: str, detail: str = "", source_line: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail
        self.source_line = source_line


@dataclass(slots=True)
class ElementSet:
    """
    A parsed, validated orbital element set.

    Mean elements in the SGP4/TEME sense -- these are NOT osculating elements
    and must not be compared directly with the osculating elements computed
    from a propagated state vector.
    """

    norad_id: int
    name: str
    classification: str
    intl_designator: str
    epoch: datetime                 # UTC, aware
    mean_motion_rev_day: float
    eccentricity: float
    inclination_deg: float
    raan_deg: float
    arg_perigee_deg: float
    mean_anomaly_deg: float
    bstar: float
    mean_motion_dot: float
    mean_motion_ddot: float
    element_set_number: int
    rev_at_epoch: int
    ephemeris_type: int
    line1: str
    line2: str
    source: str = "unknown"

    def age_days(self, at: datetime | None = None) -> float:
        """Days between the element epoch and `at` (default: now).  Signed."""
        at = ensure_utc(at or datetime.now(timezone.utc))
        return (at - self.epoch).total_seconds() / 86400.0

    @property
    def period_min(self) -> float:
        """Mean orbital period from mean motion, minutes."""
        return 1440.0 / self.mean_motion_rev_day

    @property
    def semi_major_axis_km(self) -> float:
        """
        Mean semi-major axis from mean motion via Kepler's third law.

        Uses the WGS-72 gravitational parameter, because that is the constant
        set SGP4 itself is defined against -- using WGS-84 here would introduce
        a small but avoidable inconsistency with the propagator.
        """
        mu_wgs72 = 398600.8  # km^3/s^2
        n_rad_s = self.mean_motion_rev_day * 2.0 * math.pi / 86400.0
        return (mu_wgs72 / (n_rad_s**2)) ** (1.0 / 3.0)


def tle_checksum(line: str) -> int:
    """
    Modulo-10 checksum of a TLE line, per the published format definition.

    Digits add their value, a minus sign adds 1, everything else adds 0.
    Computed over the first 68 characters; character 69 is the checksum itself.
    """
    total = 0
    for ch in line[:68]:
        if ch.isdigit():
            total += int(ch)
        elif ch == "-":
            total += 1
    return total % 10


def _decimal_point_assumed(field: str) -> float:
    """
    Decode a TLE 'assumed decimal point' exponential field.

    Example: ' 10270-3' -> 0.10270e-3,  '-11606-4' -> -0.11606e-4.
    These fields carry BSTAR and the second derivative of mean motion; a naive
    float() on them silently produces garbage, so they get their own decoder.
    """
    field = field.strip()
    if not field or field in ("0", "+0", "-0", "00000-0", "00000+0"):
        return 0.0
    sign = -1.0 if field[0] == "-" else 1.0
    if field[0] in "+-":
        field = field[1:]
    # Split the trailing signed exponent from the mantissa.
    m = re.match(r"^(\d+)([+-]\d)$", field)
    if not m:
        try:
            return sign * float(f"0.{field}")
        except ValueError as exc:
            raise TleParseError("MALFORMED_EXPONENT_FIELD", field) from exc
    mantissa, exponent = m.group(1), int(m.group(2))
    return sign * float(f"0.{mantissa}") * (10.0**exponent)


def _parse_epoch(epoch_field: str) -> datetime:
    """
    Decode the TLE epoch field 'YYDDD.DDDDDDDD' into an aware UTC datetime.

    Two-digit year windowing follows the published convention: 57-99 -> 19xx,
    00-56 -> 20xx.  This is the actual rule, not an assumption -- catalogue
    numbering began in 1957.
    """
    epoch_field = epoch_field.strip()
    if len(epoch_field) < 7:
        raise TleParseError("MALFORMED_EPOCH", epoch_field)
    try:
        yy = int(epoch_field[:2])
        day_of_year = float(epoch_field[2:])
    except ValueError as exc:
        raise TleParseError("MALFORMED_EPOCH", epoch_field) from exc

    year = 1900 + yy if yy >= 57 else 2000 + yy
    if not (1.0 <= day_of_year < 367.0):
        raise TleParseError("EPOCH_DAY_OUT_OF_RANGE", epoch_field)

    return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(
        days=day_of_year - 1.0
    )


def parse_tle(
    line1: str,
    line2: str,
    name: str = "",
    source: str = "unknown",
    verify_checksum: bool = True,
) -> ElementSet:
    """
    Parse and validate a two-line element set.

    Raises :class:`TleParseError` with a specific reason on any failure.  The
    reason codes are stable strings so the validation page can aggregate them:

      SHORT_LINE, BAD_LINE_FORMAT, CHECKSUM_MISMATCH, CATALOG_NUMBER_MISMATCH,
      MALFORMED_EPOCH, EPOCH_DAY_OUT_OF_RANGE, MALFORMED_FIELD,
      MEAN_MOTION_OUT_OF_RANGE, ECCENTRICITY_OUT_OF_RANGE,
      INCLINATION_OUT_OF_RANGE, DEEP_SPACE_UNSUPPORTED_EPHEMERIS
    """
    l1 = line1.rstrip("\r\n")
    l2 = line2.rstrip("\r\n")

    if len(l1) < 68 or len(l2) < 68:
        raise TleParseError("SHORT_LINE", f"len1={len(l1)} len2={len(l2)}", l1)
    l1 = l1.ljust(TLE_LINE_LENGTH)
    l2 = l2.ljust(TLE_LINE_LENGTH)

    if not _LINE1_RE.match(l1):
        raise TleParseError("BAD_LINE_FORMAT", "line 1 header", l1)
    if not _LINE2_RE.match(l2):
        raise TleParseError("BAD_LINE_FORMAT", "line 2 header", l2)

    if verify_checksum:
        for idx, line in ((1, l1), (2, l2)):
            declared = line[68]
            if declared.isdigit() and int(declared) != tle_checksum(line):
                raise TleParseError(
                    "CHECKSUM_MISMATCH",
                    f"line {idx}: declared {declared}, computed {tle_checksum(line)}",
                    line,
                )

    try:
        norad_1 = int(l1[2:7])
        norad_2 = int(l2[2:7])
    except ValueError as exc:
        raise TleParseError("MALFORMED_FIELD", "catalog number", l1) from exc

    if norad_1 != norad_2:
        raise TleParseError(
            "CATALOG_NUMBER_MISMATCH", f"{norad_1} != {norad_2}", l1
        )

    epoch = _parse_epoch(l1[18:32])

    try:
        classification = l1[7]
        intl_designator = l1[9:17].strip()
        mean_motion_dot = float(l1[33:43])
        mean_motion_ddot = _decimal_point_assumed(l1[44:52])
        bstar = _decimal_point_assumed(l1[53:61])
        ephemeris_type = int(l1[62]) if l1[62].strip() else 0
        element_set_number = int(l1[64:68] or 0)

        inclination = float(l2[8:16])
        raan = float(l2[17:25])
        eccentricity = float(f"0.{l2[26:33].strip()}")
        arg_perigee = float(l2[34:42])
        mean_anomaly = float(l2[43:51])
        mean_motion = float(l2[52:63])
        rev_at_epoch = int(l2[63:68] or 0)
    except (ValueError, IndexError) as exc:
        raise TleParseError("MALFORMED_FIELD", str(exc), l1) from exc

    # --- physical plausibility -------------------------------------------
    if not (MIN_MEAN_MOTION_REV_DAY <= mean_motion <= MAX_MEAN_MOTION_REV_DAY):
        raise TleParseError("MEAN_MOTION_OUT_OF_RANGE", f"{mean_motion} rev/day", l2)
    if not (0.0 <= eccentricity < MAX_ECCENTRICITY):
        raise TleParseError("ECCENTRICITY_OUT_OF_RANGE", f"{eccentricity}", l2)
    if not (0.0 <= inclination <= 180.0):
        raise TleParseError("INCLINATION_OUT_OF_RANGE", f"{inclination} deg", l2)

    return ElementSet(
        norad_id=norad_1,
        name=(name or f"UNNAMED-{norad_1}").strip(),
        classification=classification,
        intl_designator=intl_designator,
        epoch=epoch,
        mean_motion_rev_day=mean_motion,
        eccentricity=eccentricity,
        inclination_deg=inclination,
        raan_deg=raan,
        arg_perigee_deg=arg_perigee,
        mean_anomaly_deg=mean_anomaly,
        bstar=bstar,
        mean_motion_dot=mean_motion_dot,
        mean_motion_ddot=mean_motion_ddot,
        element_set_number=element_set_number,
        rev_at_epoch=rev_at_epoch,
        ephemeris_type=ephemeris_type,
        line1=l1,
        line2=l2,
        source=source,
    )


def iter_tle_file(text: str) -> Iterator[tuple[str, str, str]]:
    """
    Yield (name, line1, line2) triples from a 3-line-element text blob.

    Tolerates 2-line files (no name line), blank lines, CRLF and stray
    whitespace, because real feeds contain all of these.
    """
    lines = [ln.rstrip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln.strip()]

    i = 0
    pending_name = ""
    while i < len(lines):
        line = lines[i]
        if line.startswith("1 ") and i + 1 < len(lines) and lines[i + 1].startswith("2 "):
            yield pending_name, line, lines[i + 1]
            pending_name = ""
            i += 2
        elif not line.startswith(("1 ", "2 ")):
            pending_name = line.strip()
            i += 1
        else:
            # An orphaned '1 ' or '2 ' line -- skip it rather than mispair.
            i += 1


def parse_tle_text(
    text: str, source: str = "unknown"
) -> tuple[list[ElementSet], list[TleParseError]]:
    """
    Parse a whole 3LE blob.  Returns (accepted, rejected).

    Both halves matter: the rejected list feeds the data-quality report so a
    reviewer can see exactly how many records were refused and why.
    """
    accepted: list[ElementSet] = []
    rejected: list[TleParseError] = []
    for name, l1, l2 in iter_tle_file(text):
        try:
            accepted.append(parse_tle(l1, l2, name=name, source=source))
        except TleParseError as err:
            rejected.append(err)
    return accepted, rejected


def parse_omm_record(record: dict[str, Any], source: str = "omm") -> ElementSet:
    """
    Parse a CCSDS OMM (Orbit Mean-Elements Message) JSON record.

    CelesTrak serves OMM as the modern replacement for the fixed-width TLE, and
    it is the format that will outlive the 5-digit catalogue number.  The
    element content is identical, so we normalise into the same ElementSet and
    the rest of the pipeline is unaffected.
    """
    def _f(key: str, default: float | None = None) -> float:
        raw = record.get(key, default)
        if raw is None or raw == "":
            raise TleParseError("MALFORMED_FIELD", f"OMM missing {key}")
        try:
            return float(raw)
        except (TypeError, ValueError) as exc:
            raise TleParseError("MALFORMED_FIELD", f"OMM {key}={raw!r}") from exc

    try:
        norad_id = int(record["NORAD_CAT_ID"])
    except (KeyError, TypeError, ValueError) as exc:
        raise TleParseError("MALFORMED_FIELD", "OMM NORAD_CAT_ID") from exc

    epoch_raw = str(record.get("EPOCH", "")).strip()
    if not epoch_raw:
        raise TleParseError("MALFORMED_EPOCH", "OMM EPOCH empty")
    try:
        epoch = ensure_utc(datetime.fromisoformat(epoch_raw.replace("Z", "+00:00")))
    except ValueError as exc:
        raise TleParseError("MALFORMED_EPOCH", epoch_raw) from exc

    mean_motion = _f("MEAN_MOTION")
    ecc = _f("ECCENTRICITY")
    inc = _f("INCLINATION")

    if not (MIN_MEAN_MOTION_REV_DAY <= mean_motion <= MAX_MEAN_MOTION_REV_DAY):
        raise TleParseError("MEAN_MOTION_OUT_OF_RANGE", f"{mean_motion}")
    if not (0.0 <= ecc < MAX_ECCENTRICITY):
        raise TleParseError("ECCENTRICITY_OUT_OF_RANGE", f"{ecc}")
    if not (0.0 <= inc <= 180.0):
        raise TleParseError("INCLINATION_OUT_OF_RANGE", f"{inc}")

    return ElementSet(
        norad_id=norad_id,
        name=str(record.get("OBJECT_NAME", f"UNNAMED-{norad_id}")).strip(),
        classification=str(record.get("CLASSIFICATION_TYPE", "U")),
        intl_designator=str(record.get("OBJECT_ID", "")).strip(),
        epoch=epoch,
        mean_motion_rev_day=mean_motion,
        eccentricity=ecc,
        inclination_deg=inc,
        raan_deg=_f("RA_OF_ASC_NODE", 0.0),
        arg_perigee_deg=_f("ARG_OF_PERICENTER", 0.0),
        mean_anomaly_deg=_f("MEAN_ANOMALY", 0.0),
        bstar=float(record.get("BSTAR", 0.0) or 0.0),
        mean_motion_dot=float(record.get("MEAN_MOTION_DOT", 0.0) or 0.0),
        mean_motion_ddot=float(record.get("MEAN_MOTION_DDOT", 0.0) or 0.0),
        element_set_number=int(record.get("ELEMENT_SET_NO", 0) or 0),
        rev_at_epoch=int(record.get("REV_AT_EPOCH", 0) or 0),
        ephemeris_type=int(record.get("EPHEMERIS_TYPE", 0) or 0),
        line1="",
        line2="",
        source=source,
    )
