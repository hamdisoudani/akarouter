"""AKAROUTER LiteLLM adapter — Phase 1 spike.

Wraps `litellm.acompletion` so chat.py can call providers through LiteLLM
without losing the existing AkaRouter routing, billing, and audit semantics.

Design rules (DO NOT BREAK):
1. This module NEVER calls AkaRouter billing/points logic. Caller owns that.
2. Returns the raw litellm ModelResponse object on success (or async iterator
   of chunks for streaming) plus a uniform dict with cost_usd on completion.
3. Failures bubble up as `LiteLLMCallError` with a sanitized `category` string
   (re-uses chat.sanitize_error_msg logic).
4. `drop_params=True` so unsupported params per provider don't crash the call.
5. `num_retries=2` so transient 429/5xx auto-retry (was hand-rolled in chat.py).
6. Supports custom `api_base` for per-request endpoints (AkaRouter's
   per_request pricing mode routes through user-defined endpoints).

Returns a uniform tuple:
    (raw_response_or_iter, CallMetadata)

Where CallMetadata has:
    cost_usd        — Decimal, USD cost from LiteLLM cost calculator
    prompt_tokens   — int
    completion_tokens — int
    total_tokens    — int
    model           — str, the model string actually used
    provider        — str, the resolved provider name (e.g. "openai", "custom")
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, AsyncIterator, Optional, Tuple, Union

import litellm
from litellm import acompletion

logger = logging.getLogger(__name__)

# Tell LiteLLM to silently drop params a provider doesn't accept (e.g.
# temperature=0 for some Anthropic models). Without this, a chat.py that
# forwards the full OpenAI-shaped body will 400 on every non-OpenAI call.
litellm.drop_params = True

# Suppress LiteLLM's noisy INFO logs by default. Debug-level only when LITELLM_DEBUG=1.
litellm.set_verbose = False


@dataclass
class CallMetadata:
    cost_usd: Decimal = Decimal("0")
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model: str = ""
    provider: str = ""
    latency_ms: int = 0
    extra: dict = field(default_factory=dict)


class LiteLLMCallError(Exception):
    """Raised when LiteLLM upstream fails. `category` matches chat.sanitize_error_msg."""

    def __init__(self, category: str, message: str, status_code: int = 502):
        super().__init__(f"{category}: {message}")
        self.category = category
        self.message = message
        self.status_code = status_code


def _sanitize_category(exc: Exception) -> Tuple[str, int]:
    """Map a LiteLLM/httpx exception to the same opaque categories chat.py uses."""
    msg = str(exc).lower()
    if "rate limit" in msg or "429" in msg or "too many requests" in msg:
        return "rate_limited", 429
    if "unauthorized" in msg or "401" in msg or "invalid api key" in msg:
        return "auth_failed", 401
    if "forbidden" in msg or "403" in msg:
        return "forbidden", 403
    if "billing" in msg or "quota" in msg or "insufficient" in msg or "402" in msg:
        return "billing", 402
    if "timeout" in msg or "timed out" in msg or "504" in msg or "deadline" in msg:
        return "timeout", 504
    if "connect" in msg and ("refused" in msg or "reset" in msg or "error" in msg):
        return "connection_failed", 502
    if any(code in msg for code in ("500", "502", "503", "internal server", "bad gateway", "service unavailable")):
        return "upstream_unavailable", 502
    if "invalid request" in msg or "400" in msg or "validation" in msg or "bad request" in msg:
        return "invalid_request", 400
    if "model" in msg and ("not found" in msg or "unknown" in msg or "unsupported" in msg):
        return "model_unavailable", 404
    return "upstream_error", 502


def _extract_cost_usd(response: Any) -> Decimal:
    """Pull USD cost out of a LiteLLM ModelResponse (non-streaming).

    LiteLLM puts it in `_hidden_params["response_cost"]` after each call.
    Falls back to cost_calculator.completion_cost() if not present.
    """
    try:
        hidden = getattr(response, "_hidden_params", {}) or {}
        cost = hidden.get("response_cost")
        if cost is not None:
            return Decimal(str(cost))
    except Exception:
        pass
    # Fallback: ask LiteLLM to compute it from the model + usage.
    try:
        cost = litellm.completion_cost(completion_response=response)
        if cost is not None:
            return Decimal(str(cost))
    except Exception:
        pass
    return Decimal("0")


async def call(
    *,
    model: str,
    messages: list,
    api_key: str,
    api_base: Optional[str] = None,
    stream: bool = False,
    timeout: int = 60,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    max_tokens: Optional[int] = None,
    stop: Optional[Union[str, list]] = None,
    presence_penalty: Optional[float] = None,
    frequency_penalty: Optional[float] = None,
    n: Optional[int] = None,
    user: Optional[str] = None,
    extra_body: Optional[dict] = None,
    stream_options: Optional[dict] = None,
) -> Tuple[Any, CallMetadata]:
    """Single non-streaming or streaming LiteLLM call.

    Returns:
        (response, metadata)
        - non-streaming: response is ModelResponse, metadata.cost_usd populated
        - streaming: response is async iterator of chunks, metadata has 0 cost
          (final cost known only at end; caller should accumulate from chunks)

    Raises:
        LiteLLMCallError with .category and .status_code on any failure.
    """
    started = time.time()
    md = CallMetadata(model=model)

    kwargs: dict = {
        "model": model,
        "messages": messages,
        "api_key": api_key,
        "timeout": timeout,
        "num_retries": 2,  # hand-rolled retry in chat.py was 0 — this is a free upgrade
        "stream": stream,
    }
    if api_base:
        kwargs["api_base"] = api_base
    # Optional OpenAI-shaped params (only forwarded if set)
    if temperature is not None:
        kwargs["temperature"] = temperature
    if top_p is not None:
        kwargs["top_p"] = top_p
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if stop is not None:
        kwargs["stop"] = stop
    if presence_penalty is not None:
        kwargs["presence_penalty"] = presence_penalty
    if frequency_penalty is not None:
        kwargs["frequency_penalty"] = frequency_penalty
    if n is not None:
        kwargs["n"] = n
    if user is not None:
        kwargs["user"] = user
    if extra_body:
        kwargs["extra_body"] = extra_body
    if stream and stream_options:
        kwargs["stream_options"] = stream_options

    try:
        response = await acompletion(**kwargs)
    except Exception as exc:
        category, status = _sanitize_category(exc)
        md.latency_ms = int((time.time() - started) * 1000)
        logger.warning(
            "litellm call failed model=%s category=%s status=%s err=%s",
            model, category, status, exc,
        )
        raise LiteLLMCallError(category=category, message=str(exc), status_code=status) from exc

    md.latency_ms = int((time.time() - started) * 1000)

    if stream:
        # Caller wraps the iterator to accumulate cost from final chunk.
        return response, md

    # Non-streaming: extract cost + usage
    md.cost_usd = _extract_cost_usd(response)
    try:
        usage = getattr(response, "usage", None)
        if usage:
            md.prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            md.completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            md.total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
    except Exception:
        pass
    try:
        md.provider = response._hidden_params.get("custom_llm_provider", "unknown") if hasattr(response, "_hidden_params") else "unknown"
    except Exception:
        md.provider = "unknown"

    return response, md


async def call_with_usage_callback(
    *,
    model: str,
    messages: list,
    api_key: str,
    api_base: Optional[str] = None,
    timeout: int = 60,
    **kwargs,
) -> Tuple[Any, CallMetadata]:
    """Like call(stream=False), but also returns a normalized dict for log_request.

    The returned dict is shaped to match what chat.py's log_request expects:
        {prompt_tokens, completion_tokens, total_tokens, cost_usd}
    """
    response, md = await call(
        model=model, messages=messages, api_key=api_key,
        api_base=api_base, timeout=timeout, stream=False, **kwargs,
    )
    return response, md


# ---------------------------------------------------------------------------
# Provider-prefix helpers
# ---------------------------------------------------------------------------
#
# AkaRouter's existing model_mapping values are plain OpenAI-style model names
# (e.g. "gpt-4o-mini", "claude-3-5-sonnet-20240620", "nousresearch/hermes-3").
# LiteLLM requires explicit prefixes ("openai/gpt-4o-mini",
# "anthropic/claude-3-5-sonnet-20240620") to know which adapter to use.
#
# For the spike, we accept a single `model` string the caller already knows how
# to resolve. If it's missing a prefix, we leave it as-is and let LiteLLM guess
# (its fallback chain will pick the right provider most of the time). A future
# improvement is a model_alias -> "provider/model" map in config.py.

KNOWN_PREFIXES = (
    "openai/", "anthropic/", "azure/", "bedrock/", "vertex_ai/",
    "gemini/", "openrouter/", "huggingface/", "replicate/", "together_ai/",
    "mistral/", "cohere/", "groq/", "fireworks_ai/", "deepseek/",
    "perplexity/", "ai21/", "nvidia_nim/", "xai/", "custom/",
)


def ensure_prefix(model: str, default_prefix: Optional[str] = None) -> str:
    """Ensure model string has a LiteLLM provider prefix.

    Args:
        model: The upstream model string from AkaRouter's DB
                (e.g. "stepfun/step-3.7-flash", "openrouter/owl-alpha",
                "nvidia/nemotron-3-ultra:free", or just "gpt-4o-mini").
        default_prefix: If provided, used when model has no prefix.
                        If None (default), use `custom/` prefix so LiteLLM
                        treats the model as a generic OpenAI-compatible
                        endpoint that follows OpenAI's wire format. This is
                        the right choice when AkaRouter passes its own
                        api_base — LiteLLM won't try to rewrite the URL.

    Returns:
        Model string with a valid LiteLLM prefix.

    Note: AkaRouter's flow is DB-driven, not provider-driven. The DB holds
    the canonical base_url + api_key per account, and AkaRouter passes them
    through to LiteLLM via api_key + api_base. We do NOT let LiteLLM pick
    the provider or rewrite the URL — that's the whole point of keeping
    AkaRouter's providers table as the source of truth.
    """
    if any(model.startswith(p) for p in KNOWN_PREFIXES):
        return model
    if "/" in model:
        # Unknown prefix (e.g. "myproxy/foo"). Trust the caller.
        return model
    if default_prefix:
        return default_prefix + model
    # No prefix, no default — use `custom/` so LiteLLM treats this as a
    # generic OpenAI-compatible endpoint that AkaRouter's api_base points at.
    # This is the DB-driven path: AkaRouter resolves base_url + api_key, we
    # just forward the request.
    return "custom/" + model
