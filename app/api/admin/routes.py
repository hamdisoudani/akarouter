"""Admin endpoints for managing providers and API keys."""
import logging
from typing import Optional

import fastapi
from fastapi import APIRouter, HTTPException, Header

from app.core.config import settings
from app.core.supabase import get_supabase
from app.core.router import generate_api_key, hash_api_key, KEY_PREFIX

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin")

# Simple admin auth (service role key as admin password)
def _verify_admin(authorization: Optional[str]) -> bool:
    if not authorization:
        return False
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip() == settings.supabase_service_role_key
    return False


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

@router.get("/providers")
async def list_providers(authorization: Optional[str] = Header(None)):
    """List all providers (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    supabase = get_supabase()
    result = supabase.table("providers").select(
        "id, account_label, health_status, weight, total_requests, total_errors, in_flight, max_concurrent, last_used_at, last_error_at, last_error_msg, created_at"
    ).execute()
    return {"providers": result.data}


@router.post("/providers")
async def add_provider(
    account_label: str,
    access_token: str,
    refresh_token: str,
    token_expires_at: str,
    authorization: Optional[str] = Header(None),
    weight: float = 1.0,
    max_concurrent: int = 12,
):
    """Add a new Hermes/NOUS provider account (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    supabase = get_supabase()
    result = supabase.table("providers").insert({
        "account_label": account_label,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expires_at": token_expires_at,
        "weight": weight,
        "max_concurrent": max_concurrent,
    }).execute()
    
    if result.data:
        return {"ok": True, "provider": result.data[0]}
    raise HTTPException(status_code=500, detail="Failed to add provider")


@router.delete("/providers/{provider_id}")
async def remove_provider(provider_id: str, authorization: Optional[str] = Header(None)):
    """Remove a provider (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    supabase = get_supabase()
    supabase.table("providers").delete().eq("id", provider_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# API Keys
# ---------------------------------------------------------------------------

@router.get("/keys/{account_id}")
async def list_api_keys(account_id: str, authorization: Optional[str] = Header(None)):
    """List API keys for an account (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    supabase = get_supabase()
    result = (
        supabase.table("api_keys")
        .select("id, key_prefix, key_name, scopes, allowed_models, is_active, last_used_at, created_at, expires_at")
        .eq("account_id", account_id)
        .execute()
    )
    return {"keys": result.data}


@router.post("/keys/{account_id}")
async def create_api_key(
    account_id: str,
    authorization: Optional[str] = Header(None),
    key_name: str = "default",
    scopes: Optional[list[str]] = None,
    allowed_models: Optional[list[str]] = None,
):
    """Generate a new API key for an account (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    raw_key, key_hash, key_prefix = generate_api_key()
    
    supabase = get_supabase()
    result = supabase.table("api_keys").insert({
        "account_id": account_id,
        "key_hash": key_hash,
        "key_prefix": key_prefix,
        "key_name": key_name,
        "scopes": scopes or ["chat:completion", "models:list"],
        "allowed_models": allowed_models or ["*"],
    }).execute()
    
    if result.data:
        return {
            "ok": True,
            "api_key": raw_key,  # Only shown once!
            "key_id": result.data[0]["id"],
            "key_prefix": key_prefix,
            "key_name": key_name,
        }
    raise HTTPException(status_code=500, detail="Failed to create API key")


@router.post("/keys/{key_id}/revoke")
async def revoke_api_key(key_id: str, authorization: Optional[str] = Header(None)):
    """Revoke an API key (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    supabase = get_supabase()
    supabase.table("api_keys").update({"is_active": False}).eq("id", key_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

@router.get("/accounts")
async def list_accounts(authorization: Optional[str] = Header(None)):
    """List all accounts (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    supabase = get_supabase()
    result = supabase.table("accounts").select("*").execute()
    return {"accounts": result.data}


@router.patch("/accounts/{account_id}/tier")
async def update_account_tier(
    account_id: str,
    tier: str,
    authorization: Optional[str] = Header(None),
):
    """Update an account's tier (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    if tier not in ("free", "pro", "enterprise"):
        raise HTTPException(status_code=400, detail="Invalid tier")
    
    limits = {"free": settings.free_monthly_limit, "pro": settings.pro_monthly_limit, "enterprise": 999999999}
    
    supabase = get_supabase()
    supabase.table("accounts").update({
        "tier": tier,
        "monthly_limit": limits.get(tier, 1000),
    }).eq("id", account_id).execute()
    return {"ok": True, "tier": tier}


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/stats")
async def get_stats(authorization: Optional[str] = Header(None)):
    """Get system-wide stats (admin only)."""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    
    supabase = get_supabase()
    
    providers = supabase.table("providers").select("id, health_status, total_requests, total_errors, in_flight").execute()
    accounts = supabase.table("accounts").select("id, tier, monthly_requests, monthly_limit, status").execute()
    
    active_providers = [p for p in providers.data if p["health_status"] == "active"]
    active_accounts = [a for a in accounts.data if a["status"] == "active"]
    
    return {
        "providers": {
            "total": len(providers.data),
            "active": len(active_providers),
            "total_requests": sum(p["total_requests"] for p in providers.data),
            "total_errors": sum(p["total_errors"] for p in providers.data),
        },
        "accounts": {
            "total": len(accounts.data),
            "active": len(active_accounts),
            "by_tier": {
                t: len([a for a in accounts.data if a["tier"] == t])
                for t in ("free", "pro", "enterprise")
            },
        },
    }


import asyncio
import time
import httpx

# ---------------------------------------------------------------------------
# Device Flow Polling Background Task
# ---------------------------------------------------------------------------
async def poll_device_code(device_code: str, interval: int, expires_in: int, account_label: str):
    deadline = time.time() + expires_in
    supabase = get_supabase()

    while time.time() < deadline:
        await asyncio.sleep(interval)
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    settings.nous_token_url,
                    data={
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                        "device_code": device_code,
                        "client_id": settings.nous_client_id,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    access_token = data.get("access_token")
                    refresh_token = data.get("refresh_token")
                    token_expires_in = int(data.get("expires_in", 900))

                    # Calculate proper ISO string for expires_at
                    expires_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + token_expires_in - 120))

                    supabase.table("providers").insert({
                        "account_label": account_label,
                        "access_token": access_token,
                        "refresh_token": refresh_token,
                        "token_expires_at": expires_at,
                        "health_status": "active",
                    }).execute()

                    logger.info(f"Successfully polled and added new provider for {account_label}")
                    return
                elif resp.status_code == 400:
                    err = resp.json().get("error", "")
                    if "authorization_pending" in err or "slow_down" in err:
                        continue
                    if "expired_token" in err:
                        logger.error("Device code expired while polling.")
                        return
        except Exception as e:
            logger.error(f"Error polling device code: {e}")

    logger.error("Timed out polling device code.")

@router.post("/hermes/auth")
async def start_hermes_auth(
    background_tasks: fastapi.BackgroundTasks,
    account_label: str = "unnamed",
    authorization: Optional[str] = Header(None)
):
    """Start Hermes Device Auth Flow"""
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                settings.nous_device_code_url,
                data={
                    "client_id": settings.nous_client_id,
                    "scope": settings.nous_scope,
                }
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=500, detail="Failed to get device code")

            data = resp.json()
            user_code = data["user_code"]
            device_code = data["device_code"]
            interval = int(data.get("interval", 5))
            expires_in = int(data.get("expires_in", 600))
            verification_uri = data.get("verification_uri", "https://portal.nousresearch.com/manage-subscription")
            verification_uri = f"{verification_uri}?user_code={user_code}"

            # Start background poll
            background_tasks.add_task(poll_device_code, device_code, interval, expires_in, account_label)

            return {
                "user_code": user_code,
                "verification_uri": verification_uri,
            }
    except Exception as e:
        logger.error(f"Failed starting device flow: {e}")
        raise HTTPException(status_code=500, detail=str(e))
