"""AKAROUTER User endpoints — API keys, usage analytics, account info."""
import logging
from typing import Optional
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
import httpx

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel

from app.core.supabase import get_supabase
from app.core.router import generate_api_key
from app.core.config import settings
from app.core.rate_limit_middleware import (
    enforce_ip_rate_limit,
    rate_limit_429,
)
from app.core.recaptcha import verify_recaptcha
from app.core.cache import (
    check_and_increment_activation_rate_limit,
    evict_jwt_cache,
    evict_api_key_cache,
    calculate_account_budget,
    is_gateway_enabled,
    get_budget_cycles
)
from app.core.http_client import get_http_client

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
    recaptcha_token: str


@router.post("/keys")
async def create_my_key(request: Request, body: CreateKeyRequest):
    """Create a new API key for the currently authenticated user."""
    # SECURITY: per-IP rate limit on key creation. The token-budget
    # limiter in cache.py is per-account and protects budget. This
    # limit is per-IP and protects against an attacker with access to
    # many accounts (or a single compromised Supabase session) from
    # minting hundreds of API keys and burning through key-creation
    # rows. Capped at 5 req/min/IP.
    rl = await enforce_ip_rate_limit(request, endpoint="user.create_key")
    if not rl.allowed:
        raise rate_limit_429(rl)

    account_id = _get_user_id(request)
    
    # Block pending activation accounts
    supabase_auth = getattr(request.state, "supabase_user", None)
    if supabase_auth and supabase_auth.get("status") == "pending":
        raise HTTPException(status_code=403, detail="Account activation required")
        
    # Verify reCAPTCHA token
    is_valid = await verify_recaptcha(body.recaptcha_token)
    if not is_valid:
        raise HTTPException(status_code=400, detail="reCAPTCHA verification failed")

    key_name = body.key_name


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


class ActivateAccountRequest(BaseModel):
    code: str
    recaptcha_token: str


@router.post("/activate")
async def activate_user_account(body: ActivateAccountRequest, request: Request):
    """Activate a pending user account using an invitation code."""
    supabase_auth = getattr(request.state, "supabase_user", None)
    if not supabase_auth:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # SECURITY: per-IP rate limit. The cache.py activation rate limiter
    # is per-account; this is per-IP. An attacker with access to many
    # accounts could otherwise burn through invitation codes. Capped
    # at 5 req/min/IP.
    rl = await enforce_ip_rate_limit(request, endpoint="user.activate")
    if not rl.allowed:
        raise rate_limit_429(rl)

    account_id = supabase_auth.get("account_id")
    email = supabase_auth.get("email")
    
    # 1. Rate Limiting (max 5 activation requests per minute)
    if check_and_increment_activation_rate_limit(account_id, limit=5):
        logger.warning(f"Activation RPM rate limit exceeded for account: {account_id}")
        raise HTTPException(status_code=429, detail="Too many activation attempts. Max 5 per minute.")
        
    # 2. Verify Google reCAPTCHA v3
    is_valid = await verify_recaptcha(body.recaptcha_token)
    if not is_valid:
        raise HTTPException(status_code=400, detail="reCAPTCHA verification failed")
        
    # 3. Check current account status
    supabase = get_supabase()
    acc_res = supabase.table("accounts").select("status").eq("id", account_id).execute()
    if not acc_res.data:
        raise HTTPException(status_code=404, detail="Account not found")
        
    if acc_res.data[0]["status"] == "active":
        return {"ok": True, "message": "Account is already active"}
        
    # 4. Claim invitation code atomically using RPC function
    claim_res = supabase.rpc("claim_invitation_code", {
        "p_code": body.code.strip().upper(),
        "p_account_id": account_id
    }).execute()
    
    if not claim_res.data:
        raise HTTPException(status_code=400, detail="Invalid or inactive invitation code, or code usage limit reached")
        
    # 6. Evict JWT Cache to ensure immediate transition
    auth_header = request.headers.get("authorization", "")
    parts = auth_header.split(" ", 1)
    token = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else ""
    if token:
        evict_jwt_cache(token)
        
    logger.info(f"Account activated successfully: {email} using code: {body.code.upper()}")
    return {"ok": True, "message": "Account activated successfully"}


