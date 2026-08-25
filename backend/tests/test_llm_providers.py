"""
Provider-selection tests.

The explanation layer is vendor-neutral, and the thing most likely to break
that quietly is provider DETECTION: a key that authenticates against the wrong
API fails at call time with a confusing message, and a mis-detected vendor
would strand the explanation panel on the deterministic template while the
dashboard reports a key as configured.

These tests never make a network call. They pin the routing decision only.
"""
from __future__ import annotations

import pytest

from app.core.config import settings
from app.llm.providers import (
    AnthropicProvider,
    GeminiProvider,
    detect_provider,
    resolve_provider,
)


@pytest.fixture
def llm_settings():
    """Save and restore every field that steers provider selection."""
    saved = (
        settings.llm_api_key_generic,
        settings.anthropic_api_key,
        settings.gemini_api_key,
        settings.llm_provider,
        settings.llm_model,
        settings.llm_enabled,
    )
    yield settings
    (
        settings.llm_api_key_generic,
        settings.anthropic_api_key,
        settings.gemini_api_key,
        settings.llm_provider,
        settings.llm_model,
        settings.llm_enabled,
    ) = saved


def _configure(s, *, generic="", anthropic="", gemini="",
               provider="auto", model="", enabled=True):
    s.llm_api_key_generic = generic
    s.anthropic_api_key = anthropic
    s.gemini_api_key = gemini
    s.llm_provider = provider
    s.llm_model = model
    s.llm_enabled = enabled


class TestDetection:
    @pytest.mark.parametrize(
        "model,expected",
        [
            ("claude-opus-5", "anthropic"),
            ("claude-sonnet-5", "anthropic"),
            ("us.anthropic.claude-opus-5", "anthropic"),
            ("gemini-2.5-flash", "gemini"),
            ("gemini-3-pro-preview", "gemini"),
            ("models/gemini-2.5-pro", "gemini"),
        ],
    )
    def test_model_id_is_authoritative(self, model, expected):
        """A model id names its vendor unambiguously; it wins over key format."""
        assert detect_provider(model, "") == expected

    def test_model_id_beats_a_contradicting_key(self):
        """
        If the model says Claude and the key looks like Google's, trust the
        model. Guessing from the key would silently route to the wrong API.
        """
        assert detect_provider("claude-opus-5", "AQ.EXAMPLE") == "anthropic"
        assert detect_provider("gemini-2.5-flash", "sk-ant-EXAMPLE") == "gemini"

    @pytest.mark.parametrize(
        "key,expected",
        [
            ("sk-ant-EXAMPLE-NOT-A-REAL-KEY", "anthropic"),
            ("AIza-EXAMPLE-NOT-A-REAL-KEY", "gemini"),
            ("AQ.EXAMPLE-NOT-A-REAL-KEY", "gemini"),
        ],
    )
    def test_key_format_breaks_ties(self, key, expected):
        assert detect_provider("", key) == expected

    def test_unrecognised_returns_unknown_not_a_guess(self):
        assert detect_provider("", "") == "unknown"
        assert detect_provider("some-model", "some-key") == "unknown"


class TestResolution:
    def test_gemini_key_yields_gemini_provider(self, llm_settings):
        _configure(llm_settings, gemini="AQ.EXAMPLE", model="gemini-2.5-flash")
        provider, status = resolve_provider()
        assert isinstance(provider, GeminiProvider)
        assert status.configured and status.provider == "gemini"
        assert provider.model == "gemini-2.5-flash"

    def test_anthropic_key_yields_anthropic_provider(self, llm_settings):
        _configure(llm_settings, anthropic="sk-ant-EXAMPLE", model="claude-opus-5")
        provider, status = resolve_provider()
        assert isinstance(provider, AnthropicProvider)
        assert status.configured and status.provider == "anthropic"

    def test_generic_key_setting_is_honoured(self, llm_settings):
        _configure(llm_settings, generic="AQ.EXAMPLE", model="gemini-2.5-flash")
        provider, status = resolve_provider()
        assert isinstance(provider, GeminiProvider)
        assert status.configured

    def test_explicit_provider_overrides_detection(self, llm_settings):
        """An operator naming the provider must beat any inference."""
        _configure(
            llm_settings, generic="whatever-key", provider="gemini", model="custom"
        )
        provider, status = resolve_provider()
        assert isinstance(provider, GeminiProvider)
        assert status.provider == "gemini"

    def test_no_key_is_reported_not_guessed(self, llm_settings):
        _configure(llm_settings, model="gemini-2.5-flash")
        provider, status = resolve_provider()
        assert provider is None
        assert not status.configured
        assert "No API key" in status.detail

    def test_disabled_layer_returns_no_provider(self, llm_settings):
        _configure(llm_settings, gemini="AQ.EXAMPLE", model="gemini-2.5-flash",
                   enabled=False)
        provider, status = resolve_provider()
        assert provider is None
        assert not status.configured

    def test_unidentifiable_config_explains_itself(self, llm_settings):
        """
        A key that matches no known vendor must produce an actionable message,
        not an authentication failure forty seconds later.
        """
        _configure(llm_settings, generic="mystery", model="mystery-model")
        provider, status = resolve_provider()
        assert provider is None
        assert status.provider == "unknown"
        assert "KAKSHA_LLM_PROVIDER" in status.detail

    def test_key_whitespace_is_tolerated(self, llm_settings):
        """
        Keys get pasted with stray spaces. A leading space must not turn a
        valid key into an authentication failure -- this happened in practice.
        """
        _configure(llm_settings, gemini="  AQ.EXAMPLE  ", model="gemini-2.5-flash")
        provider, _ = resolve_provider()
        assert provider is not None
        assert provider.api_key == "AQ.EXAMPLE"
