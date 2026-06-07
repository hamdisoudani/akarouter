"""AKAROUTER User endpoints — API keys, usage analytics, account info."""
import logging
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel

from app.core.supabase import get_supabase
from app.core.router import generate_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user")


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _get_user_id(request: Request) -> str:
    """Extract Supabase user ID from request.state (set by auth middleware)."""
    auth = getattr(request.state, "auth", None)
    if auth and "account_id" in auth:
        return auth["account_id"]
    # Try Supabase JWT auth
    supabase_auth = getattr(request.state, "supabase_user", None)
    if supabase_auth:
        return supabase_auth.get("account_id", "")
    raise HTTPException(status_code=401, detail="Not authenticated")


def _get_user_role(request: Request) -> str:
    """Get the user's role (user/admin)."""
    supabase_auth = getattr(request.state, "supabase_user", None)
    if supabase_auth:
        return supabase_auth.get("role", "user")
    return "user"


# ---------------------------------------------------------------------------
# API Key Management
# ---------------------------------------------------------------------------

@router.get("/keys")
async def list_my_keys(request: Request):
    """List API keys for the currently authenticated user."""
    account_id = _get_user_id(request)
    supabase = get_supabase()
    result = (
        supabase.table("api_keys")
        .select("id, key_prefix, key_name, scopes, is_active, last_used_at, created_at")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .execute()
    )
    return {"keys": result.data}


class CreateKeyRequest(BaseModel):
    key_name: str = "default"


@router.post("/keys")
async def create_my_key(request: Request, body: CreateKeyRequest | None = None):
    """Create a new API key for the currently authenticated user."""
    account_id = _get_user_id(request)
    key_name = body.key_name if body else "default"

    raw_key, key_hash, key_prefix = generate_api_key()
    supabase = get_supabase()
    result = supabase.table("api_keys").insert({
        "account_id": account_id,
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
    account_id = _get_user_id(request)
    supabase = get_supabase()

    # Verify ownership
    result = supabase.table("api_keys").select("id").eq("id", key_id).eq("account_id", account_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Key not found")

    supabase.table("api_keys").update({"is_active": False}).eq("id", key_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Usage & Analytics
# ---------------------------------------------------------------------------

@router.get("/usage")
async def get_my_usage(request: Request):
    """Get usage stats for the currently authenticated user."""
    account_id = _get_user_id(request)
    supabase = get_supabase()

    # Get account info
    result = supabase.table("accounts").select(
        "monthly_requests, monthly_limit, total_requests, tier, role"
    ).eq("id", account_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Account not found")

    account = result.data[0]
    return {
        "tier": account["tier"],
        "role": account.get("role", "user"),
        "monthly_requests": account["monthly_requests"],
        "monthly_limit": account["monthly_limit"],
        "total_requests": account["total_requests"],
        "remaining": max(0, account["monthly_limit"] - account["monthly_requests"]),
    }


@router.get("/analytics")
async def get_my_analytics(request: Request):
    """Get per-model usage analytics for the currently authenticated user."""
    account_id = _get_user_id(request)
    supabase = get_supabase()

    # Get all request logs for this user
    result = supabase.table("request_logs").select(
        "model, upstream_model, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, created_at"
    ).eq("account_id", account_id).order("created_at", desc=True).limit(1000).execute()

    logs = result.data or []

    # Aggregate by model
    model_stats: dict[str, dict] = {}
    for log in logs:
        model = log.get("model", "unknown")
        if model not in model_stats:
            model_stats[model] = {
                "model": model,
                "total_requests": 0,
                "successful_requests": 0,
                "error_requests": 0,
                "total_prompt_tokens": 0,
                "total_completion_tokens": 0,
                "total_tokens": 0,
                "avg_latency_ms": 0,
                "_latency_sum": 0,
                "_latency_count": 0,
            }
        stats = model_stats[model]
        stats["total_requests"] += 1
        if log.get("status") == "success":
            stats["successful_requests"] += 1
        else:
            stats["error_requests"] += 1
        stats["total_prompt_tokens"] += log.get("prompt_tokens", 0) or 0
        stats["total_completion_tokens"] += log.get("completion_tokens", 0) or 0
        stats["total_tokens"] += log.get("total_tokens", 0) or 0
        latency = log.get("latency_ms", 0) or 0
        if latency:
            stats["_latency_sum"] += latency
            stats["_latency_count"] += 1

    # Compute averages
    for stats in model_stats.values():
        if stats["_latency_count"] > 0:
            stats["avg_latency_ms"] = round(stats["_latency_sum"] / stats["_latency_count"])
        del stats["_latency_sum"]
        del stats["_latency_count"]

    return {
        "models": list(model_stats.values()),
        "total_logs": len(logs),
    }


# ---------------------------------------------------------------------------
# Account Info (for frontend auth check)
# ---------------------------------------------------------------------------

@router.get("/me")
async def get_me(request: Request):
    """Get current user info — used by frontend to check auth + role."""
    supabase_auth = getattr(request.state, "supabase_user", None)
    if not supabase_auth:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return supabase_auth
