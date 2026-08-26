"""
KAKSHA -- screening cache and background refresh.

A full 48-hour screen of the live catalogue is a real computation, not a
lookup.  Re-running it on every UI interaction would be both slow and wasteful,
so results are cached -- but caching numerical results carries an obvious risk:
serving a stale answer as if it were current.

The rules here exist to make that impossible:

  * A cache entry is keyed by everything that can change the answer: the
    primary set, the window, the threshold, AND the catalogue generation.
  * Refreshing the catalogue bumps the generation counter, which invalidates
    every entry derived from the old element sets.
  * Every served result carries `computed_at` and the age of the data it was
    built from, so the UI can display how old the answer is instead of implying
    it is live.

This is caching for speed, never for the appearance of freshness.
"""
from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.logging import STAGE_CONJUNCTION, get_logger, log_event
from app.conjunction.encounter import ScreeningRun, run_screening
from app.data.catalog import CatalogObject, get_catalog

log = get_logger("services.screening")

# How long a screening run stays usable before it is recomputed.  Chosen to be
# short relative to how fast the geometry changes: over 10 minutes a LEO object
# moves about 4,500 km along-track, but the CONJUNCTION set (which pairs come
# within 25 km over the next 24-48 h) is far more stable than that.
CACHE_TTL_SECONDS = 600.0
MAX_CACHE_ENTRIES = 12


@dataclass(slots=True)
class CacheEntry:
    key: str
    run: ScreeningRun
    created_at: datetime
    catalog_generation: int
    label: str

    def age_seconds(self) -> float:
        return (datetime.now(timezone.utc) - self.created_at).total_seconds()

    def is_fresh(self, generation: int) -> bool:
        return (
            self.catalog_generation == generation
            and self.age_seconds() < CACHE_TTL_SECONDS
        )


class ScreeningService:
    """Owns every screening run in the process."""

    def __init__(self) -> None:
        self._entries: dict[str, CacheEntry] = {}
        self._generation = 0
        self._lock = asyncio.Lock()
        self._in_flight: dict[str, asyncio.Task] = {}

    # ------------------------------------------------------------ generation
    def invalidate(self) -> None:
        """Called whenever the catalogue is reloaded."""
        self._generation += 1
        self._entries.clear()
        log_event(
            log, STAGE_CONJUNCTION, "cache_invalidated", generation=self._generation
        )

    @property
    def generation(self) -> int:
        return self._generation

    # ----------------------------------------------------------------- keys
    @staticmethod
    def make_key(
        primary_ids: list[int],
        window_hours: float,
        threshold_km: float,
        anchor: datetime,
    ) -> str:
        """
        Cache key.

        The anchor time is quantised to the TTL, so requests made a few seconds
        apart share an entry while a genuinely later request gets a fresh one.
        """
        bucket = int(anchor.timestamp() // CACHE_TTL_SECONDS)
        raw = (
            f"{sorted(primary_ids)}|{window_hours}|{threshold_km}|{bucket}"
            if len(primary_ids) < 200
            else f"set{len(primary_ids)}:{hashlib.sha1(str(sorted(primary_ids)).encode()).hexdigest()[:12]}"
            f"|{window_hours}|{threshold_km}|{bucket}"
        )
        return hashlib.sha1(raw.encode()).hexdigest()[:20]

    # -------------------------------------------------------------- running
    async def get_or_run(
        self,
        primaries: list[CatalogObject],
        secondaries: list[CatalogObject],
        start: datetime,
        window_hours: float,
        threshold_km: float,
        label: str = "screen",
    ) -> tuple[ScreeningRun, bool]:
        """
        Return a screening run, computing it only if no fresh entry exists.

        Returns (run, from_cache).  The heavy computation is executed in a
        worker thread so the event loop -- and therefore the rest of the API --
        stays responsive while a screen is in progress.  Concurrent requests
        for the same key await the same task instead of each starting their own
        14-second computation.
        """
        key = self.make_key(
            [o.norad_id for o in primaries], window_hours, threshold_km, start
        )

        entry = self._entries.get(key)
        if entry is not None and entry.is_fresh(self._generation):
            return entry.run, True

        # A miss here costs ~40 s of CPU, so record WHY it missed. Without this
        # a cache that silently never hits is indistinguishable from one that
        # works, and the only symptom is a slow dashboard.
        log_event(
            log,
            STAGE_CONJUNCTION,
            "cache_miss",
            key=key,
            reason=(
                "absent"
                if entry is None
                else f"stale age={entry.age_seconds():.0f}s"
                if entry.age_seconds() >= CACHE_TTL_SECONDS
                else f"generation {entry.catalog_generation} != {self._generation}"
            ),
            primaries=len(primaries),
            anchor=start.isoformat(),
            entries_held=len(self._entries),
        )

        async with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.is_fresh(self._generation):
                return entry.run, True

            task = self._in_flight.get(key)
            if task is None:
                task = asyncio.create_task(
                    asyncio.to_thread(
                        run_screening,
                        primaries,
                        secondaries,
                        start,
                        window_hours,
                        threshold_km,
                    )
                )
                self._in_flight[key] = task

        try:
            run = await task
        finally:
            self._in_flight.pop(key, None)

        self._store(key, run, label)
        return run, False

    def _store(self, key: str, run: ScreeningRun, label: str) -> None:
        self._entries[key] = CacheEntry(
            key=key,
            run=run,
            created_at=datetime.now(timezone.utc),
            catalog_generation=self._generation,
            label=label,
        )
        # Evict oldest entries beyond the cap.
        while len(self._entries) > MAX_CACHE_ENTRIES:
            oldest = min(self._entries.values(), key=lambda e: e.created_at)
            self._entries.pop(oldest.key, None)

    # ------------------------------------------------------------- defaults
    async def default_run(self, start: datetime) -> tuple[ScreeningRun, bool]:
        """
        The dashboard's standing screen.

        Primaries default to India's operational assets -- the natural focus for
        this problem statement, and the case the FOCUS INDIA control highlights.
        Secondaries are the whole catalogue.
        """
        catalog = get_catalog()
        primaries = catalog.filter(countries=["India"])
        if not primaries:
            # Fall back to space stations plus a slice of active satellites so
            # the dashboard is never empty just because attribution failed.
            primaries = catalog.filter(
                object_types=["SPACE_STATION", "ACTIVE_SATELLITE"], limit=120
            )
        secondaries = catalog.filter(limit=settings.max_screen_objects)
        return await self.get_or_run(
            primaries,
            secondaries,
            start,
            settings.default_screen_hours,
            settings.screening_threshold_km,
            label="dashboard-default",
        )

    def cache_report(self) -> list[dict]:
        """Cache contents, for the debug panel."""
        return [
            {
                "key": e.key,
                "label": e.label,
                "created_at": e.created_at.isoformat(),
                "age_seconds": round(e.age_seconds(), 1),
                "generation": e.catalog_generation,
                "current_generation": self._generation,
                "fresh": e.is_fresh(self._generation),
                "events": len(e.run.events),
                "elapsed_ms": round(e.run.elapsed_ms, 1),
            }
            for e in sorted(
                self._entries.values(), key=lambda x: x.created_at, reverse=True
            )
        ]


_service: ScreeningService | None = None


def get_screening_service() -> ScreeningService:
    global _service
    if _service is None:
        _service = ScreeningService()
    return _service
