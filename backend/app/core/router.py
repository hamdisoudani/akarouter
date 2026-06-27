"""AKAROUTER API Key authentication, provider selection, and request logging."""
import hashlib
import time
import logging
import secrets
import asyncio
from datetime import datetime, timezone
from typing import Optional

from app.core.config import settings
from app.core.supabase import get_supabase
from app.core.cache import (
    get_api_key_cache, set_api_key_cache, should_update_last_used_at,
    check_and_increment_rpm, get_account_budget, calculate_account_budget,
    get_active_providers_cache, set_active_providers_cache,
    get_in_flight, inc_in_flight, buffer_request_log,
    buffer_account_usage, increment_account_budget, get_model_metadata,
    get_request_quota, increment_request_quota, evict_request_quota_cache
)
from app.core.locks import get_lock_backend

logger = logging.getLogger(__name__)

KEY_PREFIX = "akar_"


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    return raw, hash_api_key(raw), KEY_PREFIX


class RateLimitException(Exception):
    pass


class BudgetLimitException(Exception):
    pass


class SuspendedAccountException(Exception):
    pass


class BannedAccountException(Exception):
    """Raised when an account is banned (ToS violation). Banned users get a
    distinct 403 with ban_reason, and all their API keys are auto-revoked so
    they cannot bypass the ban via in-memory cache or saved credentials."""
    pass


