"""
TLE / OMM parsing and validation.

The theme of these tests: malformed input must be REJECTED with a specific
reason, never silently accepted and never silently dropped. A parser that
quietly tolerates a corrupt element set is how a system ends up confidently
plotting a satellite that is not there.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.data.tle_processor import (
    ElementSet,
    TleParseError,
    _decimal_point_assumed,
    iter_tle_file,
    parse_omm_record,
    parse_tle,
    parse_tle_text,
    tle_checksum,
)
from tests.conftest import ISS_L1, ISS_L2, VANGUARD_L1, VANGUARD_L2


class TestChecksum:
    def test_checksum_matches_published_lines(self):
        for line in (ISS_L1, ISS_L2, VANGUARD_L1, VANGUARD_L2):
            assert tle_checksum(line) == int(line[68])

    def test_minus_sign_counts_as_one(self):
        # Two lines differing only by a minus sign must differ in checksum by 1.
        base = "1 25544U 98067A   19343.69339541  .00001764  00000-0  38792-4 0  999"
        with_minus = base[:53] + "-" + base[54:]
        assert (tle_checksum(with_minus + "1") - tle_checksum(base + "1")) % 10 in (1, -9)


class TestFieldDecoding:
    @pytest.mark.parametrize(
        "field,expected",
        [
            (" 38792-4", 0.38792e-4),
            ("-11606-4", -0.11606e-4),
            (" 00000-0", 0.0),
            (" 28098-4", 0.28098e-4),
            ("+12345-3", 0.12345e-3),
        ],
    )
    def test_assumed_decimal_point_fields(self, field, expected):
        """
        The B* and mean-motion-second-derivative fields use an implied decimal
        point and a packed exponent. A naive float() on them yields garbage, so
        they get a dedicated decoder.
        """
        assert _decimal_point_assumed(field) == pytest.approx(expected, rel=1e-12)

    def test_bstar_parsed_from_real_tle(self, iss):
        assert iss.bstar == pytest.approx(0.38792e-4, rel=1e-9)


class TestEpochParsing:
    def test_epoch_of_iss_element_set(self, iss):
        assert iss.epoch.year == 2019
        assert iss.epoch.month == 12
        assert iss.epoch.day == 9
        assert iss.epoch.tzinfo is timezone.utc

    def test_two_digit_year_windowing(self):
        """57-99 map to the 1900s, 00-56 to the 2000s. This is the published rule."""
        old = parse_tle(
            "1 00005U 58002B   58179.78495062  .00000023  00000-0  28098-4 0  4750",
            VANGUARD_L2,
            verify_checksum=False,
        )
        assert old.epoch.year == 1958

    def test_day_of_year_out_of_range_rejected(self):
        bad = "1 00005U 58002B   00400.78495062  .00000023  00000-0  28098-4 0  4753"
        with pytest.raises(TleParseError) as exc:
            parse_tle(bad, VANGUARD_L2, verify_checksum=False)
        assert exc.value.reason == "EPOCH_DAY_OUT_OF_RANGE"

    def test_age_days_is_signed_and_correct(self, iss):
        later = iss.epoch.replace(tzinfo=timezone.utc)
        from datetime import timedelta

        assert iss.age_days(later + timedelta(days=3)) == pytest.approx(3.0, abs=1e-9)
        assert iss.age_days(later - timedelta(days=1)) == pytest.approx(-1.0, abs=1e-9)


class TestRejection:
    """Every one of these must raise, with the right reason code."""

    def test_short_line_rejected(self):
        with pytest.raises(TleParseError) as exc:
            parse_tle("1 25544U 98067A", ISS_L2)
        assert exc.value.reason == "SHORT_LINE"

    def test_checksum_mismatch_rejected(self):
        corrupted = ISS_L1[:68] + "0"
        with pytest.raises(TleParseError) as exc:
            parse_tle(corrupted, ISS_L2)
        assert exc.value.reason == "CHECKSUM_MISMATCH"

    def test_catalog_number_mismatch_rejected(self):
        with pytest.raises(TleParseError) as exc:
            parse_tle(ISS_L1, VANGUARD_L2, verify_checksum=False)
        assert exc.value.reason == "CATALOG_NUMBER_MISMATCH"

    def test_bad_line_header_rejected(self):
        with pytest.raises(TleParseError) as exc:
            parse_tle(ISS_L2, ISS_L2, verify_checksum=False)
        assert exc.value.reason == "BAD_LINE_FORMAT"

    def test_impossible_mean_motion_rejected(self):
        """25 rev/day implies a period below the surface of the Earth."""
        bad = ISS_L2[:52] + "25.50103472" + ISS_L2[63:]
        with pytest.raises(TleParseError) as exc:
            parse_tle(ISS_L1, bad, verify_checksum=False)
        assert exc.value.reason == "MEAN_MOTION_OUT_OF_RANGE"

    def test_impossible_eccentricity_rejected(self):
        bad = ISS_L2[:26] + "9900000" + ISS_L2[33:]
        with pytest.raises(TleParseError) as exc:
            parse_tle(ISS_L1, bad, verify_checksum=False)
        assert exc.value.reason == "ECCENTRICITY_OUT_OF_RANGE"

    def test_impossible_inclination_rejected(self):
        bad = ISS_L2[:8] + "195.6439" + ISS_L2[16:]
        with pytest.raises(TleParseError) as exc:
            parse_tle(ISS_L1, bad, verify_checksum=False)
        assert exc.value.reason == "INCLINATION_OUT_OF_RANGE"


class TestBulkParsing:
    def test_three_line_blob(self):
        text = f"ISS (ZARYA)\n{ISS_L1}\n{ISS_L2}\nVANGUARD 1\n{VANGUARD_L1}\n{VANGUARD_L2}\n"
        accepted, rejected = parse_tle_text(text)
        assert len(accepted) == 2
        assert not rejected
        assert {e.name for e in accepted} == {"ISS (ZARYA)", "VANGUARD 1"}

    def test_two_line_blob_without_names(self):
        text = f"{ISS_L1}\n{ISS_L2}\n"
        accepted, rejected = parse_tle_text(text)
        assert len(accepted) == 1
        assert accepted[0].name == "UNNAMED-25544"
        assert not rejected

    def test_blank_lines_and_crlf_tolerated(self):
        text = f"\r\nISS (ZARYA)\r\n{ISS_L1}\r\n{ISS_L2}\r\n\r\n"
        accepted, _ = parse_tle_text(text)
        assert len(accepted) == 1

    def test_corrupt_record_isolated_not_fatal(self):
        """One bad record must not prevent the good ones from being parsed."""
        text = (
            f"GOOD\n{ISS_L1}\n{ISS_L2}\n"
            f"BAD\n1 99999U 00000A   00000.00000000  .00000000  00000-0  00000-0 0  0000\n"
            f"2 99999 999.9999 000.0000 0000000 000.0000 000.0000 99.00000000000000\n"
            f"ALSOGOOD\n{VANGUARD_L1}\n{VANGUARD_L2}\n"
        )
        accepted, rejected = parse_tle_text(text)
        assert len(accepted) == 2
        assert len(rejected) == 1
        assert rejected[0].reason  # carries a specific reason string

    def test_orphaned_line_does_not_mispair(self):
        """A stray line-1 must be skipped, not paired with the wrong line-2."""
        text = f"{ISS_L1}\n{VANGUARD_L1}\n{VANGUARD_L2}\n"
        pairs = list(iter_tle_file(text))
        assert len(pairs) == 1
        assert pairs[0][1] == VANGUARD_L1


class TestDerivedQuantities:
    def test_period_from_mean_motion(self, iss):
        assert iss.period_min == pytest.approx(1440.0 / iss.mean_motion_rev_day)
        assert iss.period_min == pytest.approx(92.897, abs=0.01)

    def test_semi_major_axis_uses_wgs72(self, iss):
        """
        SGP4 is defined against WGS-72. Using WGS-84 here would introduce a
        small inconsistency with the propagator, so the value is checked
        against the WGS-72 result.
        """
        assert iss.semi_major_axis_km == pytest.approx(6794.56, abs=0.05)


class TestOMM:
    def test_omm_record_parses_to_same_shape(self):
        record = {
            "OBJECT_NAME": "TEST-OMM",
            "NORAD_CAT_ID": "25544",
            "OBJECT_ID": "1998-067A",
            "EPOCH": "2026-08-24T12:00:00",
            "MEAN_MOTION": "15.50103472",
            "ECCENTRICITY": "0.0007417",
            "INCLINATION": "51.6439",
            "RA_OF_ASC_NODE": "211.2001",
            "ARG_OF_PERICENTER": "17.6667",
            "MEAN_ANOMALY": "85.6398",
            "BSTAR": "0.000038792",
            "ELEMENT_SET_NO": "999",
            "REV_AT_EPOCH": "20248",
        }
        es = parse_omm_record(record)
        assert isinstance(es, ElementSet)
        assert es.norad_id == 25544
        assert es.epoch == datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc)
        assert es.mean_motion_rev_day == pytest.approx(15.50103472)

    def test_omm_missing_epoch_rejected(self):
        with pytest.raises(TleParseError) as exc:
            parse_omm_record({"NORAD_CAT_ID": "1", "EPOCH": ""})
        assert exc.value.reason == "MALFORMED_EPOCH"

    def test_omm_impossible_element_rejected(self):
        record = {
            "NORAD_CAT_ID": "1",
            "EPOCH": "2026-01-01T00:00:00",
            "MEAN_MOTION": "99",
            "ECCENTRICITY": "0.001",
            "INCLINATION": "50",
        }
        with pytest.raises(TleParseError) as exc:
            parse_omm_record(record)
        assert exc.value.reason == "MEAN_MOTION_OUT_OF_RANGE"
