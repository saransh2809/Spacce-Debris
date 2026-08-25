"""
KAKSHA -- the object catalogue.

Holds the fused view of "what is up there": validated element sets joined to
SATCAT metadata, with pre-built SGP4 `Satrec` objects and cached derived
quantities (apogee, perigee, regime) used by the broad-phase screener.

Building a Satrec is not free, and the screener touches every object on every
run, so they are built once at load time and reused.  Derived orbit geometry
comes from the TLE MEAN elements rather than from a propagated state: mean
elements are exactly what the apogee/perigee sieve should use, and it avoids
propagating 12,000 objects just to decide which ones to propagate.
"""
from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable

from sgp4.api import Satrec

from app.core.config import settings
from app.core.frames import WGS84_A_KM
from app.core.logging import STAGE_DATA, Timer, get_logger, log_event
from app.data.metadata import (
    ObjectType,
    OrbitalRegime,
    SatcatEntry,
    classify_regime,
    unknown_entry,
)
from app.data.providers import FetchResult, OrbitalDataProvider, get_provider
from app.data.tle_processor import ElementSet
from app.propagation.sgp4_engine import build_satrec, model_for

log = get_logger("data.catalog")


@dataclass(slots=True)
class CatalogObject:
    """One tracked object: elements + metadata + precomputed orbit geometry."""

    element_set: ElementSet
    meta: SatcatEntry
    satrec: Satrec
    apogee_km: float
    perigee_km: float
    regime: OrbitalRegime
    model: str

    @property
    def norad_id(self) -> int:
        return self.element_set.norad_id

    @property
    def name(self) -> str:
        # Prefer the element-set name: it tracks re-designations faster than
        # SATCAT does.  Fall back to SATCAT, then to a synthetic label.
        return self.element_set.name or self.meta.name or f"OBJECT-{self.norad_id}"

    @property
    def object_type(self) -> ObjectType:
        return self.meta.object_type

    @property
    def country(self) -> str:
        return self.meta.country

    def age_days(self, at: datetime | None = None) -> float:
        return self.element_set.age_days(at)

    def is_stale(self, at: datetime | None = None) -> bool:
        return self.age_days(at) > settings.tle_max_age_days

    def search_blob(self) -> str:
        """Lowercased haystack for the search box."""
        return " ".join(
            (
                self.name,
                str(self.norad_id),
                self.element_set.intl_designator,
                self.meta.country,
                self.meta.operator,
                self.meta.owner_code,
            )
        ).lower()


@dataclass(slots=True)
class CatalogStats:
    """Aggregate counts driving the left rail and the bottom stat strip."""

    total: int = 0
    by_type: dict[str, int] = field(default_factory=dict)
    by_regime: dict[str, int] = field(default_factory=dict)
    by_country: dict[str, int] = field(default_factory=dict)
    by_operator: dict[str, int] = field(default_factory=dict)
    country_iso: dict[str, str] = field(default_factory=dict)
    stale: int = 0
    attribution_missing: int = 0
    rejected_records: int = 0
    rejection_reasons: dict[str, int] = field(default_factory=dict)


