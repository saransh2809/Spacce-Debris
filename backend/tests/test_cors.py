"""
CORS origin tests.

A CORS misconfiguration does not fail loudly. The API keeps answering, the
server log shows a 400 on an OPTIONS request, and the browser reports an
opaque network error -- so the whole application looks broken for a reason
that has nothing to do with the application.

This happened in practice: Vite fell back to port 5174 because 5173 was
already taken, and every request from the dashboard was refused. These tests
pin the two families of origin that cannot be enumerated in a static list, and
pin the rejections that matter.
"""
from __future__ import annotations

import re

import pytest

from app.core.config import settings


@pytest.fixture(scope="module")
def origin_regex() -> re.Pattern[str]:
    return re.compile(settings.cors_origin_regex)


def matches(rx: re.Pattern[str], origin: str) -> bool:
    """Starlette tests an origin against the regex with fullmatch semantics."""
    return bool(rx.fullmatch(origin))


class TestAllowedOrigins:
    @pytest.mark.parametrize(
        "origin",
        [
            "http://localhost:5173",   # the documented default
            "http://localhost:5174",   # Vite's fallback when 5173 is taken
            "http://localhost:5175",
            "http://localhost:4173",   # vite preview
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
        ],
    )
    def test_any_local_dev_port_is_allowed(self, origin_regex, origin):
        """
        The dev server's port is not under our control. Pinning one port turns
        a routine port clash into an application that silently cannot talk to
        its own backend.
        """
        assert matches(origin_regex, origin), origin

    @pytest.mark.parametrize(
        "origin",
        [
            "https://kaksha.vercel.app",
            "https://kaksha-git-main-saransh.vercel.app",
            "https://kaksha-abc123def.vercel.app",
        ],
    )
    def test_vercel_preview_hostnames_are_allowed(self, origin_regex, origin):
        """Every Vercel deployment gets its own hostname; they cannot be listed."""
        assert matches(origin_regex, origin), origin


class TestRejectedOrigins:
    @pytest.mark.parametrize(
        "origin",
        [
            "https://evil.example.com",
            "http://evil.com",
            # Suffix and prefix attacks on the hostname: these must not slip
            # through a loosely anchored pattern.
            "https://localhost.evil.com",
            "http://127.0.0.1.evil.com",
            "https://notvercel.app",
            "https://vercel.app.evil.com",
            "http://localhost:5173.evil.com",
        ],
    )
    def test_unrelated_origins_are_refused(self, origin_regex, origin):
        assert not matches(origin_regex, origin), origin


class TestStaticAllowlist:
    def test_documented_default_ports_present(self):
        """
        The explicit list is what a reader checks first, so it must still name
        the canonical dev origins even though the regex would cover them.
        """
        assert "http://localhost:5173" in settings.cors_origins
        assert "http://127.0.0.1:5173" in settings.cors_origins

    def test_comma_separated_env_value_is_accepted(self):
        """
        Hosting dashboards make people type plain comma-separated values, and
        pydantic-settings would otherwise try to JSON-parse them and raise.
        """
        from app.core.config import Settings

        parsed = Settings._split_origins("https://a.com, https://b.com")
        assert parsed == ["https://a.com", "https://b.com"]
