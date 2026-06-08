"""Hermes/Nous OAuth device code flow and token refresh for AKAROUTER."""
import asyncio
import logging
import time
import hashlib
from datetime import datetime, timezone
from typing import Optional

import httpx
from app.core.config import settings
from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)

NOUS_PORTAL_BASE = "https://portal.nousresearch.com"
NOUS_TOKEN_URL = f"{NOUS_PORTAL_BASE}/api/oauth/token"
NOUS_DEVICE_CODE_URL = f"{NOUS_PORTAL_BASE}/api/oauth/device/code"
NOUS_INFERENCE_BASE = "https://inference-api.nousresearch.com/v1"


# ---------------------------------------------------------------------------
# Device Code Flow — admin initiates, user authorizes, backend polls
# ---------------------------------------------------------------------------

async def initiate_device_code() -> dict:
    """Start a Hermes device code flow. Returns user_code, verification_uri, and device_code."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            NOUS_DEVICE_CODE_URL,
            data={
                "client_id": settings.nous_client_id,
                "scope": settings.nous_scope,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    required = ["device_code", "user_code", "verification_uri", "verification_uri_complete", "expires_in", "interval"]
    missing = [f for f in required if f not in data]
    if missing:
        raise ValueError(f"Device code response missing: {', '.join(missing)}")

    return {
        "device_code": data["device_code"],
        "user_code": data["user_code"],
        "verification_uri": data["verification_uri"],
        "verification_uri_complete": data["verification_uri_complete"],
        "expires_in": data["expires_in"],
        "interval": data["interval"],
    }


async def poll_device_token(device_code: str, expires_in: int, poll_interval: int = 5) -> dict:
    """Poll the token endpoint until user authorizes or timeout."""
    deadline = time.monotonic() + max(1, expires_in)
    current_interval = max(1, min(poll_interval, 30))

    async with httpx.AsyncClient(timeout=30.0) as client:
        while time.monotonic() < deadline:
            resp = await client.post(
                NOUS_TOKEN_URL,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "client_id": settings.nous_client_id,
                    "device_code": device_code,
                },
            )

            if resp.status_code == 200:
                payload = resp.json()
                if "access_token" not in payload:
                    raise ValueError("Token response missing access_token")
                return payload

            try:
                error_payload = resp.json()
            except Exception:
                resp.raise_for_status()
                raise RuntimeError("Token endpoint returned non-JSON error")

            error_code = error_payload.get("error", "")
            if error_code == "authorization_pending":
                await asyncio.sleep(current_interval)
                continue
            if error_code == "slow_down":
                current_interval = min(current_interval + 5, 30)
                await asyncio.sleep(current_interval)
                continue

            description = error_payload.get("error_description", "Unknown error")
            raise RuntimeError(f"{error_code}: {description}")

    raise TimeoutError("Device authorization timed out")


async def complete_oauth_flow(account_label: str) -> dict:
    """Full OAuth flow: initiate → poll → save provider to Supabase.
    
    Returns the device code info (for the admin to see the URL) and
    starts background polling.
    """
    # Step 1: Get device code
    device_info = await initiate_device_code()

    # Step 2: Poll for token (this blocks until user authorizes)
    token_data = await poll_device_token(
        device_code=device_info["device_code"],
        expires_in=device_info["expires_in"],
        poll_interval=device_info["interval"],
    )

    # Step 3: Calculate token expiry
    expires_in_seconds = token_data.get("expires_in", 3600)
    expires_at = datetime.now(timezone.utc).timestamp() + expires_in_seconds
    expires_at_iso = datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()

    # Step 4: Save to Supabase
    supabase = get_supabase()
    result = supabase.table("providers").insert({
        "account_label": account_label,
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token", ""),
        "token_expires_at": expires_at_iso,
        "token_scope": token_data.get("scope", settings.nous_scope),
        "health_status": "active",
        "weight": 1.0,
        "total_requests": 0,
        "total_errors": 0,
        "in_flight": 0,
        "max_concurrent": settings.max_concurrent_per_account,
    }).execute()

    if result.data:
        provider = result.data[0]
        logger.info(f"Added provider: {account_label} (id={provider['id']})")
        return {
            "ok": True,
            "provider_id": provider["id"],
            "account_label": account_label,
            "access_token_preview": token_data["access_token"][:20] + "...",
            "refresh_token_preview": token_data.get("refresh_token", "")[:10] + "...",
            "expires_at": expires_at_iso,
            "scope": token_data.get("scope", ""),
        }

    raise RuntimeError("Failed to save provider to Supabase")


# ---------------------------------------------------------------------------
# Token Refresh — single-use refresh token rotation with locking
# ---------------------------------------------------------------------------

async def refresh_provider_token(provider_id: str) -> dict:
    """Refresh a provider's access token using its refresh token.
    
    Hermes/Nous uses single-use refresh tokens (rotation).
    This function acquires a lock to prevent concurrent refresh races.
    """
    supabase = get_supabase()

    # Get current provider state
    result = supabase.table("providers").select(
        "id, account_label, access_token, refresh_token, token_expires_at, health_status, refresh_lock_acquired_at"
    ).eq("id", provider_id).execute()

    if not result.data:
        raise ValueError(f"Provider {provider_id} not found")

    provider = result.data[0]
    refresh_token = provider.get("refresh_token", "")
    account_label = provider.get("account_label", "")

    if not refresh_token:
        # Mark as dead — needs re-auth
        supabase.table("providers").update({
            "health_status": "dead",
            "last_error_at": datetime.now(timezone.utc).isoformat(),
            "last_error_msg": "No refresh token available — needs re-authentication",
        }).eq("id", provider_id).execute()
        raise ValueError(f"Provider {account_label} has no refresh token — needs re-auth")

    # Check if already being refreshed (lock)
    lock_time = provider.get("refresh_lock_acquired_at")
    if lock_time:
        try:
            locked_at = datetime.fromisoformat(str(lock_time).replace("Z", "+00:00"))
            lock_age = (datetime.now(timezone.utc) - locked_at).total_seconds()
            if lock_age < settings.refresh_lock_ttl:
                logger.info(f"Provider {account_label} is already being refreshed (lock age: {lock_age:.0f}s)")
                return {"ok": False, "reason": "already_refreshing"}
        except (ValueError, TypeError):
            pass

    # Acquire refresh lock
    supabase.table("providers").update({
        "refresh_lock_acquired_at": datetime.now(timezone.utc).isoformat(),
        "health_status": "refreshing",
    }).eq("id", provider_id).execute()

    try:
        # Call Nous token endpoint
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                NOUS_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": settings.nous_client_id,
                    "refresh_token": refresh_token,
                },
            )

        if resp.status_code != 200:
            error_detail = resp.text[:500]
            logger.error(f"Token refresh failed for {account_label}: {resp.status_code} {error_detail}")

            # If 400/401, refresh token is consumed/invalid — mark dead
            if resp.status_code in (400, 401):
                supabase.table("providers").update({
                    "health_status": "dead",
                    "last_error_at": datetime.now(timezone.utc).isoformat(),
                    "last_error_msg": f"Refresh token invalid ({resp.status_code}): {error_detail}",
                    "refresh_lock_acquired_at": None,
                }).eq("id", provider_id).execute()
                raise ValueError(f"Refresh token for {account_label} is invalid — needs re-auth")

            # Transient error — back to active
            supabase.table("providers").update({
                "health_status": "active",
                "last_error_at": datetime.now(timezone.utc).isoformat(),
                "last_error_msg": f"Refresh failed ({resp.status_code}): {error_detail}",
                "refresh_lock_acquired_at": None,
            }).eq("id", provider_id).execute()
            raise RuntimeError(f"Token refresh failed with status {resp.status_code}")

        # Parse new tokens
        payload = resp.json()
        new_access_token = payload.get("access_token", "")
        new_refresh_token = payload.get("refresh_token", refresh_token)  # May rotate
        expires_in_seconds = payload.get("expires_in", 3600)
        expires_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + expires_in_seconds,
            tz=timezone.utc
        ).isoformat()

        # Update provider in Supabase
        supabase.table("providers").update({
            "access_token": new_access_token,
            "refresh_token": new_refresh_token,
            "token_expires_at": expires_at,
            "health_status": "active",
            "refresh_lock_acquired_at": None,
            "last_error_msg": None,
            "last_error_at": None,
        }).eq("id", provider_id).execute()

        logger.info(f"Refreshed token for {account_label}, expires at {expires_at}")
        return {
            "ok": True,
            "provider_id": provider_id,
            "account_label": account_label,
            "access_token_preview": new_access_token[:20] + "...",
            "refresh_token_preview": new_refresh_token[:10] + "...",
            "expires_at": expires_at,
        }

    except Exception as e:
        # Release lock on any error
        try:
            supabase.table("providers").update({
                "health_status": "active",
                "refresh_lock_acquired_at": None,
            }).eq("id", provider_id).execute()
        except Exception:
            pass
        raise


async def refresh_expiring_providers() -> list[dict]:
    """Check all active providers and refresh ones about to expire.
    
    Called periodically (e.g. via cron or background task).
    """
    supabase = get_supabase()
    now = datetime.now(timezone.utc)
    skew_seconds = settings.token_refresh_skew

    # Get all active providers
    result = supabase.table("providers").select(
        "id, account_label, token_expires_at, health_status"
    ).eq("health_status", "active").execute()

    refreshed = []
    for provider in result.data:
        expires_at_str = provider.get("token_expires_at", "")
        if not expires_at_str:
            continue

        try:
            expires_at = datetime.fromisoformat(str(expires_at_str).replace("Z", "+00:00"))
            seconds_until_expiry = (expires_at - now).total_seconds()

            if seconds_until_expiry < skew_seconds:
                logger.info(f"Provider {provider['account_label']} expires in {seconds_until_expiry:.0f}s — refreshing")
                try:
                    result = await refresh_provider_token(provider["id"])
                    refreshed.append(result)
                except Exception as e:
                    logger.error(f"Failed to refresh {provider['account_label']}: {e}")
                    refreshed.append({
                        "ok": False,
                        "provider_id": provider["id"],
                        "account_label": provider["account_label"],
                        "error": str(e),
                    })
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid expires_at for {provider['account_label']}: {e}")

    return refreshed
