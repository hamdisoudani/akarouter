"""AKAROUTER API Key authentication and routing logic."""
import hashlib
import time
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from app.core.config import settings
from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# API Key helpers
# ---------------------------------------------------------------------------

KEY_PREFIX = "akar_"


def hash_api_key(key: str) -> str:
    """SHA-256 hash of an API key for storage."""
    return hashlib.sha256(key.encode()).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """Generate a new API key. Returns (raw_key, key_hash, key_prefix)."""
    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    return raw, hash_api_key(raw), KEY_PREFIX


async def authenticate_api_key(api_key: str) -> Optional[dict]:
    """Validate an API key and return the associated account + key info."""
    if not api_key:
        return None

    key_hash = hash_api_key(api_key)
    supabase = get_supabase()

    # Look up the key
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

    # Check monthly limit
    if account.get("monthly_requests", 0) >= account.get("monthly_limit", 1000):
        logger.warning(f"Rate limit exceeded for account: {account['id']}")
        return None

    # Update last_used_at on the key
    supabase.table("api_keys").update({"last_used_at": datetime.now(timezone.utc).isoformat()}).eq("id", key_row["id"]).execute()

    return {
        "api_key_id": key_row["id"],
        "account_id": account["id"],
        "email": account["email"],
        "tier": account["tier"],
        "scopes": key_row.get("scopes", []),
        "allowed_models": key_row.get("allowed_models", ["*"]),
    }


# ---------------------------------------------------------------------------
# Provider routing
# ---------------------------------------------------------------------------

async def select_provider(model: str) -> Optional[dict]:
    """Select the best provider for a request using health-weighted round-robin."""
    supabase = get_supabase()

    # Get active providers with capacity
    result = (
        supabase.table("providers")
        .select("id, account_label, access_token, refresh_token, token_expires_at, health_status, weight, total_requests, total_errors, in_flight, max_concurrent, last_used_at")
        .eq("health_status", "active")
        .lt("in_flight", settings.max_concurrent_per_account)
        .order("last_used_at", desc=False, nullsfirst=True)  # least recently used first
        .execute()
    )

    if not result.data:
        logger.error("No active providers available")
        return None

    # Health-weighted selection: prefer providers with lower error rate
    now = time.time()
    best = None
    best_score = -1

    for p in result.data:
        # Check if token is still valid (with skew)
        expires_at = p.get("token_expires_at", "")
        if expires_at:
            try:
                exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if exp.timestamp() - now < settings.token_refresh_skew:
                    # Token about to expire, skip (will be refreshed by background task)
                    continue
            except (ValueError, TypeError):
                pass

        # Calculate health score: higher = better
        weight = p.get("weight", 1.0)
        total_req = p.get("total_requests", 0)
        total_err = p.get("total_errors", 0)
        error_rate = total_err / max(total_req, 1)
        in_flight = p.get("in_flight", 0)
        max_conc = p.get("max_concurrent", 12)
        capacity = (max_conc - in_flight) / max_conc

        # Score = weight * (1 - error_rate) * capacity
        score = weight * (1 - error_rate) * capacity

        if score > best_score:
            best_score = score
            best = p

    if not best and result.data:
        # Fallback: use first available even if token is expiring
        best = result.data[0]

    if best:
        # Increment in_flight atomically
        supabase.table("providers").update({
            "in_flight": best["in_flight"] + 1,
            "last_used_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", best["id"]).execute()

    return best


async def release_provider(provider_id: str, success: bool, error_msg: Optional[str] = None) -> None:
    """Release a provider after request completion and update stats."""
    supabase = get_supabase()

    # Get current stats
    result = supabase.table("providers").select("in_flight, total_requests, total_errors").eq("id", provider_id).execute()
    if not result.data:
        return

    current = result.data[0]
    updates = {
        "in_flight": max(0, current["in_flight"] - 1),
        "total_requests": current["total_requests"] + 1,
    }

    if not success:
        updates["total_errors"] = current["total_errors"] + 1
        updates["last_error_at"] = datetime.now(timezone.utc).isoformat()
        updates["last_error_msg"] = (error_msg or "")[:500]

        # If error rate > 50%, mark as degraded
        new_errors = updates["total_errors"]
        new_total = updates["total_requests"]
        if new_total > 5 and (new_errors / new_total) > 0.5:
            updates["health_status"] = "degraded"

    supabase.table("providers").update(updates).eq("id", provider_id).execute()


async def log_request(
    account_id: Optional[str],
    api_key_id: Optional[str],
    provider_id: Optional[str],
    model: str,
    status_code: int,
    latency_ms: int,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    error_message: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """Log a request to Supabase."""
    supabase = get_supabase()

    log_entry = {
        "account_id": account_id,
        "api_key_id": api_key_id,
        "provider_id": provider_id,
        "model": model,
        "status_code": status_code,
        "latency_ms": latency_ms,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "error_message": error_message,
        "ip_address": ip_address,
        "user_agent": user_agent,
    }

    try:
        supabase.table("request_logs").insert(log_entry).execute()
    except Exception as e:
        logger.error(f"Failed to log request: {e}")

    # Increment account monthly usage
    if account_id:
        try:
            result = supabase.table("accounts").select("monthly_requests").eq("id", account_id).execute()
            if result.data:
                supabase.table("accounts").update({
                    "monthly_requests": result.data[0]["monthly_requests"] + 1,
                }).eq("id", account_id).execute()
        except Exception as e:
            logger.error(f"Failed to update monthly usage: {e}")
