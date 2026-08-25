"""
KAKSHA -- LLM provider abstraction.

The explanation layer must not care which vendor generates its prose.  Every
guarantee in this system -- the numeric audit, the claim scan, the deterministic
fallback -- operates on the finished TEXT, so it holds identically whichever
model produced it.  This module is therefore the only place that knows a vendor
SDK exists.

WHY AN ABSTRACTION AND NOT A SECOND CODE PATH
---------------------------------------------
The temptation is an `if provider == "gemini"` branch inside the explainer.
That would duplicate the audit wiring and create two places for the rules to
drift apart.  Instead a provider exposes exactly one method -- take a system
prompt and a user prompt, return text -- and the explainer stays vendor-blind.

FAILURE POLICY
--------------
A provider raises on failure.  It never returns a partial string, an apology,
or an empty result dressed up as success.  The caller degrades to the
deterministic template, which is built from the numbers and cannot be wrong in
a way the numbers are not.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from app.core.config import settings

# Anthropic keys are `sk-ant-…`. Google AI Studio has used both `AIza…` and the
# newer `AQ.…` form. Model ids are the more reliable signal, so they are checked
# first and these patterns only break ties.
ANTHROPIC_KEY = re.compile(r"^sk-ant-")
GOOGLE_KEY = re.compile(r"^(AIza|AQ\.)")


class ProviderError(RuntimeError):
    """Raised when a provider cannot produce text."""


class LLMProvider(Protocol):
    """The entire contract. Anything satisfying this can back the explainer."""

    name: str
    model: str

    async def generate(self, system: str, user: str, max_tokens: int) -> str: ...


@dataclass(slots=True)
class AnthropicProvider:
    """Claude via the Anthropic SDK."""

    api_key: str
    model: str
    name: str = "anthropic"

    async def generate(self, system: str, user: str, max_tokens: int) -> str:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=self.api_key)
        message = await client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(
            block.text for block in message.content if block.type == "text"
        ).strip()
        if not text:
            raise ProviderError("Anthropic returned an empty completion")
        return text


@dataclass(slots=True)
class GeminiProvider:
    """
    Gemini via the google-genai SDK.

    Two details differ from Anthropic and are handled here rather than leaking
    into the explainer:

      * Gemini has no dedicated `system` parameter on the request; the system
        prompt goes in `config.system_instruction`.
      * A response can come back with no text at all when generation is stopped
        by a safety filter or the token budget. `response.text` is then None,
        so the finish reason is surfaced as an error instead of being passed on
        as an empty explanation.
    """

    api_key: str
    model: str
    name: str = "gemini"

    async def generate(self, system: str, user: str, max_tokens: int) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)
        response = await client.aio.models.generate_content(
            model=self.model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=max_tokens,
                # Low but non-zero: the task is exposition of fixed numbers, so
                # there is nothing to be gained from sampling diversity, and a
                # deterministic-ish output makes the audit reproducible.
                temperature=0.2,
                # Explicitly disabled. The SDK turns automatic function calling
                # on by default, and this system's central claim is that the
                # explanation layer has no route back into the pipeline. No
                # tools are declared, so this changes nothing today -- it makes
                # it impossible for a later edit to change it by accident.
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )

        text = (response.text or "").strip()
        if not text:
            reason = "unknown"
            candidates = getattr(response, "candidates", None) or []
            if candidates:
                reason = str(getattr(candidates[0], "finish_reason", "unknown"))
            raise ProviderError(
                f"Gemini returned no text (finish_reason={reason}). "
                "This usually means the response hit the token limit or a "
                "safety filter."
            )
        return text


def detect_provider(model: str, api_key: str) -> str:
    """
    Work out which vendor a (model, key) pair belongs to.

    Model id is authoritative because it is unambiguous; the key format is only
    consulted when the model name says nothing useful. Returning "unknown" is a
    valid answer and is reported to the operator rather than guessed at.
    """
    m = (model or "").strip().lower()
    if m.startswith(("claude-", "anthropic.", "us.anthropic.")):
        return "anthropic"
    if m.startswith(("gemini", "models/gemini", "gemma")):
        return "gemini"

    key = (api_key or "").strip()
    if ANTHROPIC_KEY.match(key):
        return "anthropic"
    if GOOGLE_KEY.match(key):
        return "gemini"
    return "unknown"


@dataclass(slots=True)
class ProviderStatus:
    """What the operator needs to see on the VALIDATION page."""

    configured: bool
    provider: str
    model: str
    detail: str

    def as_dict(self) -> dict:
        return {
            "configured": self.configured,
            "provider": self.provider,
            "model": self.model,
            "detail": self.detail,
        }


def resolve_provider() -> tuple[LLMProvider | None, ProviderStatus]:
    """
    Build the configured provider, or explain precisely why there isn't one.

    Never raises. A missing or mismatched key is an expected operating state --
    the explanation panel falls back to the deterministic template -- so this
    reports the reason and lets the caller carry on.
    """
    model = settings.llm_model
    key = settings.llm_api_key

    if not settings.llm_enabled:
        return None, ProviderStatus(
            False, "none", model, "LLM layer disabled by configuration."
        )
    if not key:
        return None, ProviderStatus(
            False,
            "none",
            model,
            "No API key configured. Set KAKSHA_LLM_API_KEY (or the "
            "provider-specific KAKSHA_ANTHROPIC_API_KEY / "
            "KAKSHA_GEMINI_API_KEY) in backend/.env.",
        )

    configured = (settings.llm_provider or "auto").strip().lower()
    provider = configured if configured != "auto" else detect_provider(model, key)

    if provider == "anthropic":
        return AnthropicProvider(api_key=key, model=model), ProviderStatus(
            True, "anthropic", model, "Anthropic SDK."
        )
    if provider == "gemini":
        return GeminiProvider(api_key=key, model=model), ProviderStatus(
            True, "gemini", model, "google-genai SDK."
        )

    # A key is present but neither the model id nor the key format identifies a
    # vendor. Guessing would produce a confusing authentication error at call
    # time; saying so is more useful.
    return None, ProviderStatus(
        False,
        "unknown",
        model,
        f"Could not determine a provider for model '{model}'. Set "
        "KAKSHA_LLM_PROVIDER to 'anthropic' or 'gemini' explicitly, or use a "
        "model id that identifies the vendor (claude-… or gemini-…).",
    )