async def authenticate_api_key(api_key: str, check_limits: bool = True) -> Optional[dict]:
    if not api_key:
        return None
    key_hash = hash_api_key(api_key)
    
    # Try in-memory cache first
    auth_metadata = get_api_key_cache(key_hash)
    if auth_metadata is None:
        supabase = get_supabase()
        result = (
            supabase.table("api_keys")
            .select("id, key_name, scopes, allowed_models, is_active, account_id, accounts(id, email, tier, status, monthly_requests, monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit, budget_reset_at, suspended_reason, ban_reason)")
            .eq("key_hash", key_hash)
            .eq("is_active", True)
            .execute()
        )
        if not result.data:
            logger.warning(f"Invalid API key attempt: {api_key[:8]}...")
            return None
        key_row = result.data[0]
        account = key_row.get("accounts")
        if not account:
            logger.warning(f"No account found for key: {key_row['id']}")
            return None
        # Banned check: Banned = permanent, ToS violation. Distinct from
        # 'suspended' (temporary, e.g. payment failed). Banned users see
        # 'Account is banned' not 'Account is suspended', AND all their
        # active API keys are auto-revoked so they cannot use the API at all
        # even with previously-saved credentials.
        if account.get("status") == "banned":
            ban_reason = account.get("ban_reason") or "Violation of terms of service"
            logger.warning(
                f"Account BANNED attempting API call — key: {key_row['id']} | "
                f"Reason: {ban_reason}. Auto-revoking all keys for this account."
            )
            # Auto-revoke ALL active keys for this banned account. Fire-and-forget
            # so we don't add DB latency to the 403 path. If this fails, the next
            # request will retry it (cached key still hits this branch because we
            # set is_active=False in DB).
            import asyncio
            async def _revoke_banned_keys():
                try:
                    revoke = supabase.table("api_keys").update(
                        {"is_active": False}
                    ).eq("account_id", account["id"]).eq("is_active", True).execute()
                    logger.info(
                        f"Auto-revoked {len(revoke.data) if revoke.data else 0} "
                        f"API key(s) for banned account {account['id']}"
                    )
                except Exception as e:
                    logger.error(f"Failed to auto-revoke keys for banned account: {e}")
            asyncio.create_task(_revoke_banned_keys())
            # Evict in-memory cache for this key so the next call from
            # any other process/instance doesn't bypass via cache.
            try:
                from app.core.cache import evict_api_key_cache
                evict_api_key_cache(key_hash)
            except Exception:
                pass
            raise BannedAccountException(f"Account is banned: {ban_reason}")
        if account.get("status") != "active":
            reason = account.get("suspended_reason") or "No reason provided"
            logger.warning(f"Account suspended for key: {key_row['id']} | Reason: {reason}")
            raise SuspendedAccountException(f"Account is suspended: {reason}")

        auth_metadata = {
            "api_key_id": key_row["id"],
            "key_id": key_row["id"],
            "account_id": account["id"],
            "email": account["email"],
            "tier": account["tier"],
            "scopes": key_row.get("scopes", []),
            "allowed_models": key_row.get("allowed_models", ["*"]),
            "rpm_limit": account.get("rpm_limit") if account.get("rpm_limit") is not None else 60,
            "tokens_5h_limit": float(account.get("tokens_5h_limit") if account.get("tokens_5h_limit") is not None else 1.0),
            "tokens_7d_limit": float(account.get("tokens_7d_limit") if account.get("tokens_7d_limit") is not None else 5.0),
            "monthly_limit": float(account.get("monthly_limit") if account.get("monthly_limit") is not None else 10.0),
            "monthly_requests": account.get("monthly_requests") or 0,
            "monthly_requests_limit": account.get("monthly_requests_limit"),
            "budget_reset_at": account.get("budget_reset_at"),
            "status": account.get("status") or "active",
            "suspended_reason": account.get("suspended_reason") or "",
            "ban_reason": account.get("ban_reason") or "",
        }
        # Cache auth response (TTL 30 seconds)
        set_api_key_cache(key_hash, auth_metadata)

    # We have auth_metadata (either from cache or database).
    # Throttle last_used_at writes to DB (only write if > 60s since last update)
    if should_update_last_used_at(auth_metadata["key_id"]):
        async def _update_key_db():
            try:
                supabase = get_supabase()
                supabase.table("api_keys").update({
                    "last_used_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", auth_metadata["key_id"]).execute()
            except Exception as e:
                logger.error(f"Failed to update key last_used_at in background: {e}")
        asyncio.create_task(_update_key_db())

    # Enforce account status check (always run, even on key cache hit).
    # Banned is distinct from suspended: banned = permanent, must be blocked
    # at every call, and the 403 message must say "banned" not "suspended".
    if auth_metadata.get("status") == "banned":
        ban_reason = auth_metadata.get("ban_reason") or "Violation of terms of service"
        # Schedule a one-shot cache invalidation so future calls hit the DB
        # path (which will also auto-revoke the key). Best-effort, not blocking.
        try:
            import asyncio
            from app.core.cache import evict_api_key_cache
            asyncio.create_task(evict_api_key_cache(key_hash))
        except Exception:
            pass
        raise BannedAccountException(f"Account is banned: {ban_reason}")
    if auth_metadata.get("status") != "active":
        reason = auth_metadata.get("suspended_reason") or "No reason provided"
        raise SuspendedAccountException(f"Account is suspended: {reason}")

    # Enforce limits (always run, even on key cache hit, but only if check_limits is True)
    account_id = auth_metadata["account_id"]
    rpm_limit = auth_metadata.get("rpm_limit", 60)
    
    if check_limits:
        if check_and_increment_rpm(account_id, rpm_limit):
            logger.warning(f"RPM rate limit exceeded for account: {account_id}")
            raise RateLimitException("Requests per minute limit exceeded")

    # Enforce Token sliding budgets
    budget = get_account_budget(account_id)
    if budget is None:
        budget = await calculate_account_budget(account_id, auth_metadata.get("budget_reset_at"))

    if check_limits:
        # SECURITY: cross-instance budget race protection.
        # Without this lock, two FastAPI instances behind a load balancer
        # could both read budget["consumed_5h"] < limit, both allow the
        # request, and both flush a cost increment — pushing the account
        # over budget. The lock serializes the read-check-increment cycle
        # across instances for the same account_id.
        #
        # Non-blocking try-acquire: if another instance is mid-check for
        # this account, fail-fast with 429 instead of waiting. This is
        # safer for tail latency — clients retry with backoff and another
        # instance will accept the request.
        locks = get_lock_backend()
        lock_ctx = await locks.account_budget(account_id)
        async with lock_ctx as budget_lock:
            if not getattr(budget_lock, "acquired", True):
                logger.warning(
                    f"Budget lock contended for account {account_id}; "
                    "failing fast with 429 (client should retry)"
                )
                raise RateLimitException("Budget check contended, retry shortly")

            tokens_5h_limit = auth_metadata.get("tokens_5h_limit", 1.0)
            tokens_7d_limit = auth_metadata.get("tokens_7d_limit", 5.0)
            monthly_limit = auth_metadata.get("monthly_limit", 10.0)

            if budget["consumed_5h"] >= tokens_5h_limit:
                logger.warning(f"5-hour token budget exceeded for account: {account_id} ({budget['consumed_5h']} >= {tokens_5h_limit})")
                raise BudgetLimitException("5-hour token budget exceeded")

            if budget["consumed_7d"] >= tokens_7d_limit:
                logger.warning(f"7-day token budget exceeded for account: {account_id} ({budget['consumed_7d']} >= {tokens_7d_limit})")
                raise BudgetLimitException("7-day token budget exceeded")

            if budget["consumed_month"] >= monthly_limit:
                logger.warning(f"Monthly token budget exceeded for account: {account_id} ({budget['consumed_month']} >= {monthly_limit})")
                raise BudgetLimitException("Monthly token budget exceeded")

            # Enforce per-request monthly cap (independent from token budgets)
            monthly_requests_limit = auth_metadata.get("monthly_requests_limit")
            if monthly_requests_limit:
                used = auth_metadata.get("monthly_requests") or 0
                if used >= monthly_requests_limit:
                    logger.warning(f"Monthly request limit exceeded for account: {account_id} ({used} >= {monthly_requests_limit})")
                    raise BudgetLimitException("Monthly request limit exceeded")

async def select_endpoint(model: str) -> Optional[dict]:
    """Select a direct provider_endpoint for a model when pricing_mode is per-request.
    Resolves via the upstream_model matched against provider_endpoints.model_aliases array."""
    try:
        supabase = get_supabase()
        meta = get_model_metadata(model)
        mode = meta.get("pricing_mode") or "per_token"
        if mode != "per_request":
            return None

        # Look up the alias in the DB to get the canonical upstream_model string
        meta_row = (
            supabase.table("model_mapping")
            .select("upstream_model")
            .eq("alias", model)
            .execute()
        )
        if not meta_row.data:
            logger.warning(f"per_request model {model} not found in model_mapping")
            return None
        upstream_model = meta_row.data[0]["upstream_model"]

        # Match against active provider_endpoints whose model_aliases contains this upstream model
        res = (
            supabase.table("provider_endpoints")
            .select("id, name, base_url, model_aliases, default_pricing_mode, default_cost_per_request_cents, health_status, max_concurrent, api_key_encrypted")
            .contains("model_aliases", [upstream_model])
            .eq("health_status", "active")
            .execute()
        )
        if not res.data:
            logger.warning(f"No active provider_endpoint for {model} (upstream={upstream_model})")
            return None

        row = res.data[0]
        return {
            "endpoint_id": row["id"],
            "name": row["name"],
            "url": row["base_url"],
            "models": row.get("model_aliases") or [],
            "api_key_encrypted": row.get("api_key_encrypted"),
            "max_concurrent": row.get("max_concurrent"),
        }
    except Exception as e:
        logger.error(f"Failed to select endpoint for {model}: {e}")
        return None


async def release_endpoint(endpoint_id: str) -> None:
    """Placeholder for per-endpoint concurrency tracking."""
    return None

    return auth_metadata


async def select_provider(model: str) -> Optional[dict]:
    """Select the best available provider for a given upstream model."""
    # Try providers cache first
    providers = get_active_providers_cache()
    if providers is None:
        supabase = get_supabase()
        result = (
            supabase.table("providers")
            .select("id, account_label, access_token, refresh_token, token_expires_at, health_status, weight, total_requests, total_errors, in_flight, max_concurrent, last_used_at, refresh_lock_acquired_at")
            .eq("health_status", "active")
            .order("last_used_at", desc=False, nullsfirst=True)
            .execute()
        )
        if not result.data:
            logger.warning("No active providers available, trying degraded fallback")
            result = (
                supabase.table("providers")
                .select("id, account_label, access_token, refresh_token, token_expires_at, health_status, weight, total_requests, total_errors, in_flight, max_concurrent, last_used_at, refresh_lock_acquired_at")
                .eq("health_status", "degraded")
                .order("last_used_at", desc=False, nullsfirst=True)
                .execute()
            )
            if not result.data:
                logger.error("No active or degraded providers available")
                return None
            providers = result.data
        else:
            providers = result.data
            set_active_providers_cache(providers)

    now = time.time()
    best = None
    best_score = -1

    for p in providers:
        expires_at = p.get("token_expires_at", "")
        refresh_token = p.get("refresh_token", "")
        if expires_at:
            try:
                exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if exp.timestamp() - now < settings.token_refresh_skew:
                    # Token is expired or about to expire. If we have a refresh
                    # token, try to refresh lazily right now so this chat can
                    # succeed instead of falling through to "no provider". The
                    # refresh_provider_token() function will mark the provider
                    # 'dead' if the refresh token has been revoked.
                    if refresh_token:
                        try:
                            from app.core.oauth import refresh_provider_token
                            logger.info(
                                "select_provider: lazy-refreshing %s (expires in %.0fs)",
                                p.get("account_label"),
                                exp.timestamp() - now,
                            )
                            await refresh_provider_token(p["id"])
                            # Re-read the updated provider from cache/DB
                            # so the access_token below is the new one.
                            refreshed_list = get_active_providers_cache()
                            if refreshed_list:
                                for rp in refreshed_list:
                                    if rp["id"] == p["id"]:
                                        p = rp
                                        break
                        except Exception as refresh_err:
                            logger.warning(
                                "select_provider: lazy refresh failed for %s: %s",
                                p.get("account_label"),
                                refresh_err,
                            )
                            continue  # Skip this provider, try the next
                    else:
                        # No refresh token and no time left — mark dead and skip.
                        # The background refresh loop won't pick this up because
                        # it only handles health_status='active'.
                        logger.warning(
                            "select_provider: %s expired with no refresh_token, skipping",
                            p.get("account_label"),
                        )
                        continue
            except (ValueError, TypeError):
                pass

        # Retrieve current concurrent/in-flight requests tracked locally in memory
        load = get_in_flight(p["id"]) / max(p.get("max_concurrent", 12), 1)
        if load >= 1.0:
            continue  # Max capacity reached locally

        w = p.get("weight", 1.0)
        score = w * (1 - load)
        if score > best_score:
            best_score = score
            best = p

    if not best:
        logger.warning("All providers expired or at capacity")
        return None

    # Track concurrent request locally
    inc_in_flight(best["id"])

    # Throttle provider last_used_at DB updates
    if should_update_last_used_at(best["id"]):
        async def _update_provider_db():
            try:
                supabase = get_supabase()
                supabase.table("providers").update({
                    "last_used_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", best["id"]).execute()
            except Exception as e:
                logger.error(f"Failed to update provider last_used_at in background: {e}")
        asyncio.create_task(_update_provider_db())

    return best


async def release_provider(provider_id: str, success: bool, error_msg: Optional[str] = None) -> None:
    """Release a provider after request completion with failure thresholds and healing."""
    from app.core.cache import (
        dec_in_flight, buffer_provider_usage, clear_active_providers_cache,
        inc_consecutive_errors, reset_consecutive_errors
    )
    
    # 1. Decrement in-flight count locally
    dec_in_flight(provider_id)

    # 2. Buffer requests / error stats locally
    buffer_provider_usage(provider_id, success)

    # 3. Handle healing and threshold-based degradation
    if success:
        reset_consecutive_errors(provider_id)
        # Attempt to auto-heal provider if it was degraded or dead
        try:
            supabase = get_supabase()
            res = (
                supabase.table("providers")
                .update({
                    "health_status": "active",
                    "last_used_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("id", provider_id)
                .in_("health_status", ["degraded", "dead"])
                .execute()
            )
            if res.data:
                logger.info(f"Provider {provider_id} auto-healed and marked active in database")
                clear_active_providers_cache()
        except Exception as e:
            logger.error(f"Failed to auto-heal provider {provider_id} in DB: {e}")
    else:
        consecutive_errors = inc_consecutive_errors(provider_id)
        logger.warning(f"Provider {provider_id} recorded request failure. Consecutive errors: {consecutive_errors}")
        
        # Only degrade in the DB after 3 consecutive failures
        if consecutive_errors >= 3:
            logger.error(f"Provider {provider_id} reached {consecutive_errors} consecutive failures. Marking as degraded.")
            clear_active_providers_cache()
            try:
                supabase = get_supabase()
                update = {
                    "health_status": "degraded",
                    "last_used_at": datetime.now(timezone.utc).isoformat(),
                }
                if error_msg:
                    update["last_error_at"] = datetime.now(timezone.utc).isoformat()
                    update["last_error_msg"] = error_msg[:500]
                supabase.table("providers").update(update).eq("id", provider_id).execute()
            except Exception as e:
                logger.error(f"Failed to degrade provider {provider_id} in DB: {e}")


async def log_request(
    account_id, api_key_id, provider_id, model, upstream_model,
    status_code, latency_ms,
    prompt_tokens=0, completion_tokens=0, total_tokens=0,
    error_message=None, ip_address=None, user_agent=None
):
    """Log a request to memory buffer for deferred batch insertions."""
    is_success = status_code is not None and status_code < 400

    # Calculate cost: per-request uses flat cost_per_request_cents; per-token uses token rates
    if is_success:
        meta = get_model_metadata(model)
        pricing_mode = meta.get("pricing_mode") or "per_token"

        if pricing_mode == "per_request":
            cost_cents = meta.get("cost_per_request_cents")
            cost = (float(cost_cents) / 100.0) if cost_cents is not None else 0.0
        else:
            input_cost_rate = meta.get("input_cost_per_million")
            output_cost_rate = meta.get("output_cost_per_million")
            if input_cost_rate is None or output_cost_rate is None:
                pricing = settings.model_pricing.get(model, settings.model_pricing["default"])
                if input_cost_rate is None:
                    input_cost_rate = pricing.get("input_cost_per_million", 0.10)
                if output_cost_rate is None:
                    output_cost_rate = pricing.get("output_cost_per_million", 0.30)
            input_cost = (prompt_tokens / 1_000_000.0) * float(input_cost_rate)
            output_cost = (completion_tokens / 1_000_000.0) * float(output_cost_rate)
            cost = input_cost + output_cost
    else:
        cost = 0.0
        pricing_mode = "per_token"

    log_data = {
        "account_id": account_id,
        "api_key_id": api_key_id,
        "provider_id": provider_id,
        "model": model,
        "upstream_model": upstream_model,
        "status_code": status_code,
        "latency_ms": latency_ms,
        "error_message": error_message[:500] if error_message else None,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "requests_counted": 1 if is_success else 0,
        "ip_address": ip_address,
        "user_agent": user_agent,
        "cost": cost,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    buffer_request_log(log_data)

    if account_id and is_success:
        buffer_account_usage(account_id)
        increment_account_budget(account_id, cost)
        increment_request_quota(account_id, 1)
