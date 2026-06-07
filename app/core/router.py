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


async def authenticate_api_key(api_key: str) -> Optional[dict]:
    if not api_key:
        return None
    key_hash = hash_api_key(api_key)
    supabase = get_supabase()
    result = (
        supabase.table("api_keys")
        .select("id, key_name, scopes, allowed_models, is_active, account_id, accounts(id, email, tier, status, monthly_requests, monthly_limit)")
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

    supabase.table("api_keys").update({"last_used_at": datetime.now(timezone.utc).isoformat()}).eq("id", key_row["id"]).execute()

    return {
        "api_key_id": key_row["id"],
        "key_id": key_row["id"],
        "account_id": account["id"],
        "email": account["email"],
        "tier": account["tier"],
        "scopes": key_row.get("scopes", []),
        "allowed_models": key_row.get("allowed_models", ["*"]),
    }


async def select_provider(model: str) -> Optional[dict]:
    """Select the best available provider for a given upstream model."""
    supabase = get_supabase()
    result = (
        supabase.table("providers")
        .select("id, account_label, access_token, refresh_token, token_expires_at, health_status, weight, total_requests, total_errors, in_flight, max_concurrent, last_used_at, refresh_lock_acquired_at")
        .eq("health_status", "active")
        .lt("in_flight", settings.max_concurrent_per_account)
        .order("last_used_at", desc=False, nullsfirst=True)
        .execute()
    )
    if not result.data:
        logger.error("No active providers available")
        return None

    now = time.time()
    best = None
    best_score = -1

    for p in result.data:
        expires_at = p.get("token_expires_at", "")
        if expires_at:
            try:
                exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if exp.timestamp() - now < settings.token_refresh_skew:
                    continue
            except (ValueError, TypeError):
                pass

        load = p.get("in_flight", 0) / max(p.get("max_concurrent", 12), 1)
        w = p.get("weight", 1.0)
        score = w * (1 - load)
        if score > best_score:
            best_score = score
            best = p

    if not best:
        logger.warning("All providers expired or at capacity")
        return None

    # Increment in_flight atomically
    supabase.table("providers").update({
        "in_flight": best.get("in_flight", 0) + 1,
        "last_used_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", best["id"]).execute()

    return best


async def release_provider(provider_id: str, success: bool, error_msg: Optional[str] = None) -> None:
    """Release a provider after request completion."""
    supabase = get_supabase()
    result = supabase.table("providers").select("in_flight, total_requests, total_errors").eq("id", provider_id).execute()
    if not result.data:
        return

    current = result.data[0]
    update = {
        "in_flight": max(0, current.get("in_flight", 1) - 1),
        "total_requests": current.get("total_requests", 0) + 1,
        "total_errors": current.get("total_errors", 0) + (0 if success else 1),
        "health_status": "active" if success else "degraded",
        "last_used_at": datetime.now(timezone.utc).isoformat(),
    }
    if not success and error_msg:
        update["last_error_at"] = datetime.now(timezone.utc).isoformat()
        update["last_error_msg"] = error_msg[:500]

    supabase.table("providers").update(update).eq("id", provider_id).execute()


async def log_request(
    account_id, api_key_id, provider_id, model, upstream_model,
    status_code, latency_ms,
    prompt_tokens=0, completion_tokens=0, total_tokens=0,
    error_message=None, ip_address=None, user_agent=None
):
    """Log a request for analytics."""
    supabase = get_supabase()
    try:
        supabase.table("request_logs").insert({
            "account_id": account_id,
            "api_key_id": api_key_id,
            "provider_id": provider_id,
            "request_id": f"req-{secrets.token_hex(8)}",
            "model": model,
            "upstream_model": upstream_model,
            "status": "success" if status_code < 400 else "error",
            "http_status": status_code,
            "latency_ms": latency_ms,
            "error_message": error_message[:500] if error_message else None,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "ip_address": ip_address,
            "user_agent": user_agent,
        }).execute()
    except Exception as e:
        logger.error(f"Failed to log request: {e}")

    # Update account monthly_requests
    try:
        supabase.table("accounts").update({
            "monthly_requests": supabase.table("accounts").select("monthly_requests").eq("id", account_id).execute().data[0].get("monthly_requests", 0) + 1,
        }).eq("id", account_id).execute()
    except Exception:
        pass