@router.delete("/keys/{key_id}")
async def revoke_my_key(key_id: str, request: Request):
    """Revoke one of your API keys."""
    # SECURITY: per-IP rate limit on key revocation. The previous code
    # had no throttle here — a compromised Supabase session could
    # bulk-revoke an account's keys to lock the user out (denial of
    # service) or to mask which key is stolen (revoke all the good
    # ones, attacker keeps the one they have). Capped at 5 req/min/IP.
    rl = await enforce_ip_rate_limit(request, endpoint="user.revoke_key")
    if not rl.allowed:
        raise rate_limit_429(rl)

    account_id = _get_user_id(request)
    supabase = get_supabase()

    # Verify ownership AND fetch the key_hash so we can evict the in-memory cache.
    result = supabase.table("api_keys").select("id, key_hash").eq("id", key_id).eq("account_id", account_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Key not found")

    key_hash = result.data[0]["key_hash"]

    supabase.table("api_keys").update({"is_active": False}).eq("id", key_id).execute()

    # SECURITY: evict the in-memory auth cache immediately. Without this, a revoked
    # key remains usable for up to 30s (the cache TTL) — for a security-critical
    # action like key revocation, that's a 30-second window during which a stolen
    # key still works. Evicting collapses the window to sub-millisecond.
    evict_api_key_cache(key_hash)

    # SECURITY: reset the rate-limit bucket for this key. After revocation
    # the key is dead, but a leaked key that hit the rate limit before
    # the user noticed wouldn't be cleared automatically. Resetting
    # collapses the bucket immediately, so when (or if) the user mints
    # a new key with the same id, it starts at zero usage. (New keys
    # have new ids in practice, so this is defense in depth.)
    from app.core.rate_limit import get_rate_limiter
    limiter = get_rate_limiter(request)
    if limiter is not None:
        try:
            await limiter.reset(f"chat.api_key:{key_id}", key_id)
        except Exception:
            pass  # fail-soft

    # Audit: log the revocation. The DB trigger on api_keys also fires automatically,
    # but we log explicitly here for metadata that the trigger doesn't have (request IP, UA).
    from app.core.audit import audit
    audit(
        action="key.revoke",
        target_type="api_key",
        target_id=key_id,
        metadata={"account_id": str(account_id), "key_hash_prefix": key_hash[:8] if key_hash else None},
        request=request,
    )

    return {"ok": True}


# ---------------------------------------------------------------------------
# Usage & Analytics
# ---------------------------------------------------------------------------

@router.get("/usage")
async def get_my_usage(request: Request):
    """Get usage stats for the currently authenticated user."""
    account_id = _get_user_id(request)
    supabase = get_supabase()

    # Get account info including limits and reset timestamp
    result = supabase.table("accounts").select(
        "monthly_requests, monthly_limit, total_requests, tier, role, rpm_limit, tokens_5h_limit, tokens_7d_limit, budget_reset_at, is_trialing, t1_requests_limit, t2_requests_limit, t3_requests_limit, monthly_points_remaining, monthly_points_limit, points_reset_at, daily_free_requests_remaining, daily_free_requests_reset_at"
    ).eq("id", account_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Account not found")

    account = result.data[0]
    
    # 1. Fetch budget consumption using calculate_account_budget
    now_dt = datetime.now(timezone.utc)
    budget_reset_at = account.get("budget_reset_at")
    
    budget = await calculate_account_budget(account_id, budget_reset_at)
    consumed_5h = budget["consumed_5h"]
    consumed_7d = budget["consumed_7d"]
    consumed_month = budget["consumed_month"]
    
    # Calculate cycle reset times for frontend
    bounds = get_budget_cycles(budget_reset_at, now_dt)
    cycle_5h_reset = bounds["cycle_5h_reset"]
    cycle_7d_reset = bounds["cycle_7d_reset"]
    
    next_reset_5h = max(0, int((cycle_5h_reset - now_dt).total_seconds()))
    full_reset_5h = next_reset_5h

    next_reset_7d = max(0, int((cycle_7d_reset - now_dt).total_seconds()))
    full_reset_7d = next_reset_7d

    # 2. Fetch input/output token counts since last reset
    start_dt_tokens = None
    if budget_reset_at:
        try:
            start_dt_tokens = datetime.fromisoformat(budget_reset_at.replace("Z", "+00:00"))
        except Exception:
            pass
            
    tokens_query = supabase.table("request_logs").select("prompt_tokens, completion_tokens").eq("account_id", account_id)
    if start_dt_tokens:
        tokens_query = tokens_query.gte("created_at", start_dt_tokens.isoformat())
    
    tokens_query = tokens_query.limit(1000)
    
    tokens_res = tokens_query.execute()
    
    consumed_tokens_input = 0
    consumed_tokens_output = 0
    if tokens_res and tokens_res.data:
        for log in tokens_res.data:
            consumed_tokens_input += log.get("prompt_tokens") or 0
            consumed_tokens_output += log.get("completion_tokens") or 0

    rpm_limit = account.get("rpm_limit") or 60
    tokens_5h_limit = account.get("tokens_5h_limit") or 1.0
    tokens_7d_limit = account.get("tokens_7d_limit") or 5.0
    monthly_limit = account.get("monthly_limit") or 10.0
    
    progress_percentage_5h = min(100.0, round((consumed_5h / tokens_5h_limit) * 100.0, 2)) if tokens_5h_limit > 0 else 0.0
    progress_percentage_7d = min(100.0, round((consumed_7d / tokens_7d_limit) * 100.0, 2)) if tokens_7d_limit > 0 else 0.0
    progress_percentage_month = min(100.0, round((consumed_month / monthly_limit) * 100.0, 2)) if monthly_limit > 0 else 0.0
    remaining_percentage_month = max(0.0, 100.0 - progress_percentage_month)

    gateway_enabled = is_gateway_enabled()

    return {
        "tier": account["tier"],
        "role": account.get("role", "user"),
        "monthly_requests": account["monthly_requests"],
        "monthly_limit": monthly_limit,
        "total_requests": account["total_requests"],
        "remaining": max(0.0, monthly_limit - consumed_month),
        "rpm_limit": rpm_limit,
        "tokens_5h_limit": tokens_5h_limit,
        "tokens_7d_limit": tokens_7d_limit,
        "consumed_tokens_input": consumed_tokens_input,
        "consumed_tokens_output": consumed_tokens_output,
        "consumed_budget_5h": round(consumed_5h, 6),
        "consumed_budget_7d": round(consumed_7d, 6),
        "consumed_budget_month": round(consumed_month, 6),
        "progress_percentage_5h": progress_percentage_5h,
        "progress_percentage_7d": progress_percentage_7d,
        "progress_percentage_month": progress_percentage_month,
        "remaining_percentage_month": remaining_percentage_month,
        "gateway_enabled": gateway_enabled,
        "next_reset_5h": next_reset_5h,
        "full_reset_5h": full_reset_5h,
        "next_reset_7d": next_reset_7d,
        "full_reset_7d": full_reset_7d,
        "is_trialing": account.get("is_trialing", False),
        "t1_requests_limit": account.get("t1_requests_limit", 0),
        "t2_requests_limit": account.get("t2_requests_limit", 0),
        "t3_requests_limit": account.get("t3_requests_limit", 0),
        "monthly_points_remaining": account.get("monthly_points_remaining", 0),
        "monthly_points_limit": account.get("monthly_points_limit", 0),
        "points_reset_at": account.get("points_reset_at"),
        "daily_free_requests_remaining": account.get("daily_free_requests_remaining", 0),
        "daily_free_requests_reset_at": account.get("daily_free_requests_reset_at"),
    }


@router.get("/point-transactions")
async def get_my_point_transactions(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    kind: str | None = None,
):
    """Point transaction history for the authenticated user.

    Each row is one charge / refund / grant event. Used for the /usage page
    history panel. Returns up to `limit` rows (default 50, max 200), sorted
    by created_at DESC.
    """
    account_id = _get_user_id(request)
    if not account_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Clamp limit to [1, 200]
    limit = max(1, min(200, limit))
    offset = max(0, offset)

    supabase = get_supabase()
    q = (
        supabase.table("point_transactions")
        .select("id, points, kind, reason, model_alias, balance_after, created_by, metadata, created_at")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if kind and kind in ("charge", "refund", "grant", "adjustment"):
        q = q.eq("kind", kind)

    result = q.execute()
    rows = result.data or []

    # Get total count for pagination
    count_q = supabase.table("point_transactions").select("id", count="exact").eq("account_id", account_id)
    if kind and kind in ("charge", "refund", "grant", "adjustment"):
        count_q = count_q.eq("kind", kind)
    count_res = count_q.execute()
    total = count_res.count or 0

    # Sum by kind for the visible window (useful for "spent X this period")
    spent = 0
    refunded = 0
    granted = 0
    for r in rows:
        if r["kind"] == "charge":
            spent += r["points"]
        elif r["kind"] == "refund":
            refunded += r["points"]
        elif r["kind"] == "grant":
            granted += r["points"]

    return {
        "transactions": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + limit) < total,
        "summary": {
            "spent": spent,
            "refunded": refunded,
            "granted": granted,
        },
    }


@router.get("/analytics")
async def get_my_analytics(
    request: Request,
    days: int = 30,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Get per-model usage analytics for the currently authenticated user."""
    account_id = _get_user_id(request)
    supabase = get_supabase()

    query = supabase.table("request_logs").select(
        "model, upstream_model, status_code, latency_ms, prompt_tokens, completion_tokens, total_tokens, created_at"
    ).eq("account_id", account_id)
    
    if start_date:
        query = query.gte("created_at", start_date)
    elif days:
        filter_date = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.gte("created_at", filter_date.isoformat())
        
    if end_date:
        query = query.lte("created_at", end_date)

    result = query.order("created_at", desc=True).limit(1000).execute()

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
        status_code = log.get("status_code", 200)
        if status_code and status_code < 400:
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
        "recent_logs": logs[:100],
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


async def resolve_whop_id_to_plan_id(whop_id: str) -> str:
    """If whop_id starts with prod_, fetch company plans and resolve to its plan ID."""
    if not whop_id or not whop_id.startswith("prod_"):
        return whop_id

    try:
        client = get_http_client()
        res = await client.get(
            "https://api.whop.com/v1/plans",
            headers={"Authorization": f"Bearer {settings.whop_api_key}"},
            params={"company_id": settings.whop_company_id},
            timeout=10.0
        )
        if res.status_code == 200:
            plans_data = res.json().get("data", [])
            for plan in plans_data:
                p_id = plan.get("id")
                prod = plan.get("product", {}) or {}
                prod_id = prod.get("id")
                if prod_id == whop_id:
                    logger.info(f"Resolved product {whop_id} to plan ID: {p_id}")
                    return p_id
    except Exception as e:
        logger.error(f"Failed to resolve product ID {whop_id} to plan ID: {e}")
        
    return whop_id


class CheckoutSessionRequest(BaseModel):
    tier: str  # starter, pro, ultra
    redirect_url: Optional[str] = None


@router.post("/checkout-session")
async def create_checkout_session(request: Request, body: CheckoutSessionRequest):
    """
    Generate a Whop checkout link pre-loaded with the user's account ID.
    """
    account_id = _get_user_id(request)
    
    tier = body.tier.lower()
    plan_id = ""
    if tier == "starter":
        plan_id = settings.whop_plan_starter
    elif tier == "pro":
        plan_id = settings.whop_plan_pro
    elif tier == "ultra":
        plan_id = settings.whop_plan_ultra
    
    if not plan_id:
        if body.tier.startswith("plan_") or body.tier.startswith("prod_"):
            plan_id = body.tier
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Subscription tier '{body.tier}' is not configured on the backend"
            )

    if not settings.whop_api_key:
        raise HTTPException(status_code=500, detail="Whop API Key is not configured on the backend")

    # Resolve product ID to plan ID if needed
    resolved_plan_id = await resolve_whop_id_to_plan_id(plan_id)

    redirect_url = body.redirect_url
    if not redirect_url:
        origin = request.headers.get("origin")
        referer = request.headers.get("referer")
        if origin:
            redirect_url = f"{origin}/dashboard"
        elif referer:
            parsed = urlparse(referer)
            redirect_url = f"{parsed.scheme}://{parsed.netloc}/dashboard"
        else:
            redirect_url = "https://akarouter.com/usage"  # Fallback

    # Enforce redirect URL allowlist to prevent open redirect attacks
    ALLOWED_REDIRECT_HOSTS = {
        "akarouter.com",
        "www.akarouter.com",
        "akarouter.dev",
        "akarouter-frontend-production.up.railway.app",
        "localhost",
    }
    try:
        parsed_redirect = urlparse(redirect_url)
        if parsed_redirect.hostname not in ALLOWED_REDIRECT_HOSTS:
            redirect_url = "https://akarouter.com/usage"
    except Exception:
        redirect_url = "https://akarouter.com/usage"

    try:
        client = get_http_client()
        response = await client.post(
            "https://api.whop.com/v1/checkout_configurations",
            headers={"Authorization": f"Bearer {settings.whop_api_key}"},
            json={
                "plan_id": resolved_plan_id,
                "metadata": {"account_id": account_id},
                "redirect_url": redirect_url
            },
            timeout=10.0
        )
        if response.status_code >= 400:
            logger.error(f"Whop Checkout API error: {response.status_code} {response.text}")
            raise HTTPException(status_code=response.status_code, detail="Whop Checkout creation failed")
        
        session_data = response.json()
        checkout_url = session_data.get("purchase_url")
        if not checkout_url:
            checkout_url = f"https://whop.com/checkout/{resolved_plan_id}?session={session_data['id']}"
            
        return {"checkout_url": checkout_url}
    except httpx.RequestError as exc:
        logger.error(f"Connection error calling Whop API: {exc}")
        raise HTTPException(status_code=503, detail="Whop API is currently unreachable")
