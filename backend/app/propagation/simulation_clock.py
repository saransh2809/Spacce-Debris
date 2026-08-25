"""
KAKSHA -- simulation clock.

One clock drives everything: Earth rotation, Sun direction, the day/night
terminator, SGP4 propagation, conjunction state and every panel in the UI.
If the clock is wrong, everything is wrong together rather than subtly
inconsistent, which is the property we want.

TWO MODES
---------
REAL_TIME    Simulation time == wall-clock UTC.  The scene advances on its own.
SIMULATION   Simulation time == a user-chosen anchor plus elapsed wall time
             multiplied by a rate.  The user can scrub forwards and backwards,
             jump to a TCA, pause, or step.

IMPORTANT DISTINCTION (spec section 29)
---------------------------------------
"Real-time" here means REAL-TIME CALCULATION, not real-time measurement.  The
system propagates publicly published orbital elements; it does not observe
satellites.  Every response therefore carries both the propagation time and the
element epoch, and the UI displays the age of the underlying data.  Claiming
live measurement would be false.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum

from app.core.logging import STAGE_SIM, get_logger, log_event
from app.core.timebase import ensure_utc, gmst_rad_at, now_utc, sun_direction_teme

log = get_logger("propagation.clock")

# Rates offered by the transport control in the UI.
ALLOWED_RATES: tuple[float, ...] = (
    -1000.0, -100.0, -10.0, -1.0, 0.0, 1.0, 10.0, 100.0, 1000.0
)
MAX_ABS_RATE = 10_000.0
# Guard rails on how far the clock may be driven from the present.  SGP4 is a
# short-arc theory; a year of propagation from a TLE is meaningless, and the
# validation engine will flag it, but the clock refuses outright beyond this.
MAX_OFFSET_DAYS = 30.0


class ClockMode(StrEnum):
    REAL_TIME = "REAL_TIME"
    SIMULATION = "SIMULATION"


class ClockError(ValueError):
    """Raised for an unusable clock configuration."""


@dataclass(slots=True)
class ClockState:
    """Serialisable snapshot of the clock, returned with every time query."""

    mode: ClockMode
    simulation_time: datetime
    wall_time: datetime
    rate: float
    paused: bool
    offset_seconds: float
    gmst_rad: float
    sun_direction_teme: tuple[float, float, float]


class SimulationClock:
    """
    The authoritative time source.

    Held as a process-level singleton so that a background screening job and an
    interactive request cannot disagree about what "now" means.
    """

    def __init__(self) -> None:
        self._mode: ClockMode = ClockMode.REAL_TIME
        self._anchor_sim: datetime = now_utc()   # sim time at the last re-anchor
        self._anchor_wall: datetime = now_utc()  # wall time at the last re-anchor
        self._rate: float = 1.0
        self._paused: bool = False

    # ------------------------------------------------------------ internals
    def _reanchor(self, sim_time: datetime | None = None) -> None:
        """Pin the current simulation time and restart the wall-clock offset."""
        self._anchor_sim = ensure_utc(sim_time or self.now())
        self._anchor_wall = now_utc()

    # -------------------------------------------------------------- queries
    def now(self) -> datetime:
        """Current simulation time in UTC."""
        if self._mode is ClockMode.REAL_TIME:
            return now_utc()
        if self._paused or self._rate == 0.0:
            return self._anchor_sim
        elapsed = (now_utc() - self._anchor_wall).total_seconds()
        return self._anchor_sim + timedelta(seconds=elapsed * self._rate)

    def offset_seconds(self) -> float:
        """Signed offset of simulation time from wall-clock UTC."""
        return (self.now() - now_utc()).total_seconds()

    def state(self) -> ClockState:
        sim = self.now()
        sun = sun_direction_teme(sim)
        return ClockState(
            mode=self._mode,
            simulation_time=sim,
            wall_time=now_utc(),
            rate=self._rate,
            paused=self._paused,
            offset_seconds=self.offset_seconds(),
            gmst_rad=gmst_rad_at(sim),
            sun_direction_teme=(float(sun[0]), float(sun[1]), float(sun[2])),
        )

    # -------------------------------------------------------------- mutators
    def set_real_time(self) -> ClockState:
        """Snap back to wall-clock UTC."""
        self._mode = ClockMode.REAL_TIME
        self._rate = 1.0
        self._paused = False
        self._reanchor(now_utc())
        log_event(log, STAGE_SIM, "clock_real_time")
        return self.state()

    def set_simulation_time(self, when: datetime) -> ClockState:
        """
        Jump to an absolute instant and switch to SIMULATION mode.

        Refuses times further than MAX_OFFSET_DAYS from now: SGP4 has no
        predictive value at that range and a plot of it would be theatre.
        """
        when = ensure_utc(when)
        offset_days = abs((when - now_utc()).total_seconds()) / 86400.0
        if offset_days > MAX_OFFSET_DAYS:
            raise ClockError(
                f"Requested time is {offset_days:.1f} days from now; the limit is "
                f"{MAX_OFFSET_DAYS:.0f} days because SGP4 accuracy degrades "
                "beyond a short arc from the element epoch."
            )
        self._mode = ClockMode.SIMULATION
        self._reanchor(when)
        log_event(
            log, STAGE_SIM, "clock_jump", target=when.isoformat(),
            offset_days=round(offset_days, 4)
        )
        return self.state()

    def offset(self, seconds: float) -> ClockState:
        """
        Shift simulation time by a relative amount (the +10m / +1h / +24h
        buttons in the UI).  Negative values step backwards.
        """
        return self.set_simulation_time(self.now() + timedelta(seconds=seconds))

    def set_rate(self, rate: float) -> ClockState:
        """Set the time-acceleration factor.  0 is equivalent to pausing."""
        if abs(rate) > MAX_ABS_RATE:
            raise ClockError(f"Rate {rate} exceeds the limit of {MAX_ABS_RATE}")
        self._reanchor()                       # freeze current sim time first
        self._mode = ClockMode.SIMULATION
        self._rate = float(rate)
        self._paused = rate == 0.0
        log_event(log, STAGE_SIM, "clock_rate", rate=rate)
        return self.state()

    def pause(self) -> ClockState:
        self._reanchor()
        self._mode = ClockMode.SIMULATION
        self._paused = True
        log_event(log, STAGE_SIM, "clock_pause")
        return self.state()

    def play(self) -> ClockState:
        self._reanchor()
        self._mode = ClockMode.SIMULATION
        self._paused = False
        if self._rate == 0.0:
            self._rate = 1.0
        log_event(log, STAGE_SIM, "clock_play", rate=self._rate)
        return self.state()

    def resolve(self, requested: datetime | None) -> datetime:
        """
        Resolve the time an API request should be evaluated at.

        A request that names an explicit instant wins; otherwise the clock
        decides.  This is the single funnel every route uses, so no endpoint
        can accidentally evaluate against a different notion of "now".
        """
        if requested is None:
            return self.now()
        requested = ensure_utc(requested)
        offset_days = abs((requested - now_utc()).total_seconds()) / 86400.0
        if offset_days > MAX_OFFSET_DAYS:
            raise ClockError(
                f"Requested time is {offset_days:.1f} days from now; the limit is "
                f"{MAX_OFFSET_DAYS:.0f} days."
            )
        return requested


_clock: SimulationClock | None = None


def get_clock() -> SimulationClock:
    """Process-wide clock singleton."""
    global _clock
    if _clock is None:
        _clock = SimulationClock()
    return _clock
