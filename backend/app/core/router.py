"""AKAROUTER API Key authentication, provider selection, and request logging."""
import hashlib
import time
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from app.core.config import settings
from app.core.supabase import get_supabase

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


async def authenticate_api_key(api_key: str, check_limits: bool = True) -> Optional[dict]:
    if not api_key:
        return None
    key_hash = hash_api_key(api_key)
    
    # Try in-memory cache first
    from app.core.cache import (
        get_api_key_cache, set_api_key_cache, should_update_last_used_at,
        check_and_increment_rpm, get_account_budget, set_account_budget
    )
    
    auth_metadata = get_api_key_cache(key_hash)
    if auth_metadata is None:
        supabase = get_supabase()
        result = (
            supabase.table("api_keys")
            .select("id, key_name, scopes, allowed_models, is_active, account_id, accounts(id, email, tier, status, monthly_requests, monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit, budget_reset_at)")
            .eq("key_hash", key_hash)
            .eq("is_active", True)
            .execute()
        )
        if not result.data:
            logger.warning(f"Invalid API key attempt: {api_key[:8]}...")
            return None
        key_row = result.data[0]
        account = key_row.get("accounts")
        if not account or account.get("status") != "active":
            logger.warning(f"Account inactive for key: {key_row['id']}")
            return None
        if account.get("monthly_requests", 0) >= account.get("monthly_limit", 1000):
            logger.warning(f"Rate limit exceeded for account: {account['id']}")
            return None

        auth_metadata = {
            "api_key_id": key_row["id"],
            "key_id": key_row["id"],
            "account_id": account["id"],
            "email": account["email"],
            "tier": account["tier"],
            "scopes": key_row.get("scopes", []),
            "allowed_models": key_row.get("allowed_models", ["*"]),
            "rpm_limit": account.get("rpm_limit") or 60,
            "tokens_5h_limit": account.get("tokens_5h_limit") or 1.0,
            "tokens_7d_limit": account.get("tokens_7d_limit") or 5.0,
            "budget_reset_at": account.get("budget_reset_at"),
        }
        # Cache auth response (TTL 30 seconds)
        set_api_key_cache(key_hash, auth_metadata)

    # We have auth_metadata (either from cache or database).
    # Throttle last_used_at writes to DB (only write if > 60s since last update)
    if should_update_last_used_at(auth_metadata["key_id"]):
        try:
            supabase = get_supabase()
            supabase.table("api_keys").update({
                "last_used_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", auth_metadata["key_id"]).execute()
        except Exception as e:
            logger.error(f"Failed to update key last_used_at: {e}")

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
        # Cache miss: query DB to pre-calculate
        from datetime import datetime, timezone, timedelta
        now_dt = datetime.now(timezone.utc)
        seven_days_ago = now_dt - timedelta(days=7)
        
        budget_reset_at = auth_metadata.get("budget_reset_at")
        start_dt = seven_days_ago
        if budget_reset_at:
            try:
                reset_dt = datetime.fromisoformat(budget_reset_at.replace("Z", "+00:00"))
                start_dt = max(seven_days_ago, reset_dt)
            except Exception:
                pass
                
        try:
            supabase = get_supabase()
            logs_res = (
                supabase.table("request_logs")
                .select("cost, created_at")
                .eq("account_id", account_id)
                .gte("created_at", start_dt.isoformat())
                .execute()
            )
        except Exception as e:
            logger.error(f"Failed to query request logs for budget calculation: {e}")
            logs_res = None
            
        consumed_5h = 0.0
        consumed_7d = 0.0
        five_hours_ago = now_dt - timedelta(hours=5)
        
        if logs_res and logs_res.data:
            for log in logs_res.data:
                cost = log.get("cost") or 0.0
                created_at_str = log.get("created_at")
                if not created_at_str:
                    continue
                try:
                    log_dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                    if log_dt >= five_hours_ago:
                        consumed_5h += cost
                    if log_dt >= seven_days_ago:
                        consumed_7d += cost
                except Exception:
                    pass
        
        set_account_budget(account_id, consumed_5h, consumed_7d)
        budget = {
            "consumed_5h": consumed_5h,
            "consumed_7d": consumed_7d
        }
        
    if check_limits:
        tokens_5h_limit = auth_metadata.get("tokens_5h_limit", 1.0)
        tokens_7d_limit = auth_metadata.get("tokens_7d_limit", 5.0)
        
        if budget["consumed_5h"] >= tokens_5h_limit:
            logger.warning(f"5-hour token budget exceeded for account: {account_id} ({budget['consumed_5h']} >= {tokens_5h_limit})")
            raise BudgetLimitException("5-hour token budget exceeded")
            
        if budget["consumed_7d"] >= tokens_7d_limit:
            logger.warning(f"7-day token budget exceeded for account: {account_id} ({budget['consumed_7d']} >= {tokens_7d_limit})")
            raise BudgetLimitException("7-day token budget exceeded")

    return auth_metadata


async def select_provider(model: str) -> Optional[dict]:
    """Select the best available provider for a given upstream model."""
    from app.core.cache import (
        get_active_providers_cache, set_active_providers_cache,
        get_in_flight, inc_in_flight, should_update_last_used_at
    )
    
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
            logger.error("No active providers available")
            return None
        providers = result.data
        set_active_providers_cache(providers)

    now = time.time()
    best = None
    best_score = -1

    for p in providers:
        expires_at = p.get("token_expires_at", "")
        if expires_at and not p.get("refresh_token"):
            try:
                exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if exp.timestamp() - now < settings.token_refresh_skew:
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
        try:
            supabase = get_supabase()
            supabase.table("providers").update({
                "last_used_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", best["id"]).execute()
        except Exception as e:
            logger.error(f"Failed to update provider last_used_at: {e}")

    return best


async def release_provider(provider_id: str, success: bool, error_msg: Optional[str] = None) -> None:
    """Release a provider after request completion."""
    from app.core.cache import dec_in_flight, buffer_provider_usage, clear_active_providers_cache
    
    # 1. Decrement in-flight count locally
    dec_in_flight(provider_id)

    # 2. Buffer requests / error stats locally
    buffer_provider_usage(provider_id, success)

    # 3. If failed, trigger instant failover by degrading in the DB immediately
    if not success:
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
    from app.core.cache import buffer_request_log, buffer_account_usage, increment_account_budget
    
    # Calculate request cost in USD
    cost = settings.calculate_cost(model, prompt_tokens, completion_tokens)
    
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
        "ip_address": ip_address,
        "user_agent": user_agent,
        "cost": cost,
    }
    # Buffer the telemetry log
    buffer_request_log(log_data)

    # Buffer the account requests increment metrics and cached sliding budget
    if account_id:
        buffer_account_usage(account_id)
        increment_account_budget(account_id, cost)
