"""Admin endpoints for managing providers, API keys, and OAuth flow."""
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, BackgroundTasks
from app.core.config import settings
from app.core.supabase import get_supabase, _verify_supabase_jwt
from app.core.router import generate_api_key, hash_api_key, KEY_PREFIX
from app.core.oauth import (
    initiate_device_code,
    poll_device_token,
    complete_oauth_flow,
    refresh_provider_token,
    refresh_expiring_providers,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin")

def _verify_admin(authorization: Optional[str]) -> bool:
    if not authorization:
        return False
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return False
    token = parts[1].strip()
    
    # SECURITY: The dev backdoor that accepted the Supabase service-role key as an admin
    # bearer token has been REMOVED. Service-role keys are god-mode for the entire Supabase
    # project (bypasses RLS, can read/write any table, can mint admin JWTs). One leak or one
    # mis-set AKAROUTER_APP_ENV would have made every /admin/* endpoint accessible with that
    # key. For local development, set AKAROUTER_ADMIN_DEV_TOKEN to a high-entropy random
    # string and use that as the Authorization: Bearer header. The dev token is checked
    # ONLY when app_env == "development" AND is independent of any database credentials.
    if settings.app_env == "development" and settings.admin_dev_token:
        # Constant-time comparison to avoid timing attacks
        import hmac as _hmac
        if _hmac.compare_digest(token, settings.admin_dev_token):
            return True

    # Verify Supabase JWT and check for admin role
    if token.startswith("eyJ"):
        try:
            user_info = _verify_supabase_jwt(token)
            if user_info and user_info.get("role") == "admin":
                return True
        except Exception as exc:
            logger.error("Admin verification error: %s", exc)

    return False


@router.get("/providers")
async def list_providers(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    result = supabase.table("providers").select(
        "id, account_label, health_status, weight, total_requests, total_errors, in_flight, max_concurrent, last_used_at, last_error_at, last_error_msg, created_at, updated_at"
    ).execute()
    return {"providers": result.data}


# OAuth flows are tracked in a module-level dict for simplicity.
_active_oauth_flows: dict[str, dict] = {}


@router.post("/providers/oauth/initiate")
async def oauth_initiate(account_label: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    try:
        device_info = await initiate_device_code()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OAuth failed: {e}")
    flow_id = device_info["device_code"]
    _active_oauth_flows[flow_id] = {
        "device_code": device_info["device_code"],
        "user_code": device_info["user_code"],
        "verification_uri": device_info["verification_uri"],
        "verification_uri_complete": device_info["verification_uri_complete"],
        "expires_in": device_info["expires_in"],
        "interval": device_info["interval"],
        "account_label": account_label,
        "status": "pending",
        "result": None,
        "error": None,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    return {
        "ok": True,
        "flow_id": flow_id,
        "user_code": device_info["user_code"],
        "verification_uri": device_info["verification_uri"],
        "verification_uri_complete": device_info["verification_uri_complete"],
        "expires_in": device_info["expires_in"],
    }


@router.post("/providers/oauth/poll/{flow_id}")
async def oauth_poll(flow_id: str, background_tasks: BackgroundTasks, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    flow = _active_oauth_flows.get(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="OAuth flow not found")
    if flow["status"] not in ("pending",):
        return {"ok": True, "status": flow["status"]}
    flow["status"] = "polling"
    background_tasks.add_task(_background_poll_oauth, flow_id)
    return {"ok": True, "flow_id": flow_id, "status": "polling"}


async def _background_poll_oauth(flow_id: str):
    flow = _active_oauth_flows.get(flow_id)
    if not flow:
        return
    try:
        token_data = await poll_device_token(
            device_code=flow["device_code"],
            expires_in=flow["expires_in"],
            poll_interval=flow["interval"],
        )
        expires_in_seconds = token_data.get("expires_in", 3600)
        expires_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + expires_in_seconds,
            tz=timezone.utc
        ).isoformat()
        supabase = get_supabase()
        result = supabase.table("providers").insert({
            "account_label": flow["account_label"],
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token", ""),
            "token_expires_at": expires_at,
            "token_scope": token_data.get("scope", settings.nous_scope),
            "health_status": "active",
            "weight": 1.0,
            "total_requests": 0,
            "total_errors": 0,
            "in_flight": 0,
            "max_concurrent": settings.max_concurrent_per_account,
        }).execute()
        if result.data:
            flow["status"] = "authorized"
            flow["result"] = {
                "provider_id": result.data[0]["id"],
                "account_label": flow["account_label"],
                "access_token_preview": token_data["access_token"][:20] + "...",
                "refresh_token_preview": token_data.get("refresh_token", "")[:10] + "...",
                "expires_at": expires_at,
                "scope": token_data.get("scope", ""),
            }
            logger.info(f"OAuth flow {flow_id} completed -> provider {flow['account_label']}")
        else:
            flow["status"] = "failed"
            flow["error"] = "Failed to save provider"
    except TimeoutError:
        flow["status"] = "timeout"
        flow["error"] = "Device authorization timed out"
    except Exception as e:
        flow["status"] = "failed"
        flow["error"] = str(e)
        logger.error(f"OAuth flow {flow_id} failed: {e}")


@router.get("/providers/oauth/status/{flow_id}")
async def oauth_status(flow_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    flow = _active_oauth_flows.get(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="OAuth flow not found")
    return {
        "flow_id": flow_id,
        "account_label": flow["account_label"],
        "status": flow["status"],
        "user_code": flow["user_code"],
        "verification_uri": flow["verification_uri"],
        "verification_uri_complete": flow["verification_uri_complete"],
        "result": flow.get("result"),
        "error": flow.get("error"),
        "started_at": flow.get("started_at"),
    }


@router.get("/providers/oauth/flows")
async def list_oauth_flows(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    return {
        "flows": [
            {
                "flow_id": fid,
                "account_label": f["account_label"],
                "status": f["status"],
                "user_code": f["user_code"],
                "verification_uri": f["verification_uri"],
                "started_at": f.get("started_at"),
                "error": f.get("error"),
            }
            for fid, f in _active_oauth_flows.items()
        ]
    }


@router.post("/providers/{provider_id}/refresh")
async def refresh_token(provider_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    try:
        return await refresh_provider_token(provider_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Refresh failed: {e}")


@router.post("/providers/refresh-all")
async def refresh_all_providers(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    results = await refresh_expiring_providers()
    return {"ok": True, "refreshed": results}


@router.patch("/providers/{provider_id}")
async def update_provider(provider_id: str, authorization: Optional[str] = Header(None), account_label: Optional[str] = None, weight: Optional[float] = None, max_concurrent: Optional[int] = None, health_status: Optional[str] = None):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    updates = {}
    if account_label is not None: updates["account_label"] = account_label
    if weight is not None: updates["weight"] = weight
    if max_concurrent is not None: updates["max_concurrent"] = max_concurrent
    if health_status is not None:
        if health_status not in ("active", "degraded", "dead", "refreshing"):
            raise HTTPException(status_code=400, detail="Invalid health_status")
        updates["health_status"] = health_status
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    get_supabase().table("providers").update(updates).eq("id", provider_id).execute()
    return {"ok": True}


@router.post("/providers")
async def add_provider(account_label: str, access_token: str, refresh_token: str, token_expires_at: str, authorization: Optional[str] = Header(None), weight: float = 1.0, max_concurrent: int = 12):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    result = get_supabase().table("providers").insert({
        "account_label": account_label,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expires_at": token_expires_at,
        "weight": weight,
        "max_concurrent": max_concurrent,
    }).execute()
    if result.data: return {"ok": True, "provider": result.data[0]}
    raise HTTPException(status_code=500, detail="Failed to add provider")


@router.delete("/providers/{provider_id}")
async def remove_provider(provider_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    get_supabase().table("providers").delete().eq("id", provider_id).execute()
    return {"ok": True}


@router.get("/keys/{account_id}")
async def list_api_keys(account_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    result = get_supabase().table("api_keys").select("id, key_prefix, key_name, scopes, allowed_models, is_active, last_used_at, created_at, expires_at").eq("account_id", account_id).execute()
    return {"keys": result.data}


@router.post("/keys/{account_id}")
async def create_api_key(account_id: str, authorization: Optional[str] = Header(None), key_name: str = "default", scopes: Optional[list[str]] = None, allowed_models: Optional[list[str]] = None):
    if not _verify_admin(authorization): raise HTTPException(status_code=401, detail="Admin access required")
    raw_key, key_hash, key_prefix = generate_api_key()
    result = get_supabase().table("api_keys").insert({
        "account_id": account_id,
        "key_hash": key_hash,
        "key_prefix": key_prefix,
        "key_name": key_name,
        "scopes": scopes or ["chat:completion", "models:list"],
        "allowed_models": allowed_models or ["*"],
    }).execute()
    if result.data:
        return {"ok": True, "api_key": raw_key, "key_id": result.data[0]["id"], "key_prefix": key_prefix, "key_name": key_name}
    raise HTTPException(status_code=500, detail="Failed to create API key")


@router.post("/keys/{key_id}/revoke")
async def revoke_api_key(key_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization): raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    # Fetch key_hash first so we can evict the in-memory auth cache immediately.
    # SECURITY: without this, a revoked key remains usable for up to 30s.
    key_res = supabase.table("api_keys").select("key_hash, account_id").eq("id", key_id).execute()
    supabase.table("api_keys").update({"is_active": False}).eq("id", key_id).execute()
    if key_res.data:
        from app.core.cache import evict_api_key_cache, evict_account_caches
        evict_api_key_cache(key_res.data[0]["key_hash"])
        # Also evict any account-scoped caches for safety
        if key_res.data[0].get("account_id"):
            evict_account_caches(key_res.data[0]["account_id"])
    return {"ok": True}


from pydantic import BaseModel

class UpdateAccountRequest(BaseModel):
    tier: Optional[str] = None
    monthly_limit: Optional[float] = None
    status: Optional[str] = None
    suspended_reason: Optional[str] = None
    role: Optional[str] = None
    display_name: Optional[str] = None
    rpm_limit: Optional[int] = None
    tokens_5h_limit: Optional[float] = None
    tokens_7d_limit: Optional[float] = None
    monthly_point_allowance: Optional[int] = None
    daily_free_requests_limit: Optional[int] = None

class CreatePlanRequest(BaseModel):
    tier: str
    monthly_limit: float
    rpm_limit: Optional[int] = 60
    tokens_5h_limit: Optional[float] = 1.0
    tokens_7d_limit: Optional[float] = 5.0
    monthly_point_allowance: Optional[int] = 0
    daily_free_requests_limit: Optional[int] = 0
    price: Optional[str] = "$0"
    billing_period: Optional[str] = "mo"
    description: Optional[str] = ""
    badge: Optional[str] = ""
    has_trial: Optional[bool] = False
    trial_days: Optional[int] = 7
    monthly_requests_limit: Optional[int] = None

class UpdatePlanRequest(BaseModel):
    tier: Optional[str] = None
    monthly_limit: Optional[float] = None
    rpm_limit: Optional[int] = None
    tokens_5h_limit: Optional[float] = None
    tokens_7d_limit: Optional[float] = None
    monthly_point_allowance: Optional[int] = None
    daily_free_requests_limit: Optional[int] = None
    price: Optional[str] = None
    billing_period: Optional[str] = None
    description: Optional[str] = None
    badge: Optional[str] = None
    has_trial: Optional[bool] = None
    trial_days: Optional[int] = None
    monthly_requests_limit: Optional[int] = None

class UpdateSettingsRequest(BaseModel):
    gateway_enabled: Optional[bool] = None
    require_activation: Optional[bool] = None

class CreateInvitationRequest(BaseModel):
    code: Optional[str] = None
    max_uses: Optional[int] = 1

class UpdateInvitationRequest(BaseModel):
    max_uses: Optional[int] = None
    is_active: Optional[bool] = None

class UpdateModelRequest(BaseModel):
    is_active: Optional[bool] = None
    input_cost_per_million: Optional[float] = None
    output_cost_per_million: Optional[float] = None
    pricing_mode: Optional[str] = None           # 'per_token' | 'per_request'
    cost_per_request_cents: Optional[int] = None  # only meaningful when pricing_mode='per_request'
    points_cost: Optional[int] = None             # per-call point cost (0-1000), admin-editable

def get_user_consumptions(account_ids: Optional[list[str]] = None) -> dict[str, dict]:
    """Retrieve aggregate consumption stats grouped by account_id, optionally filtered by account_ids."""
    import psycopg2
    if account_ids is not None and not account_ids:
        return {}
    try:
        conn = psycopg2.connect(settings.supabase_db_url)
        cur = conn.cursor()
        if account_ids:
            placeholders = ", ".join(["%s"] * len(account_ids))
            cur.execute(f"""
                SELECT account_id, 
                       SUM(prompt_tokens) as total_prompt_tokens, 
                       SUM(completion_tokens) as total_completion_tokens, 
                       SUM(cost) as total_cost,
                       COUNT(*) as request_count
                FROM request_logs
                WHERE account_id IN ({placeholders})
                GROUP BY account_id
            """, account_ids)
        else:
            cur.execute("""
                SELECT account_id, 
                       SUM(prompt_tokens) as total_prompt_tokens, 
                       SUM(completion_tokens) as total_completion_tokens, 
                       SUM(cost) as total_cost,
                       COUNT(*) as request_count
                FROM request_logs
                GROUP BY account_id
            """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {
            row[0]: {
                "prompt_tokens": row[1] or 0,
                "completion_tokens": row[2] or 0,
                "total_tokens": (row[1] or 0) + (row[2] or 0),
                "cost": float(row[3] or 0.0),
                "request_count": row[4] or 0,
                "million_tokens": round(((row[1] or 0) + (row[2] or 0)) / 1000000.0, 4)
            }
            for row in rows if row[0]
        }
    except Exception as e:
        logger.error(f"Failed to fetch user consumptions: {e}")
        return {}

def get_global_telemetry() -> dict:
    """Retrieve system-wide aggregate token telemetry stats."""
    import psycopg2
    try:
        conn = psycopg2.connect(settings.supabase_db_url)
        cur = conn.cursor()
        cur.execute("""
            SELECT SUM(prompt_tokens) as total_prompt_tokens, 
                   SUM(completion_tokens) as total_completion_tokens, 
                   SUM(cost) as total_cost,
                   COUNT(*) as request_count
            FROM request_logs
        """)
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            prompt_tokens = row[0] or 0
            completion_tokens = row[1] or 0
            total_tokens = prompt_tokens + completion_tokens
            cost = float(row[2] or 0.0)
            request_count = row[3] or 0
            return {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "total_consumed_million_tokens": round(total_tokens / 1000000.0, 4),
                "total_cost": cost,
                "request_count": request_count
            }
        return {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "total_consumed_million_tokens": 0.0,
            "total_cost": 0.0,
            "request_count": 0
        }
    except Exception as e:
        logger.error(f"Failed to fetch global telemetry: {e}")
        return {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "total_consumed_million_tokens": 0.0,
            "total_cost": 0.0,
            "request_count": 0
        }

@router.get("/accounts")
async def list_accounts(
    search: Optional[str] = None, 
    limit: int = 50, 
    offset: int = 0, 
    authorization: Optional[str] = Header(None)
):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    # Get total count (for pagination)
    count_query = supabase.table("accounts").select("id", count="exact")
    if search:
        count_query = count_query.or_(f"email.ilike.%{search}%,display_name.ilike.%{search}%")
    count_res = count_query.execute()
    total_count = count_res.count if count_res.count is not None else 0
    
    # Get paginated data
    query = supabase.table("accounts").select("*")
    if search:
        query = query.or_(f"email.ilike.%{search}%,display_name.ilike.%{search}%")
    result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    
    # Enrich with user consumption stats for only displayed accounts
    account_ids = [acc["id"] for acc in result.data]
    consumptions = get_user_consumptions(account_ids)
    
    accounts = []
    for acc in result.data:
        acc_id = acc["id"]
        stats = consumptions.get(acc_id, {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost": 0.0,
            "request_count": 0,
            "million_tokens": 0.0
        })
        acc["consumption"] = stats
        accounts.append(acc)
        
    return {"accounts": accounts, "total": total_count}

@router.patch("/accounts/{account_id}")
async def update_account(account_id: str, body: UpdateAccountRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    # Check if account exists
    check_res = supabase.table("accounts").select("id").eq("id", account_id).execute()
    if not check_res.data:
        raise HTTPException(status_code=404, detail="Account not found")
        
    updates = {}
    if body.tier is not None:
        updates["tier"] = body.tier
    if body.monthly_limit is not None:
        updates["monthly_limit"] = body.monthly_limit
    if body.status is not None:
        if body.status not in ("active", "suspended", "cancelled"):
            raise HTTPException(status_code=400, detail="Invalid status")
        updates["status"] = body.status
    if body.suspended_reason is not None:
        updates["suspended_reason"] = body.suspended_reason
    if body.role is not None:
        if body.role not in ("user", "admin"):
            raise HTTPException(status_code=400, detail="Invalid role")
        updates["role"] = body.role
    if body.display_name is not None:
        updates["display_name"] = body.display_name
        
    if body.rpm_limit is not None:
        updates["rpm_limit"] = body.rpm_limit
    if body.tokens_5h_limit is not None:
        updates["tokens_5h_limit"] = body.tokens_5h_limit
    if body.tokens_7d_limit is not None:
        updates["tokens_7d_limit"] = body.tokens_7d_limit

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
        
    result = supabase.table("accounts").update(updates).eq("id", account_id).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update account")
        
    # Evict local cache immediately
    from app.core.cache import evict_account_caches
    evict_account_caches(account_id)
    
    return {"ok": True, "account": result.data[0]}

@router.patch("/accounts/{account_id}/tier")
async def update_account_tier(account_id: str, tier: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    plan_res = supabase.table("plan_presets").select("monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit, monthly_requests_limit").eq("tier", tier).execute()
    limit = 1000
    rpm_limit = 60
    tokens_5h_limit = 1.0
    tokens_7d_limit = 5.0
    monthly_requests_limit = None

    if plan_res.data:
        plan = plan_res.data[0]
        limit = plan.get("monthly_limit", 1000)
        rpm_limit = plan.get("rpm_limit", 60)
        tokens_5h_limit = plan.get("tokens_5h_limit", 1.0)
        tokens_7d_limit = plan.get("tokens_7d_limit", 5.0)
        monthly_requests_limit = plan.get("monthly_requests_limit")
    else:
        limits = {"free": 1000, "pro": 10000, "enterprise": 999999999}
        limit = limits.get(tier, 1000)
        if tier == "pro":
            rpm_limit = 300
            tokens_5h_limit = 10.0
            tokens_7d_limit = 50.0
        elif tier == "enterprise":
            rpm_limit = 3000
            tokens_5h_limit = 100.0
            tokens_7d_limit = 500.0

    update_payload = {
        "tier": tier,
        "monthly_limit": limit,
        "rpm_limit": rpm_limit,
        "tokens_5h_limit": tokens_5h_limit,
        "tokens_7d_limit": tokens_7d_limit,
    }
    if monthly_requests_limit is not None:
        update_payload["monthly_requests_limit"] = monthly_requests_limit

    supabase.table("accounts").update(update_payload).eq("id", account_id).execute()
    
    # Evict local cache immediately
    from app.core.cache import evict_account_caches
    evict_account_caches(account_id)
    
    return {"ok": True, "tier": tier}


@router.post("/accounts/{account_id}/reset-budget")
async def reset_account_budget(account_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    # Check if account exists
    check_res = supabase.table("accounts").select("id").eq("id", account_id).execute()
    if not check_res.data:
        raise HTTPException(status_code=404, detail="Account not found")
        
    now_iso = datetime.now(timezone.utc).isoformat()
    result = supabase.table("accounts").update({
        "budget_reset_at": now_iso
    }).eq("id", account_id).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to reset budget")
        
    # Evict local cache immediately
    from app.core.cache import evict_account_caches
    evict_account_caches(account_id)
    
    return {"ok": True, "budget_reset_at": now_iso}

# Plan Presets CRUD Endpoints
@router.get("/plans")
async def list_plans(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    result = get_supabase().table("plan_presets").select("*").order("tier").execute()
    return {"plans": result.data}

@router.post("/plans")
async def create_plan(body: CreatePlanRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    exist_res = supabase.table("plan_presets").select("id").eq("tier", body.tier).execute()
    if exist_res.data:
        raise HTTPException(status_code=400, detail=f"Plan preset with tier '{body.tier}' already exists")
        
    result = supabase.table("plan_presets").insert({
        "tier": body.tier,
        "monthly_limit": body.monthly_limit,
        "rpm_limit": body.rpm_limit,
        "tokens_5h_limit": body.tokens_5h_limit,
        "tokens_7d_limit": body.tokens_7d_limit,
        "monthly_point_allowance": body.monthly_point_allowance,
        "daily_free_requests_limit": body.daily_free_requests_limit,
        "price": body.price,
        "billing_period": body.billing_period,
        "description": body.description,
        "badge": body.badge,
        "has_trial": body.has_trial,
        "trial_days": body.trial_days,
        "monthly_requests_limit": body.monthly_requests_limit,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create plan preset")
    return {"ok": True, "plan": result.data[0]}

@router.patch("/plans/{plan_id}")
async def update_plan(plan_id: str, body: UpdatePlanRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    check_res = supabase.table("plan_presets").select("id, tier").eq("id", plan_id).execute()
    if not check_res.data:
        raise HTTPException(status_code=404, detail="Plan preset not found")
        
    plan_tier = check_res.data[0]["tier"]
        
    updates = {}
    if body.tier is not None:
        conflict_res = supabase.table("plan_presets").select("id").eq("tier", body.tier).neq("id", plan_id).execute()
        if conflict_res.data:
            raise HTTPException(status_code=400, detail=f"Plan preset with tier '{body.tier}' already exists")
        updates["tier"] = body.tier
    if body.monthly_limit is not None:
        updates["monthly_limit"] = body.monthly_limit
    if body.rpm_limit is not None:
        updates["rpm_limit"] = body.rpm_limit
    if body.tokens_5h_limit is not None:
        updates["tokens_5h_limit"] = body.tokens_5h_limit
    if body.tokens_7d_limit is not None:
        updates["tokens_7d_limit"] = body.tokens_7d_limit
    if body.monthly_point_allowance is not None:
        updates["monthly_point_allowance"] = max(0, int(body.monthly_point_allowance))
    if body.daily_free_requests_limit is not None:
        updates["daily_free_requests_limit"] = max(0, int(body.daily_free_requests_limit))
    if body.price is not None:
        updates["price"] = body.price
    if body.billing_period is not None:
        updates["billing_period"] = body.billing_period
    if body.description is not None:
        updates["description"] = body.description
    if body.badge is not None:
        updates["badge"] = body.badge
    if body.has_trial is not None:
        updates["has_trial"] = body.has_trial
    if body.trial_days is not None:
        updates["trial_days"] = body.trial_days
    if body.monthly_requests_limit is not None:
        updates["monthly_requests_limit"] = body.monthly_requests_limit
        
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
        
    result = supabase.table("plan_presets").update(updates).eq("id", plan_id).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update plan preset")
        
    # Propagate limits to all users within that plan tier
    account_updates = {}
    if body.monthly_limit is not None:
        account_updates["monthly_limit"] = body.monthly_limit
    if body.rpm_limit is not None:
        account_updates["rpm_limit"] = body.rpm_limit
    if body.tokens_5h_limit is not None:
        account_updates["tokens_5h_limit"] = body.tokens_5h_limit
    if body.tokens_7d_limit is not None:
        account_updates["tokens_7d_limit"] = body.tokens_7d_limit
    if body.monthly_point_allowance is not None:
        account_updates["monthly_points_limit"] = body.monthly_point_allowance
    if body.daily_free_requests_limit is not None:
        # daily_free_requests_remaining will be reset on next request via the SQL function
        pass
    if body.monthly_requests_limit is not None:
        account_updates["monthly_requests_limit"] = body.monthly_requests_limit
        
    if account_updates:
        try:
            supabase.table("accounts").update(account_updates).eq("tier", plan_tier).execute()
            
            # Evict caches immediately for all updated users
            from app.core.cache import evict_account_caches
            accounts_res = supabase.table("accounts").select("id").eq("tier", plan_tier).execute()
            for acc in (accounts_res.data or []):
                evict_account_caches(acc["id"])
        except Exception as e:
            logger.error(f"Failed to propagate plan preset limits to accounts of tier {plan_tier}: {e}")
            
    return {"ok": True, "plan": result.data[0]}

@router.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    check_res = supabase.table("plan_presets").select("id").eq("id", plan_id).execute()
    if not check_res.data:
        raise HTTPException(status_code=404, detail="Plan preset not found")
        
    supabase.table("plan_presets").delete().eq("id", plan_id).execute()
    return {"ok": True}


@router.get("/stats")
async def get_stats(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization): raise HTTPException(status_code=401, detail="Admin access required")
    providers = get_supabase().table("providers").select("id, health_status, total_requests, total_errors, in_flight").execute()
    accounts = get_supabase().table("accounts").select("id, tier, monthly_requests, monthly_limit, status").execute()
    global_telemetry = get_global_telemetry()
    return {
        "providers": {"total": len(providers.data), "active": len([p for p in providers.data if p["health_status"] == "active"]), "total_requests": sum(p["total_requests"] for p in providers.data), "total_errors": sum(p["total_errors"] for p in providers.data)},
        "accounts": {"total": len(accounts.data), "active": len([a for a in accounts.data if a["status"] == "active"]), "by_tier": {t: len([a for a in accounts.data if a["tier"] == t]) for t in ("free", "pro", "enterprise")}},
        "global_telemetry": global_telemetry
    }


@router.get("/settings")
async def get_admin_settings(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    res = supabase.table("system_settings").select("*").execute()
    settings_dict = {row["key"]: row["value"] for row in res.data}
    if "gateway_enabled" not in settings_dict:
        settings_dict["gateway_enabled"] = "true"
    if "require_activation" not in settings_dict:
        settings_dict["require_activation"] = "false"
    return {"settings": settings_dict}


@router.patch("/settings")
async def update_admin_settings(body: UpdateSettingsRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    response = {"ok": True}
    if body.gateway_enabled is not None:
        val_str = "true" if body.gateway_enabled else "false"
        supabase.table("system_settings").upsert({"key": "gateway_enabled", "value": val_str}).execute()
        response["gateway_enabled"] = body.gateway_enabled
        
    if body.require_activation is not None:
        val_str = "true" if body.require_activation else "false"
        supabase.table("system_settings").upsert({"key": "require_activation", "value": val_str}).execute()
        response["require_activation"] = body.require_activation

    # Evict cache immediately
    from app.core.cache import evict_system_settings_cache
    evict_system_settings_cache()
    
    return response


@router.get("/invitations")
async def list_invitations(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    res = supabase.table("invitation_codes").select("*").order("created_at", desc=True).execute()
    return {"invitations": res.data}


@router.post("/invitations")
async def create_invitation(body: CreateInvitationRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    import random
    import string
    
    code = body.code.strip() if (body.code and body.code.strip()) else "".join(random.choices(string.ascii_uppercase + string.digits, k=12))
    max_uses = body.max_uses if body.max_uses is not None else 1
    if max_uses < 1:
        raise HTTPException(status_code=400, detail="max_uses must be at least 1")
        
    # Check duplicate
    chk = supabase.table("invitation_codes").select("id").eq("code", code).execute()
    if chk.data:
        raise HTTPException(status_code=400, detail=f"Invitation code '{code}' already exists")
        
    res = supabase.table("invitation_codes").insert({
        "code": code,
        "max_uses": max_uses,
        "used_count": 0,
        "is_active": True
    }).execute()
    
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create invitation code")
        
    return {"ok": True, "invitation": res.data[0]}


@router.patch("/invitations/{inv_id}")
async def update_invitation(inv_id: str, body: UpdateInvitationRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    # Check if exists
    chk = supabase.table("invitation_codes").select("id, max_uses, used_count").eq("id", inv_id).execute()
    if not chk.data:
        raise HTTPException(status_code=404, detail="Invitation code not found")
        
    inv = chk.data[0]
    
    updates = {}
    if body.max_uses is not None:
        if body.max_uses < inv["used_count"]:
            raise HTTPException(
                status_code=400, 
                detail=f"max_uses ({body.max_uses}) cannot be less than used count ({inv['used_count']})"
            )
        updates["max_uses"] = body.max_uses
    if body.is_active is not None:
        updates["is_active"] = body.is_active
        
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
        
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = supabase.table("invitation_codes").update(updates).eq("id", inv_id).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to update invitation code")
        
    return {"ok": True, "invitation": res.data[0]}


@router.delete("/invitations/{inv_id}")
async def delete_invitation(inv_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    # Check if exists
    chk = supabase.table("invitation_codes").select("id").eq("id", inv_id).execute()
    if not chk.data:
        raise HTTPException(status_code=404, detail="Invitation code not found")
        
    supabase.table("invitation_codes").delete().eq("id", inv_id).execute()
    return {"ok": True}


@router.get("/models")
async def admin_list_models(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    res = supabase.table("model_mapping").select("*").execute()
    return {"models": res.data}


@router.patch("/models/{alias}")
async def admin_update_model(alias: str, body: UpdateModelRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    
    updates = {}
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if body.input_cost_per_million is not None:
        updates["input_cost_per_million"] = body.input_cost_per_million
    if body.output_cost_per_million is not None:
        updates["output_cost_per_million"] = body.output_cost_per_million
    if body.pricing_mode is not None:
        if body.pricing_mode not in ("per_token", "per_request"):
            raise HTTPException(status_code=400, detail="pricing_mode must be 'per_token' or 'per_request'")
        updates["pricing_mode"] = body.pricing_mode
    if body.cost_per_request_cents is not None:
        if body.cost_per_request_cents < 0:
            raise HTTPException(status_code=400, detail="cost_per_request_cents must be >= 0")
        updates["cost_per_request_cents"] = body.cost_per_request_cents
    if body.points_cost is not None:
        if body.points_cost < 0 or body.points_cost > 1000:
            raise HTTPException(status_code=400, detail="points_cost must be between 0 and 1000")
        updates["points_cost"] = body.points_cost

    # Check if model mapping exists in DB
    check_res = supabase.table("model_mapping").select("alias").eq("alias", alias).execute()
    if not check_res.data:
        upstream = settings.model_mapping.get(alias, alias)
        insert_data = {
            "alias": alias,
            "upstream_model": upstream,
            "display_name": alias.replace("-", " ").title(),
            "is_active": body.is_active if body.is_active is not None else True,
        }
        if body.input_cost_per_million is not None:
            insert_data["input_cost_per_million"] = body.input_cost_per_million
        if body.output_cost_per_million is not None:
            insert_data["output_cost_per_million"] = body.output_cost_per_million
        if body.pricing_mode is not None:
            insert_data["pricing_mode"] = body.pricing_mode
        if body.cost_per_request_cents is not None:
            insert_data["cost_per_request_cents"] = body.cost_per_request_cents
        if body.points_cost is not None:
            insert_data["points_cost"] = body.points_cost
        supabase.table("model_mapping").insert(insert_data).execute()
    else:
        if updates:
            supabase.table("model_mapping").update(updates).eq("alias", alias).execute()
    
    # Evict local cache immediately
    from app.core.cache import evict_model_active_cache
    evict_model_active_cache(alias)
    
    return {"ok": True, "alias": alias, "updates": updates}

# ---------------------------------------------------------------------------
# Provider Endpoints (vsllm-style single-URL API-key providers)
# ---------------------------------------------------------------------------

class CreateProviderEndpointRequest(BaseModel):
    name: str
    base_url: str
    api_key: str                          # plaintext — encrypted before storage
    auth_header: Optional[str] = "Authorization"
    auth_scheme: Optional[str] = "Bearer"
    model_aliases: Optional[list[str]] = []
    default_pricing_mode: Optional[str] = "per_request"
    default_cost_per_request_cents: Optional[int] = None
    health_status: Optional[str] = "active"
    max_concurrent: Optional[int] = 50
    weight: Optional[float] = 1.0

class UpdateProviderEndpointRequest(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None         # re-encrypt on change
    auth_header: Optional[str] = None
    auth_scheme: Optional[str] = None
    model_aliases: Optional[list[str]] = None
    default_pricing_mode: Optional[str] = None
    default_cost_per_request_cents: Optional[int] = None
    health_status: Optional[str] = None
    max_concurrent: Optional[int] = None
    weight: Optional[float] = None

def _encrypt_provider_api_key(raw_key: str) -> str:
    from cryptography.fernet import Fernet
    secret = settings.agent_key_encryption_secret
    f = Fernet(secret.encode())
    return f.encrypt(raw_key.encode()).decode()


@router.get("/provider-endpoints")
async def list_provider_endpoints(authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    res = supabase.table("provider_endpoints").select("*").order("created_at", desc=True).execute()
    # Strip api_key_encrypted from the response (never expose to admin UI)
    for row in (res.data or []):
        row.pop("api_key_encrypted", None)
    return {"provider_endpoints": res.data or []}


@router.post("/provider-endpoints")
async def create_provider_endpoint(body: CreateProviderEndpointRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")

    if body.default_pricing_mode not in ("per_token", "per_request"):
        raise HTTPException(status_code=400, detail="default_pricing_mode must be 'per_token' or 'per_request'")
    if body.health_status not in ("active", "degraded", "disabled"):
        raise HTTPException(status_code=400, detail="health_status must be active, degraded, or disabled")

    supabase = get_supabase()
    exist = supabase.table("provider_endpoints").select("id").eq("name", body.name).execute()
    if exist.data:
        raise HTTPException(status_code=400, detail=f"Provider endpoint with name '{body.name}' already exists")

    insert = {
        "name": body.name,
        "base_url": body.base_url.rstrip("/"),
        "api_key_encrypted": _encrypt_provider_api_key(body.api_key),
        "auth_header": body.auth_header or "Authorization",
        "auth_scheme": body.auth_scheme or "Bearer",
        "model_aliases": body.model_aliases or [],
        "default_pricing_mode": body.default_pricing_mode,
        "default_cost_per_request_cents": body.default_cost_per_request_cents,
        "health_status": body.health_status,
        "max_concurrent": body.max_concurrent or 50,
        "weight": body.weight if body.weight is not None else 1.0,
    }
    res = supabase.table("provider_endpoints").insert(insert).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create provider endpoint")
    row = res.data[0]
    row.pop("api_key_encrypted", None)
    return {"ok": True, "provider_endpoint": row}


@router.patch("/provider-endpoints/{endpoint_id}")
async def update_provider_endpoint(endpoint_id: str, body: UpdateProviderEndpointRequest, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()

    check = supabase.table("provider_endpoints").select("id").eq("id", endpoint_id).execute()
    if not check.data:
        raise HTTPException(status_code=404, detail="Provider endpoint not found")

    updates = {}
    if body.name is not None:
        conflict = supabase.table("provider_endpoints").select("id").eq("name", body.name).neq("id", endpoint_id).execute()
        if conflict.data:
            raise HTTPException(status_code=400, detail=f"Provider endpoint with name '{body.name}' already exists")
        updates["name"] = body.name
    if body.base_url is not None:
        updates["base_url"] = body.base_url.rstrip("/")
    if body.api_key is not None:
        updates["api_key_encrypted"] = _encrypt_provider_api_key(body.api_key)
    if body.auth_header is not None:
        updates["auth_header"] = body.auth_header
    if body.auth_scheme is not None:
        updates["auth_scheme"] = body.auth_scheme
    if body.model_aliases is not None:
        updates["model_aliases"] = body.model_aliases
    if body.default_pricing_mode is not None:
        if body.default_pricing_mode not in ("per_token", "per_request"):
            raise HTTPException(status_code=400, detail="default_pricing_mode must be 'per_token' or 'per_request'")
        updates["default_pricing_mode"] = body.default_pricing_mode
    if body.default_cost_per_request_cents is not None:
        updates["default_cost_per_request_cents"] = body.default_cost_per_request_cents
    if body.health_status is not None:
        if body.health_status not in ("active", "degraded", "disabled"):
            raise HTTPException(status_code=400, detail="health_status must be active, degraded, or disabled")
        updates["health_status"] = body.health_status
    if body.max_concurrent is not None:
        updates["max_concurrent"] = body.max_concurrent
    if body.weight is not None:
        updates["weight"] = body.weight

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = "NOW()"
    res = supabase.table("provider_endpoints").update(updates).eq("id", endpoint_id).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to update provider endpoint")
    row = res.data[0]
    row.pop("api_key_encrypted", None)
    return {"ok": True, "provider_endpoint": row}


@router.delete("/provider-endpoints/{endpoint_id}")
async def delete_provider_endpoint(endpoint_id: str, authorization: Optional[str] = Header(None)):
    if not _verify_admin(authorization):
        raise HTTPException(status_code=401, detail="Admin access required")
    supabase = get_supabase()
    check = supabase.table("provider_endpoints").select("id").eq("id", endpoint_id).execute()
    if not check.data:
        raise HTTPException(status_code=404, detail="Provider endpoint not found")
    supabase.table("provider_endpoints").delete().eq("id", endpoint_id).execute()
    return {"ok": True}
