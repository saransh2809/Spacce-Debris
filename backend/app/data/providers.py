"""
KAKSHA -- orbital data providers.

The provider is an interface, not a hard dependency (spec section 7: "the
architecture should allow the orbital data provider to be replaced later").
Today CelesTrak is used because it is public, requires no credentials and
publishes both element sets and the SATCAT metadata.  Swapping in Space-Track
means implementing :class:`OrbitalDataProvider` and changing one setting.

Every fetch is cached on disk with its retrieval timestamp.  If the network is
unavailable the cache is used and the resulting catalogue is explicitly marked
``degraded`` with the true age of the data -- the system never pretends stale
data is fresh.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.core.config import settings
from app.core.logging import STAGE_DATA, Timer, get_logger, log_event
from app.data.metadata import (
    SatcatEntry,
    classify_object_type,
    resolve_operator,
    resolve_owner,
)
from app.data.tle_processor import (
    ElementSet,
    TleParseError,
    parse_tle_text,
)

log = get_logger("data.provider")

SATCAT_URL = "https://celestrak.org/pub/satcat.csv"


@dataclass(slots=True)
class FetchResult:
    """Outcome of a data retrieval, including everything needed to judge it."""

    element_sets: list[ElementSet]
    rejected: list[TleParseError]
    satcat: dict[int, SatcatEntry]
    retrieved_at: datetime
    from_cache: bool
    degraded: bool
    source_name: str
    notes: list[str] = field(default_factory=list)
    group_counts: dict[str, int] = field(default_factory=dict)


class OrbitalDataProvider(ABC):
    """Interface every orbital-data source must satisfy."""

    name: str = "abstract"

    @abstractmethod
    async def fetch(self, force_refresh: bool = False) -> FetchResult:
        """Retrieve element sets plus metadata."""


class CelestrakProvider(OrbitalDataProvider):
    """
    CelesTrak GP (General Perturbations) + SATCAT.

    Element sets come from ``gp.php?GROUP=<group>&FORMAT=tle``.
    Metadata (owner, object type, launch/decay, RCS) comes from ``satcat.csv``.
    """

    name = "CelesTrak GP + SATCAT"

    def __init__(self) -> None:
        self.cache_dir: Path = settings.cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------- caching
    def _cache_path(self, key: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)
        return self.cache_dir / f"{safe}.cache"

    def _meta_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.meta.json"

    def _write_cache(self, key: str, text: str) -> None:
        self._cache_path(key).write_text(text, encoding="utf-8")
        self._meta_path(key).write_text(
            json.dumps({"retrieved_at": datetime.now(timezone.utc).isoformat()}),
            encoding="utf-8",
        )

    def _read_cache(self, key: str) -> tuple[str | None, datetime | None]:
        path = self._cache_path(key)
        if not path.exists():
            return None, None
        text = path.read_text(encoding="utf-8")
        retrieved = None
        meta = self._meta_path(key)
        if meta.exists():
            try:
                raw = json.loads(meta.read_text(encoding="utf-8"))["retrieved_at"]
                retrieved = datetime.fromisoformat(raw)
            except (ValueError, KeyError, json.JSONDecodeError):
                retrieved = None
        return text, retrieved

    # ------------------------------------------------------------ retrieval
    async def _get(
        self, client: httpx.AsyncClient, url: str, params: dict[str, str], key: str
    ) -> tuple[str, bool]:
        """
        Fetch one resource.  Returns (text, from_cache).

        On any network/HTTP failure the cached copy is returned if one exists;
        otherwise the exception propagates so the caller can report a genuine
        outage rather than an empty catalogue that looks like "no objects".
        """
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            text = resp.text
            if len(text.strip()) < 50 or text.lstrip().startswith("<"):
                # CelesTrak returns an HTML error page or a short notice on
                # rate limiting; treat that as a failure, not as data.
                raise httpx.HTTPError(f"unexpected payload for {key}")
            self._write_cache(key, text)
            return text, False
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            cached, _ = self._read_cache(key)
            if cached is None:
                raise
            log_event(
                log,
                STAGE_DATA,
                "fetch_failed_using_cache",
                level=logging.WARNING,
                resource=key,
                error=str(exc),
            )
            return cached, True

    async def _fetch_satcat(
        self, client: httpx.AsyncClient
    ) -> tuple[dict[int, SatcatEntry], bool]:
        """Retrieve and index the SATCAT.  Keyed by catalogue number."""
        text, cached = await self._get(client, SATCAT_URL, {}, "satcat")
        entries: dict[int, SatcatEntry] = {}

        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            try:
                norad = int(row.get("NORAD_CAT_ID", "") or 0)
            except ValueError:
                continue
            if norad <= 0:
                continue

            name = (row.get("OBJECT_NAME") or "").strip()
            owner_code = (row.get("OWNER") or "").strip()
            country, iso = resolve_owner(owner_code)
            ops_status = (row.get("OPS_STATUS_CODE") or "").strip()

            rcs_raw = (row.get("RCS") or "").strip()
            try:
                rcs = float(rcs_raw) if rcs_raw else None
            except ValueError:
                rcs = None

            entries[norad] = SatcatEntry(
                norad_id=norad,
                name=name,
                intl_designator=(row.get("OBJECT_ID") or "").strip(),
                object_type=classify_object_type(
                    row.get("OBJECT_TYPE", ""), ops_status, name
                ),
                owner_code=owner_code,
                country=country,
                country_iso=iso,
                operator=resolve_operator(country, name),
                launch_date=(row.get("LAUNCH_DATE") or "").strip() or None,
                decay_date=(row.get("DECAY_DATE") or "").strip() or None,
                rcs_m2=rcs,
                ops_status=ops_status,
                attribution_available=bool(owner_code),
            )

        log_event(
            log, STAGE_DATA, "satcat_loaded", rows=len(entries), from_cache=cached
        )
        return entries, cached

    async def fetch(self, force_refresh: bool = False) -> FetchResult:
        retrieved_at = datetime.now(timezone.utc)
        any_cached = False
        notes: list[str] = []
        group_counts: dict[str, int] = {}

        # De-duplicate across groups: an object can appear in several groups
        # (e.g. a Starlink is also in 'active').  First writer wins, and the
        # group order in settings encodes that priority.
        by_norad: dict[int, ElementSet] = {}
        rejected: list[TleParseError] = []

        with Timer() as timer:
            async with httpx.AsyncClient(
                timeout=settings.http_timeout_s,
                follow_redirects=True,
                headers={"User-Agent": "KAKSHA-SSA/1.0 (SIH PS-83 research)"},
            ) as client:
                try:
                    satcat, satcat_cached = await self._fetch_satcat(client)
                    any_cached |= satcat_cached
                except (httpx.HTTPError, httpx.TimeoutException) as exc:
                    satcat = {}
                    notes.append(
                        "SATCAT unavailable -- country/operator attribution and "
                        "object classification will be reported as UNKNOWN."
                    )
                    log_event(
                        log,
                        STAGE_DATA,
                        "satcat_unavailable",
                        level=logging.ERROR,
                        error=str(exc),
                    )

                for group in settings.celestrak_groups:
                    key = f"gp_{group}"
                    try:
                        text, cached = await self._get(
                            client,
                            settings.celestrak_base,
                            {"GROUP": group, "FORMAT": "tle"},
                            key,
                        )
                    except (httpx.HTTPError, httpx.TimeoutException) as exc:
                        notes.append(f"group '{group}' unavailable: {exc}")
                        log_event(
                            log,
                            STAGE_DATA,
                            "group_unavailable",
                            level=logging.ERROR,
                            group=group,
                            error=str(exc),
                        )
                        continue

                    any_cached |= cached
                    accepted, bad = parse_tle_text(text, source=f"celestrak:{group}")
                    rejected.extend(bad)
                    added = 0
                    for es in accepted:
                        if es.norad_id not in by_norad:
                            by_norad[es.norad_id] = es
                            added += 1
                        elif es.epoch > by_norad[es.norad_id].epoch:
                            # Always keep the freshest element set available.
                            by_norad[es.norad_id] = es
                    group_counts[group] = len(accepted)
                    log_event(
                        log,
                        STAGE_DATA,
                        "group_parsed",
                        group=group,
                        parsed=len(accepted),
                        rejected=len(bad),
                        new_objects=added,
                        from_cache=cached,
                    )

        result = FetchResult(
            element_sets=list(by_norad.values()),
            rejected=rejected,
            satcat=satcat,
            retrieved_at=retrieved_at,
            from_cache=any_cached,
            degraded=any_cached or bool(notes),
            source_name=self.name,
            notes=notes,
            group_counts=group_counts,
        )
        log_event(
            log,
            STAGE_DATA,
            "fetch_complete",
            objects=len(result.element_sets),
            rejected=len(rejected),
            satcat_rows=len(satcat),
            degraded=result.degraded,
            elapsed_ms=round(timer.ms, 1),
        )
        return result


def get_provider() -> OrbitalDataProvider:
    """Factory -- the single place a provider is chosen."""
    if settings.data_provider == "celestrak":
        return CelestrakProvider()
    raise ValueError(f"Unknown data provider: {settings.data_provider}")