class Catalog:
    """In-memory catalogue with a coarse async refresh lock."""

    def __init__(self, provider: OrbitalDataProvider | None = None) -> None:
        self._provider = provider or get_provider()
        self._objects: dict[int, CatalogObject] = {}
        self._order: list[int] = []
        self._stats = CatalogStats()
        self._loaded_at: datetime | None = None
        self._fetch: FetchResult | None = None
        self._lock = asyncio.Lock()
        self._loading = False

    # ------------------------------------------------------------- lifecycle
    async def load(self, force_refresh: bool = False) -> CatalogStats:
        """Fetch, validate, join and index.  Safe to call concurrently."""
        async with self._lock:
            self._loading = True
            try:
                with Timer() as timer:
                    fetch = await self._provider.fetch(force_refresh=force_refresh)
                    self._ingest(fetch)
                log_event(
                    log,
                    STAGE_DATA,
                    "catalog_loaded",
                    objects=len(self._objects),
                    rejected=len(fetch.rejected),
                    degraded=fetch.degraded,
                    elapsed_ms=round(timer.ms, 1),
                )
                return self._stats
            finally:
                self._loading = False

    def _ingest(self, fetch: FetchResult) -> None:
        objects: dict[int, CatalogObject] = {}
        stats = CatalogStats()
        now = datetime.now(timezone.utc)

        for es in fetch.element_sets:
            meta = fetch.satcat.get(es.norad_id)
            if meta is None:
                meta = unknown_entry(es.norad_id, es.name, es.intl_designator)

            # Decayed objects are in SATCAT but are no longer on orbit.  Their
            # element sets are historical; including them would inflate the
            # counts and generate meaningless conjunctions.
            if meta.is_decayed:
                continue

            try:
                satrec = build_satrec(es)
            except (ValueError, RuntimeError) as exc:
                log_event(
                    log,
                    STAGE_DATA,
                    "satrec_build_failed",
                    level=logging.WARNING,
                    norad_id=es.norad_id,
                    error=str(exc),
                )
                continue

            sma = es.semi_major_axis_km
            apogee = sma * (1.0 + es.eccentricity) - WGS84_A_KM
            perigee = sma * (1.0 - es.eccentricity) - WGS84_A_KM
            regime = classify_regime(perigee, apogee, es.eccentricity)

            obj = CatalogObject(
                element_set=es,
                meta=meta,
                satrec=satrec,
                apogee_km=apogee,
                perigee_km=perigee,
                regime=regime,
                model=model_for(es),
            )
            objects[es.norad_id] = obj

            stats.total += 1
            stats.by_type[obj.object_type] = stats.by_type.get(obj.object_type, 0) + 1
            stats.by_regime[regime] = stats.by_regime.get(regime, 0) + 1
            stats.by_country[meta.country] = stats.by_country.get(meta.country, 0) + 1
            key = f"{meta.country}|{meta.operator}"
            stats.by_operator[key] = stats.by_operator.get(key, 0) + 1
            if meta.country_iso:
                stats.country_iso[meta.country] = meta.country_iso
            if obj.age_days(now) > settings.tle_max_age_days:
                stats.stale += 1
            if not meta.attribution_available:
                stats.attribution_missing += 1

        stats.rejected_records = len(fetch.rejected)
        for err in fetch.rejected:
            stats.rejection_reasons[err.reason] = (
                stats.rejection_reasons.get(err.reason, 0) + 1
            )

        self._objects = objects
        # Stable display order: brightest/most-significant first is not
        # meaningful here, so sort by catalogue number for reproducibility.
        self._order = sorted(objects.keys())
        self._stats = stats
        self._loaded_at = datetime.now(timezone.utc)
        self._fetch = fetch

    # --------------------------------------------------------------- access
    @property
    def loaded(self) -> bool:
        return bool(self._objects)

    @property
    def loading(self) -> bool:
        return self._loading

    @property
    def loaded_at(self) -> datetime | None:
        return self._loaded_at

    @property
    def stats(self) -> CatalogStats:
        return self._stats

    @property
    def fetch_result(self) -> FetchResult | None:
        return self._fetch

    @property
    def provider_name(self) -> str:
        return self._provider.name

    def __len__(self) -> int:
        return len(self._objects)

    def get(self, norad_id: int) -> CatalogObject | None:
        return self._objects.get(norad_id)

    def all(self) -> list[CatalogObject]:
        return [self._objects[n] for n in self._order]

    def data_age_seconds(self) -> float | None:
        """Seconds since the underlying feed was retrieved (not since epoch)."""
        if self._fetch is None:
            return None
        return (
            datetime.now(timezone.utc) - self._fetch.retrieved_at
        ).total_seconds()

    def median_element_age_days(self) -> float:
        """Median age of the element sets -- the honest 'how old is this' number."""
        if not self._objects:
            return float("nan")
        now = datetime.now(timezone.utc)
        ages = sorted(o.age_days(now) for o in self._objects.values())
        mid = len(ages) // 2
        if len(ages) % 2:
            return ages[mid]
        return 0.5 * (ages[mid - 1] + ages[mid])

    # -------------------------------------------------------------- queries
    def filter(
        self,
        *,
        object_types: Iterable[str] | None = None,
        countries: Iterable[str] | None = None,
        operators: Iterable[str] | None = None,
        regimes: Iterable[str] | None = None,
        norad_ids: Iterable[int] | None = None,
        max_age_days: float | None = None,
        min_altitude_km: float | None = None,
        max_altitude_km: float | None = None,
        limit: int | None = None,
    ) -> list[CatalogObject]:
        """
        Apply catalogue filters.  Every filter is an inclusive whitelist; a
        `None` filter means "no constraint" rather than "match nothing".
        """
        types = {str(t).upper() for t in object_types} if object_types else None
        countries_set = {c.lower() for c in countries} if countries else None
        operators_set = {o.lower() for o in operators} if operators else None
        regimes_set = {str(r).upper() for r in regimes} if regimes else None
        ids = set(norad_ids) if norad_ids else None
        now = datetime.now(timezone.utc)

        out: list[CatalogObject] = []
        for norad in self._order:
            obj = self._objects[norad]
            if ids is not None and norad not in ids:
                continue
            if types is not None and obj.object_type.upper() not in types:
                continue
            if countries_set is not None and obj.country.lower() not in countries_set:
                continue
            if (
                operators_set is not None
                and obj.meta.operator.lower() not in operators_set
            ):
                continue
            if regimes_set is not None and obj.regime.upper() not in regimes_set:
                continue
            if max_age_days is not None and obj.age_days(now) > max_age_days:
                continue
            mean_alt = 0.5 * (obj.apogee_km + obj.perigee_km)
            if min_altitude_km is not None and mean_alt < min_altitude_km:
                continue
            if max_altitude_km is not None and mean_alt > max_altitude_km:
                continue
            out.append(obj)
            if limit is not None and len(out) >= limit:
                break
        return out

    @staticmethod
    def stratified_sample(
        objects: list[CatalogObject],
        limit: int,
        satellite_share: float = 0.55,
    ) -> list[CatalogObject]:
        """
        Reduce a filtered set to `limit` objects WITHOUT skewing its makeup.

        Plain truncation is badly biased: the catalogue is ordered by NORAD
        number, so taking the first 1,500 of 18,700 objects returns whichever
        classes happen to hold low catalogue numbers.  In practice that meant a
        1,500-object view showed 205 satellites and 1,288 debris fragments --
        the opposite of what a satellite display should emphasise.

        This instead:

        1. Keeps every object from the rare, high-value classes outright --
           space stations, rocket bodies, inactive satellites -- and every
           Indian asset, since they are the focus of this deployment and number
           in the dozens.  These are too few to threaten the budget.
        2. Splits the remaining budget between active satellites and debris by
           `satellite_share`, biased toward satellites because debris otherwise
           dominates by an order of magnitude and buries them.
        3. Samples within each class by a fixed STRIDE rather than randomly, so
           the same subset is returned for the same inputs.  A random sample
           would resample every poll and make the display flicker.

        This is a DISPLAY reduction only.  Screening, conjunction analysis and
        every number in the panels always run against the full catalogue.
        """
        if limit >= len(objects):
            return objects

        always: list[CatalogObject] = []
        satellites: list[CatalogObject] = []
        debris: list[CatalogObject] = []

        for obj in objects:
            t = obj.object_type
            if (
                t in (ObjectType.SPACE_STATION, ObjectType.ROCKET_BODY,
                      ObjectType.INACTIVE_SATELLITE)
                or obj.meta.country_iso == "IN"
            ):
                always.append(obj)
            elif t == ObjectType.ACTIVE_SATELLITE:
                satellites.append(obj)
            else:
                debris.append(obj)

        budget = max(0, limit - len(always))

        # Hand any unused share back to the other class rather than wasting it.
        sat_budget = min(len(satellites), int(budget * satellite_share))
        deb_budget = min(len(debris), budget - sat_budget)
        sat_budget = min(len(satellites), budget - deb_budget)

        def stride_sample(items: list[CatalogObject], keep: int) -> list[CatalogObject]:
            if keep <= 0:
                return []
            if keep >= len(items):
                return items
            step = len(items) / keep
            return [items[int(i * step)] for i in range(keep)]

        out = always + stride_sample(satellites, sat_budget) + stride_sample(debris, deb_budget)
        out.sort(key=lambda o: o.norad_id)
        return out[:limit]

    def search(self, query: str, limit: int = 40) -> list[CatalogObject]:
        """
        Free-text search over name, catalogue number, international designator,
        country and operator.

        Ranking is deliberately simple and predictable: exact catalogue-number
        match, then name prefix, then name substring, then anything else.  A
        user typing "25544" must get the ISS as the first row, every time.
        """
        q = query.strip().lower()
        if not q:
            return []

        exact_id: list[CatalogObject] = []
        prefix: list[CatalogObject] = []
        contains: list[CatalogObject] = []
        other: list[CatalogObject] = []

        for norad in self._order:
            obj = self._objects[norad]
            if str(norad) == q:
                exact_id.append(obj)
                continue
            name_l = obj.name.lower()
            if name_l.startswith(q):
                prefix.append(obj)
            elif q in name_l:
                contains.append(obj)
            elif q in obj.search_blob():
                other.append(obj)

        return (exact_id + prefix + contains + other)[:limit]

    def country_tree(self) -> list[dict]:
        """
        Country -> operator breakdown for the left rail, sorted by object count
        descending so the big actors surface first.
        """
        by_country: dict[str, dict] = {}
        for key, count in self._stats.by_operator.items():
            country, operator = key.split("|", 1)
            node = by_country.setdefault(
                country,
                {
                    "country": country,
                    "iso": self._stats.country_iso.get(country, ""),
                    "count": 0,
                    "operators": [],
                },
            )
            node["count"] += count
            node["operators"].append({"operator": operator, "count": count})

        tree = sorted(by_country.values(), key=lambda n: -n["count"])
        for node in tree:
            node["operators"].sort(key=lambda o: -o["count"])
        return tree


_catalog: Catalog | None = None


def get_catalog() -> Catalog:
    """Process-wide catalogue singleton."""
    global _catalog
    if _catalog is None:
        _catalog = Catalog()
    return _catalog
