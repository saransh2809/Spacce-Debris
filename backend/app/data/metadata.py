"""
KAKSHA -- object metadata resolution.

Country / operator attribution comes exclusively from the CelesTrak SATCAT
(satellite catalogue) OWNER field, which is derived from the public US Space
Force catalogue.  It is NEVER inferred from the object name, and never
invented.  When SATCAT has no entry for a catalogue number the object is
attributed to `UNKNOWN` and the API says so explicitly, so the UI can render
"attribution unavailable" instead of a plausible-looking guess.

The same source supplies object type (payload / rocket body / debris) and
operational status.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class ObjectType(StrEnum):
    """Object class, taken from the SATCAT OBJECT_TYPE column."""

    ACTIVE_SATELLITE = "ACTIVE_SATELLITE"
    INACTIVE_SATELLITE = "INACTIVE_SATELLITE"
    DEBRIS = "DEBRIS"
    ROCKET_BODY = "ROCKET_BODY"
    SPACE_STATION = "SPACE_STATION"
    UNKNOWN = "UNKNOWN"


class OrbitalRegime(StrEnum):
    """Regime classified from the propagated osculating elements."""

    LEO = "LEO"
    MEO = "MEO"
    GEO = "GEO"
    HEO = "HEO"
    UNKNOWN = "UNKNOWN"


# SATCAT OPS_STATUS_CODE values that indicate a functioning payload.
_ACTIVE_STATUS = {"+", "P", "B", "S", "X"}

# SATCAT OWNER code -> (display name, ISO-3166 alpha-2 for the flag glyph).
# Codes are the CelesTrak/SATCAT abbreviations.  An empty ISO code means the
# owner is a multinational organisation with no national flag.
OWNER_TABLE: dict[str, tuple[str, str]] = {
    "IND": ("India", "IN"),
    "US": ("United States", "US"),
    "PRC": ("China", "CN"),
    "CIS": ("Russia", "RU"),
    "SU": ("Russia", "RU"),
    "ESA": ("European Space Agency", "EU"),
    "EUME": ("EUMETSAT", "EU"),
    "EUTE": ("EUTELSAT", "EU"),
    "ESRO": ("European Space Agency", "EU"),
    "FR": ("France", "FR"),
    "UK": ("United Kingdom", "GB"),
    "GER": ("Germany", "DE"),
    "IT": ("Italy", "IT"),
    "JPN": ("Japan", "JP"),
    "SKOR": ("South Korea", "KR"),
    "NKOR": ("North Korea", "KP"),
    "CA": ("Canada", "CA"),
    "BRAZ": ("Brazil", "BR"),
    "AUS": ("Australia", "AU"),
    "SPN": ("Spain", "ES"),
    "NETH": ("Netherlands", "NL"),
    "SWED": ("Sweden", "SE"),
    "NOR": ("Norway", "NO"),
    "DEN": ("Denmark", "DK"),
    "SWTZ": ("Switzerland", "CH"),
    "BEL": ("Belgium", "BE"),
    "LUXE": ("Luxembourg", "LU"),
    "POL": ("Poland", "PL"),
    "CZCH": ("Czechia", "CZ"),
    "TURK": ("Turkey", "TR"),
    "ISRA": ("Israel", "IL"),
    "IRAN": ("Iran", "IR"),
    "SAUD": ("Saudi Arabia", "SA"),
    "UAE": ("United Arab Emirates", "AE"),
    "EGYP": ("Egypt", "EG"),
    "NIG": ("Nigeria", "NG"),
    "RSA": ("South Africa", "ZA"),
    "ARGN": ("Argentina", "AR"),
    "CHLE": ("Chile", "CL"),
    "MEX": ("Mexico", "MX"),
    "INDO": ("Indonesia", "ID"),
    "MALA": ("Malaysia", "MY"),
    "SING": ("Singapore", "SG"),
    "THAI": ("Thailand", "TH"),
    "VTNM": ("Vietnam", "VN"),
    "PAKI": ("Pakistan", "PK"),
    "BGD": ("Bangladesh", "BD"),
    "KAZ": ("Kazakhstan", "KZ"),
    "UKR": ("Ukraine", "UA"),
    "BELA": ("Belarus", "BY"),
    "NZ": ("New Zealand", "NZ"),
    "PORT": ("Portugal", "PT"),
    "GREC": ("Greece", "GR"),
    "FIN": ("Finland", "FI"),
    "AUST": ("Austria", "AT"),
    "HUN": ("Hungary", "HU"),
    "IRAQ": ("Iraq", "IQ"),
    "QAT": ("Qatar", "QA"),
    "PERU": ("Peru", "PE"),
    "COL": ("Colombia", "CO"),
    "VENZ": ("Venezuela", "VE"),
    "ECU": ("Ecuador", "EC"),
    "URY": ("Uruguay", "UY"),
    "BOL": ("Bolivia", "BO"),
    "PHIL": ("Philippines", "PH"),
    "TWN": ("Taiwan", "TW"),
    "LKA": ("Sri Lanka", "LK"),
    "NPL": ("Nepal", "NP"),
    "MNG": ("Mongolia", "MN"),
    "AZER": ("Azerbaijan", "AZ"),
    "TMEN": ("Turkmenistan", "TM"),
    "ALG": ("Algeria", "DZ"),
    "MOR": ("Morocco", "MA"),
    "TUN": ("Tunisia", "TN"),
    "KEN": ("Kenya", "KE"),
    "GHA": ("Ghana", "GH"),
    "ETH": ("Ethiopia", "ET"),
    "ANG": ("Angola", "AO"),
    "SEN": ("Senegal", "SN"),
    "SUDN": ("Sudan", "SD"),
    "ZWE": ("Zimbabwe", "ZW"),
    "RWA": ("Rwanda", "RW"),
    "ISS": ("International (ISS)", ""),
    "ITSO": ("INTELSAT", ""),
    "IM": ("INMARSAT", ""),
    "ISRO": ("India", "IN"),
    "ASRA": ("Austria", "AT"),
    "GLOB": ("Globalstar", ""),
    "ORB": ("ORBCOMM", ""),
    "SES": ("SES", ""),
    "NATO": ("NATO", ""),
    "AB": ("Arab Satellite Comm. Org.", ""),
    "ABS": ("Asia Broadcast Satellite", ""),
    "RASC": ("RASCOM", ""),
    "AC": ("Asiasat", ""),
    "TBD": ("Unallocated", ""),
    "UNK": ("Unknown", ""),
}

# Indian operator refinement.  SATCAT attributes every Indian object to "IND";
# the sub-operator split (ISRO vs commercial IN-SPACe entities) is derived from
# the object name prefix, which is an ISRO naming convention, not a guess about
# ownership.  Country attribution itself always comes from SATCAT.
ISRO_NAME_PREFIXES = (
    "CARTOSAT", "RESOURCESAT", "OCEANSAT", "RISAT", "INSAT", "GSAT",
    "IRNSS", "NAVIC", "ASTROSAT", "CHANDRAYAAN", "MANGALYAAN", "ADITYA",
    "SCATSAT", "HYSIS", "EOS", "MICROSAT", "PSLV", "GSLV", "SARAL",
    "MEGHA", "KALPANA", "EDUSAT", "APPLE", "ROHINI", "BHASKARA", "SROSS",
    "TECHSAR", "XPOSAT", "INS-", "PS4",
)


@dataclass(slots=True)
class SatcatEntry:
    """One row of the CelesTrak SATCAT, normalised."""

    norad_id: int
    name: str
    intl_designator: str
    object_type: ObjectType
    owner_code: str
    country: str
    country_iso: str
    operator: str
    launch_date: str | None
    decay_date: str | None
    rcs_m2: float | None
    ops_status: str
    attribution_available: bool = True

    @property
    def is_decayed(self) -> bool:
        return bool(self.decay_date)


def classify_object_type(
    satcat_type: str, ops_status: str, name: str
) -> ObjectType:
    """
    Map SATCAT OBJECT_TYPE + OPS_STATUS_CODE to a KAKSHA object class.

    SATCAT OBJECT_TYPE is one of PAY (payload), R/B (rocket body),
    DEB (debris), UNK (unknown).  A payload is further split into active vs
    inactive using OPS_STATUS_CODE, because "12,000 satellites" and
    "5,600 *working* satellites" are very different statements.
    """
    t = (satcat_type or "").strip().upper()
    upper_name = (name or "").upper()

    if t == "PAY":
        if any(k in upper_name for k in ("ISS ", "ZARYA", "TIANGONG", "CSS (")):
            return ObjectType.SPACE_STATION
        status = (ops_status or "").strip().upper()
        if status in _ACTIVE_STATUS:
            return ObjectType.ACTIVE_SATELLITE
        return ObjectType.INACTIVE_SATELLITE
    if t in ("R/B", "RB"):
        return ObjectType.ROCKET_BODY
    if t == "DEB":
        return ObjectType.DEBRIS
    return ObjectType.UNKNOWN


def resolve_owner(owner_code: str) -> tuple[str, str]:
    """SATCAT OWNER code -> (country display name, ISO alpha-2)."""
    code = (owner_code or "").strip().upper()
    if not code:
        return "Unknown", ""
    return OWNER_TABLE.get(code, (code, ""))


def resolve_operator(country: str, name: str) -> str:
    """
    Sub-operator label.  Only refines the Indian case, where the distinction
    between ISRO and commercial IN-SPACe operators is useful for the demo and
    is derivable from the published naming convention.  Everything else falls
    back to the country, which is what SATCAT actually asserts.
    """
    if country != "India":
        return country
    upper = (name or "").upper()
    if any(upper.startswith(p) or p in upper for p in ISRO_NAME_PREFIXES):
        return "ISRO"
    return "IN-SPACe / Commercial"


def classify_regime(perigee_km: float, apogee_km: float, ecc: float) -> OrbitalRegime:
    """
    Orbital regime from osculating altitudes.  Boundaries follow common
    space-surveillance usage; they are display categories, not physics, and are
    defined in exactly one place so the catalogue counts always agree.
    """
    if not (perigee_km == perigee_km and apogee_km == apogee_km):  # NaN guard
        return OrbitalRegime.UNKNOWN
    # A large eccentricity means the object spans regimes -- call it HEO.
    if ecc > 0.25:
        return OrbitalRegime.HEO
    mean_alt = 0.5 * (perigee_km + apogee_km)
    if mean_alt < 2000.0:
        return OrbitalRegime.LEO
    if 35286.0 <= mean_alt <= 35986.0:
        return OrbitalRegime.GEO
    if mean_alt < 35286.0:
        return OrbitalRegime.MEO
    return OrbitalRegime.HEO


def unknown_entry(norad_id: int, name: str, intl_designator: str) -> SatcatEntry:
    """
    Placeholder used when the catalogue number is absent from SATCAT.

    `attribution_available=False` is the flag the UI uses to render
    "Attribution unavailable" rather than showing a fabricated country.
    """
    return SatcatEntry(
        norad_id=norad_id,
        name=name,
        intl_designator=intl_designator,
        object_type=ObjectType.UNKNOWN,
        owner_code="",
        country="Unknown",
        country_iso="",
        operator="Unknown",
        launch_date=None,
        decay_date=None,
        rcs_m2=None,
        ops_status="",
        attribution_available=False,
    )
