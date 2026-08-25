"""
Shared fixtures.

Deliberately uses FIXED element sets rather than live data. A test that
downloads the catalogue tests the network, not the mathematics, and would
change its verdict every day as the TLEs update.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.data.metadata import ObjectType, SatcatEntry
from app.data.tle_processor import parse_tle
from app.propagation.sgp4_engine import build_satrec, model_for

# --- Reference element sets -------------------------------------------------

# The official Vallado SGP4 verification case (catalogue 00005).  Its expected
# state vector at tsince=0 is published, which makes it the strongest possible
# check that our propagation matches the reference implementation.
VANGUARD_L1 = "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753"
VANGUARD_L2 = "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"
VANGUARD_EXPECTED_R = (7022.46529266, -1400.08296755, 0.03995155)
VANGUARD_EXPECTED_V = (1.893841015, 6.405893759, 4.534807250)

# ISS, from the published sgp4 package documentation, with a known state at a
# specific Julian date.
ISS_L1 = "1 25544U 98067A   19343.69339541  .00001764  00000-0  38792-4 0  9991"
ISS_L2 = "2 25544  51.6439 211.2001 0007417  17.6667  85.6398 15.50103472202482"
ISS_JD, ISS_FR = 2458827, 0.362605
ISS_EXPECTED_R = (-6102.44, -986.33, -2820.31)

# A near-circular sun-synchronous orbit, used to build synthetic pairs.
SSO_L1 = "1 43111U 18004A   26236.50000000  .00000900  00000-0  40000-4 0  9994"
SSO_L2 = "2 43111  97.9100 250.0000 0001200  90.0000 270.0000 14.79000000000018"


def _meta(norad: int, name: str, obj_type: ObjectType = ObjectType.ACTIVE_SATELLITE):
    return SatcatEntry(
        norad_id=norad,
        name=name,
        intl_designator="TEST",
        object_type=obj_type,
        owner_code="IND",
        country="India",
        country_iso="IN",
        operator="ISRO",
        launch_date="2018-01-12",
        decay_date=None,
        rcs_m2=1.5,
        ops_status="+",
        attribution_available=True,
    )


class FakeCatalogObject:
    """
    Minimal stand-in for CatalogObject.

    The conjunction engine only needs element_set, satrec, meta, norad_id, name,
    object_type and model, so the tests construct exactly that rather than
    standing up the whole catalogue and its network dependency.
    """

    __slots__ = (
        "element_set",
        "meta",
        "satrec",
        "apogee_km",
        "perigee_km",
        "regime",
        "model",
    )

    def __init__(self, element_set, meta):
        from app.core.frames import WGS84_A_KM

        self.element_set = element_set
        self.meta = meta
        self.satrec = build_satrec(element_set)
        sma = element_set.semi_major_axis_km
        self.apogee_km = sma * (1.0 + element_set.eccentricity) - WGS84_A_KM
        self.perigee_km = sma * (1.0 - element_set.eccentricity) - WGS84_A_KM
        self.regime = "LEO"
        self.model = model_for(element_set)

    @property
    def norad_id(self) -> int:
        return self.element_set.norad_id

    @property
    def name(self) -> str:
        return self.element_set.name

    @property
    def object_type(self):
        return self.meta.object_type

    @property
    def country(self) -> str:
        return self.meta.country

    def age_days(self, at=None) -> float:
        return self.element_set.age_days(at)

    def is_stale(self, at=None) -> bool:
        from app.core.config import settings

        return self.age_days(at) > settings.tle_max_age_days

    def search_blob(self) -> str:
        return f"{self.name} {self.norad_id} {self.meta.country}".lower()


@pytest.fixture
def vanguard():
    return parse_tle(VANGUARD_L1, VANGUARD_L2, name="VANGUARD 1")


@pytest.fixture
def iss():
    return parse_tle(ISS_L1, ISS_L2, name="ISS (ZARYA)")


@pytest.fixture
def sso():
    return parse_tle(SSO_L1, SSO_L2, name="TEST-SSO")


@pytest.fixture
def iss_object(iss):
    return FakeCatalogObject(iss, _meta(25544, "ISS (ZARYA)", ObjectType.SPACE_STATION))


@pytest.fixture
def sso_object(sso):
    return FakeCatalogObject(sso, _meta(43111, "TEST-SSO"))


@pytest.fixture
def epoch_2026():
    return datetime(2026, 8, 24, 12, 0, 0, tzinfo=timezone.utc)
