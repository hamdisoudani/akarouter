"""AKAROUTER API Key management endpoints for authenticated users."""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Request

from app.core.supabase import get_supabase
from app.core.router import generate_api_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/user")


@router.get("/keys")
async def list_my_keys(request: Request):
    """List API keys for the currently authenticated user."""
    auth = getattr(request.state, "auth", None)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    supabase = get_supabase()
    result = (
        supabase.table("api_keys")
        .select("id, key_prefix, key_name, scopes, is_active, last_used_at, created_at")
        .eq("account_id", auth["account_id"])
        .eq("is_active", True)
        .execute()
    )
    return {"keys": result.data}


@router.post("/keys")
async def create_my_key(
    request: Request,
    key_name: str = "default",
):
    """Create a new API key for the currently authenticated user."""
    auth = getattr(request.state, "auth", None)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    raw_key, key_hash, key_prefix = generate_api_key()
    
    supabase = get_supabase()
    result = supabase.table("api_keys").insert({
        "account_id": auth["account_id"],
        "key_hash": key_hash,
        "key_prefix": key_prefix,
        "key_name": key_name,
        "scopes": ["chat:completion", "models:list"],
        "allowed_models": ["*"],
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


@router.delete("/keys/{key_id}")
async def revoke_my_key(key_id: str, request: Request):
    """Revoke one of your API keys."""
    auth = getattr(request.state, "auth", None)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    supabase = get_supabase()
    # Verify ownership
    result = supabase.table("api_keys").select("id").eq("id", key_id).eq("account_id", auth["account_id"]).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Key not found")
    
    supabase.table("api_keys").update({"is_active": False}).eq("id", key_id).execute()
    return {"ok": True}


@router.get("/usage")
async def get_my_usage(request: Request):
    """Get usage stats for the currently authenticated user."""
    auth = getattr(request.state, "auth", None)
    if not auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    supabase = get_supabase()
    result = supabase.table("accounts").select("monthly_requests, monthly_limit, total_requests, tier").eq("id", auth["account_id"]).execute()
    
    if result.data:
        account = result.data[0]
        return {
            "tier": account["tier"],
            "monthly_requests": account["monthly_requests"],
            "monthly_limit": account["monthly_limit"],
            "total_requests": account["total_requests"],
            "remaining": account["monthly_limit"] - account["monthly_requests"],
        }
    
    raise HTTPException(status_code=404, detail="Account not found")
