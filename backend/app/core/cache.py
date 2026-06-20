"""AKAROUTER Local In-Memory Cache and Write-Buffering Layer."""
import time
import logging
import threading
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)

# Thread-safe locks for memory cache and buffers
_lock = threading.Lock()

# Cache store structures
_api_key_cache: dict[str, tuple[dict[str, Any], float]] = {}  # key_hash -> (auth_metadata, expire_timestamp)
_jwt_cache: dict[str, tuple[dict[str, Any], float]] = {}      # token -> (user_info, expire_timestamp)
_provider_cache: Optional[tuple[list[dict[str, Any]], float]] = None  # (active_providers_list, expire_timestamp)

# In-memory RPM trackers: account_id -> {minute_epoch: count}
_rpm_trackers: dict[str, dict[int, int]] = {}

# In-memory activation rate trackers: account_id -> {minute_epoch: count}
_activation_trackers: dict[str, dict[int, int]] = {}

# Account-level budget tracking: account_id -> {"consumed_5h": float, "consumed_7d": float, "last_fetched_at": float}
_account_budgets: dict[str, dict[str, Any]] = {}

# Cached system settings: key -> (value, last_fetched_at)
_system_settings_cache: dict[str, tuple[Any, float]] = {}

# Cached model active status: model_alias -> (is_active, last_fetched_at)
_model_active_cache: dict[str, tuple[bool, float]] = {}

# Cached model metadata (active status, input and output cost rates): model_alias -> (meta_dict, last_fetched_at)
_model_meta_cache: dict[str, tuple[dict[str, Any], float]] = {}

# In-flight tracker (provider_id -> count) - persistent in memory
_in_flight_tracker: dict[str, int] = {}

# Consecutive error tracking for providers (provider_id -> count)
_provider_consecutive_errors: dict[str, int] = {}

# Buffers for deferred database updates
_account_usage_buffer: dict[str, dict[str, int]] = {}  # account_id -> {"monthly": int, "total": int}
_provider_usage_buffer: dict[str, dict[str, int]] = {}  # provider_id -> {"requests": int, "errors": int}
_request_log_buffer: list[dict[str, Any]] = []

# Throttle timestamp gates for last_used_at database writes (id -> last_db_write_timestamp)
_last_used_at_timestamps: dict[str, float] = {}

# Background task reference
_flusher_task: Optional[asyncio.Task] = None
_should_flush = True


# --- Cache Accessors ---

def get_api_key_cache(key_hash: str) -> Optional[dict[str, Any]]:
    """Retrieve auth metadata for an API key if present and not expired."""
    with _lock:
        if key_hash in _api_key_cache:
            data, expires_at = _api_key_cache[key_hash]
            if time.time() < expires_at:
                return data
            # Clean up expired entry
            del _api_key_cache[key_hash]
    return None


def set_api_key_cache(key_hash: str, auth_metadata: dict[str, Any], ttl: float = 30.0) -> None:
    """Cache auth metadata for an API key with a given TTL."""
    with _lock:
        _api_key_cache[key_hash] = (auth_metadata, time.time() + ttl)


def check_and_increment_rpm(account_id: str, limit: int) -> bool:
    """
    Check if account has exceeded its RPM limit for the current minute.
    If NOT exceeded, increments the count and returns False.
    If exceeded, returns True.
    """
    current_minute = int(time.time() // 60)
    with _lock:
        if account_id not in _rpm_trackers:
            _rpm_trackers[account_id] = {}
        
        # Clean up old minutes
        tracker = _rpm_trackers[account_id]
        old_minutes = [m for m in tracker if m < current_minute]
        for m in old_minutes:
            del tracker[m]
            
        current_count = tracker.get(current_minute, 0)
        if current_count >= limit:
            return True
        
        tracker[current_minute] = current_count + 1
        return False


def check_and_increment_activation_rate_limit(account_id: str, limit: int = 5) -> bool:
    """
    Check if account has exceeded its activation attempts limit (5 RPM).
    If NOT exceeded, increments the count and returns False.
    If exceeded, returns True.
    """
    current_minute = int(time.time() // 60)
    with _lock:
        if account_id not in _activation_trackers:
            _activation_trackers[account_id] = {}
        
        # Clean up old minutes
        tracker = _activation_trackers[account_id]
        old_minutes = [m for m in tracker if m < current_minute]
        for m in old_minutes:
            del tracker[m]
            
        current_count = tracker.get(current_minute, 0)
        if current_count >= limit:
            return True
        
        tracker[current_minute] = current_count + 1
        return False


def evict_jwt_cache(token: str) -> None:
    """Evict a specific JWT token from the in-memory cache."""
    with _lock:
        if token in _jwt_cache:
            del _jwt_cache[token]


def evict_api_key_cache(key_hash: str) -> None:
    """
    Evict a specific API key from the in-memory auth cache.

    SECURITY: call this synchronously whenever a key is revoked, rotated, or
    marked inactive. Without this, a revoked key remains usable until the
    30-second TTL expires — for a security-critical action like key revocation,
    that's a 30-second window during which a stolen key still works. Evicting
    the entry collapses that window to sub-millisecond.
    """
    with _lock:
        if key_hash in _api_key_cache:
            del _api_key_cache[key_hash]


def get_account_budget(account_id: str) -> Optional[dict[str, Any]]:
    """Retrieve the cached budget tracking for an account if not expired (TTL 30s)."""
    with _lock:
        if account_id in _account_budgets:
            data = _account_budgets[account_id]
            if time.time() - data["last_fetched_at"] < 300.0:
                reset_5h_at = data.get("reset_5h_at")
                reset_7d_at = data.get("reset_7d_at")
                now_ts = time.time()
                if (reset_5h_at is None or now_ts < reset_5h_at) and (reset_7d_at is None or now_ts < reset_7d_at):
                    return data
            del _account_budgets[account_id]
    return None


def set_account_budget(
    account_id: str,
    consumed_5h: float,
    consumed_7d: float,
    consumed_month: float,
    reset_5h_at: Optional[float] = None,
    reset_7d_at: Optional[float] = None
) -> None:
    """Set the cached budget tracking for an account."""
    with _lock:
        _account_budgets[account_id] = {
            "consumed_5h": consumed_5h,
            "consumed_7d": consumed_7d,
            "consumed_month": consumed_month,
            "reset_5h_at": reset_5h_at,
            "reset_7d_at": reset_7d_at,
            "last_fetched_at": time.time(),
        }


def get_budget_cycles(budget_reset_at: Optional[str], now_dt: datetime) -> dict[str, Any]:
    """Helper to calculate consistent budget cycle start and reset times."""
    reset_dt = None
    if budget_reset_at:
        try:
            reset_dt = datetime.fromisoformat(budget_reset_at.replace("Z", "+00:00"))
        except Exception:
            pass

    if reset_dt:
        month_start = reset_dt
    else:
        month_start = now_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
    elapsed = (now_dt - month_start).total_seconds()
    
    # 5h Cycle
    cycle_5h_length = 5 * 3600
    completed_5h_cycles = int(max(0.0, elapsed) // cycle_5h_length)
    cycle_5h_start = month_start + timedelta(seconds=completed_5h_cycles * cycle_5h_length)
    cycle_5h_reset = cycle_5h_start + timedelta(seconds=cycle_5h_length)
    
    # 7d Cycle
    cycle_7d_length = 7 * 24 * 3600
    completed_7d_cycles = int(max(0.0, elapsed) // cycle_7d_length)
    cycle_7d_start = month_start + timedelta(seconds=completed_7d_cycles * cycle_7d_length)
    cycle_7d_reset = cycle_7d_start + timedelta(seconds=cycle_7d_length)
    
    return {
        "reset_dt": reset_dt,
        "month_start": month_start,
        "cycle_5h_start": cycle_5h_start,
        "cycle_5h_reset": cycle_5h_reset,
        "cycle_7d_start": cycle_7d_start,
        "cycle_7d_reset": cycle_7d_reset,
    }


async def calculate_account_budget(account_id: str, budget_reset_at: Optional[str]) -> dict[str, Any]:
    """Calculate budget consumption from DB RPC and include unflushed in-memory logs."""
    now_dt = datetime.now(timezone.utc)
    bounds = get_budget_cycles(budget_reset_at, now_dt)
    month_start = bounds["month_start"]
    cycle_5h_start = bounds["cycle_5h_start"]
    cycle_5h_reset = bounds["cycle_5h_reset"]
    cycle_7d_start = bounds["cycle_7d_start"]
    cycle_7d_reset = bounds["cycle_7d_reset"]
    reset_dt = bounds["reset_dt"]

    # 1. Fetch aggregated consumed amounts from database RPC
    supabase = get_supabase()
    try:
        res = supabase.rpc("get_budget_consumption", {
            "p_account_id": account_id,
            "p_month_start": month_start.isoformat(),
            "p_cycle_5h_start": cycle_5h_start.isoformat(),
            "p_cycle_5h_reset": cycle_5h_reset.isoformat(),
            "p_cycle_7d_start": cycle_7d_start.isoformat(),
            "p_cycle_7d_reset": cycle_7d_reset.isoformat(),
        }).execute()
        if res.data:
            db_data = res.data[0]
            consumed_5h = float(db_data.get("consumed_5h", 0.0))
            consumed_7d = float(db_data.get("consumed_7d", 0.0))
            consumed_month = float(db_data.get("consumed_month", 0.0))
        else:
            consumed_5h = consumed_7d = consumed_month = 0.0
    except Exception as e:
        logger.error(f"Failed to query budget consumption RPC: {e}")
        # Fallback to direct query if RPC is missing/fails
        consumed_5h = consumed_7d = consumed_month = 0.0
        try:
            logs_res = (
                supabase.table("request_logs")
                .select("cost, created_at")
                .eq("account_id", account_id)
                .gte("created_at", month_start.isoformat())
                .execute()
            )
            if logs_res and logs_res.data:
                for log in logs_res.data:
                    cost = log.get("cost") or 0.0
                    created_at_str = log.get("created_at")
                    if not created_at_str:
                        continue
                    try:
                        log_dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                        if reset_dt and log_dt < reset_dt:
                            continue
                        if log_dt >= cycle_5h_start and log_dt < cycle_5h_reset:
                            consumed_5h += cost
                        if log_dt >= cycle_7d_start and log_dt < cycle_7d_reset:
                            consumed_7d += cost
                        if log_dt >= month_start:
                            consumed_month += cost
                    except Exception:
                        pass
        except Exception as fallback_err:
            logger.error(f"Fallback budget query also failed: {fallback_err}")

    # 2. Add unflushed log costs from the in-memory write buffer
    with _lock:
        for log in _request_log_buffer:
            if log.get("account_id") == account_id:
                cost = log.get("cost") or 0.0
                created_at = log.get("created_at")
                if isinstance(created_at, str):
                    try:
                        log_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                    except Exception:
                        log_dt = now_dt
                else:
                    log_dt = now_dt

                if reset_dt and log_dt < reset_dt:
                    continue
                if log_dt >= cycle_5h_start and log_dt < cycle_5h_reset:
                    consumed_5h += cost
                if log_dt >= cycle_7d_start and log_dt < cycle_7d_reset:
                    consumed_7d += cost
                if log_dt >= month_start:
                    consumed_month += cost

    # 3. Cache the computed budget metrics
    set_account_budget(
        account_id,
        consumed_5h,
        consumed_7d,
        consumed_month,
        reset_5h_at=cycle_5h_reset.timestamp(),
        reset_7d_at=cycle_7d_reset.timestamp()
    )

    return {
        "consumed_5h": consumed_5h,
        "consumed_7d": consumed_7d,
        "consumed_month": consumed_month
    }


# Account-level request quota tracking (for per-request billing)
# account_id -> {"consumed_month": int, "created_at": float, "last_reset": float}
_account_request_quotas: dict[str, dict[str, Any]] = {}


def get_request_quota(account_id: str) -> dict[str, Any]:
    """Get cached request quota for an account, or calculate from DB if stale."""
    now = time.time()
    with _lock:
        if account_id in _account_request_quotas:
            data = _account_request_quotas[account_id]
            if now - data.get("last_reset", 0) < 30.0:
                return {"consumed_month": data["consumed_month"], "stale": False}

    # Rebuild from DB: count request_logs since budget_reset_at
    try:
        supabase = get_supabase()
        account_res = (
            supabase.table("accounts")
            .select("budget_reset_at, monthly_requests")
            .eq("id", account_id)
            .single()
            .execute()
        )
        reset_at = account_res.data.get("budget_reset_at") if account_res.data else None

        query = supabase.table("request_logs").select("id, requests_counted", count="exact", head=True)
        if reset_at:
            query = query.gte("created_at", reset_at)
        qres = query.execute()
        counted = qres.count if qres.count is not None else 0

        with _lock:
            _account_request_quotas[account_id] = {
                "consumed_month": counted,
                "created_at": now,
                "last_reset": now,
            }
    except Exception as e:
        logger.error(f"Failed to calculate request quota for {account_id}: {e}")
        with _lock:
            cached = _account_request_quotas.get(account_id, {}).get("consumed_month", 0)
        return {"consumed_month": cached, "stale": True}

    return {"consumed_month": counted, "stale": False}


def increment_request_quota(account_id: str, requests_counted: int = 1) -> None:
    """Atomically increment the cached request quota and buffer DB update."""
    with _lock:
        if account_id not in _account_request_quotas:
            _account_request_quotas[account_id] = {
                "consumed_month": 0,
                "created_at": time.time(),
                "last_reset": time.time(),
            }
        _account_request_quotas[account_id]["consumed_month"] += requests_counted
        _account_request_quotas[account_id]["last_reset"] = 0  # force re-fetch from DB on next check

    # Buffer DB increment (batch flush keeps this cheap)
    try:
        _increment_request_quota_db(account_id, requests_counted)
    except Exception as e:
        logger.warning(f"Failed to buffer request quota DB write for {account_id}: {e}")


def _increment_request_quota_db(account_id: str, delta: int) -> None:
    """Fire-and-forget DB increment for request count."""
    supabase = get_supabase()
    res = (
        supabase.table("accounts")
        .select("monthly_requests, monthly_requests_limit")
        .eq("id", account_id)
        .single()
        .execute()
    )
    current = (res.data.get("monthly_requests") or 0) if res.data else 0
    new_val = current + delta
    (
        supabase.table("accounts")
        .update({"monthly_requests": new_val})
        .eq("id", account_id)
        .execute()
    )


def evict_request_quota_cache(account_id: str) -> None:
    """Evict request quota cache for an account (call after plan/tier change)."""
    with _lock:
        if account_id in _account_request_quotas:
            del _account_request_quotas[account_id]


def increment_account_budget(account_id: str, cost: float) -> None:
    """Atomically increment the cached budget for an account."""
    with _lock:
        if account_id in _account_budgets:
            data = _account_budgets[account_id]
            data["consumed_5h"] += cost
            data["consumed_7d"] += cost
            data["consumed_month"] += cost


def evict_account_caches(account_id: str) -> None:
    """Evict all cached API key auth metadata, RPM records, and budget metrics for a specific account."""
    with _lock:
        # Evict from _api_key_cache
        keys_to_delete = []
        for key_hash, (auth_metadata, _) in _api_key_cache.items():
            if auth_metadata.get("account_id") == account_id:
                keys_to_delete.append(key_hash)
        for k in keys_to_delete:
            del _api_key_cache[k]
            
        # Evict from _rpm_trackers
        if account_id in _rpm_trackers:
            del _rpm_trackers[account_id]

        # Evict from _account_budgets
        if account_id in _account_budgets:
            del _account_budgets[account_id]

        # Evict from _jwt_cache
        tokens_to_delete = []
        for token, (user_info, _) in _jwt_cache.items():
            if user_info.get("account_id") == account_id:
                tokens_to_delete.append(token)
        for t in tokens_to_delete:
            del _jwt_cache[t]


def is_gateway_enabled() -> bool:
    """Check if the gateway is enabled globally. Cached for 10s."""
    now = time.time()
    with _lock:
        if "gateway_enabled" in _system_settings_cache:
            val, fetched_at = _system_settings_cache["gateway_enabled"]
            if now - fetched_at < 60.0:
                return val == "true"
    
    # Cache miss, query DB
    try:
        supabase = get_supabase()
        res = supabase.table("system_settings").select("value").eq("key", "gateway_enabled").execute()
        val = "true"
        if res.data:
            val = res.data[0]["value"]
        else:
            # Seed it if missing
            supabase.table("system_settings").insert({"key": "gateway_enabled", "value": "true"}).execute()
        
        with _lock:
            _system_settings_cache["gateway_enabled"] = (val, now)
        return val == "true"
    except Exception as e:
        logger.error(f"Failed to check gateway status: {e}")
        # Fallback to true in case of DB failure to avoid false-positive blocking
        return True


def is_activation_required() -> bool:
    """Check if signup activation is required. Cached for 60s."""
    now = time.time()
    with _lock:
        if "require_activation" in _system_settings_cache:
            val, fetched_at = _system_settings_cache["require_activation"]
            if now - fetched_at < 60.0:
                return val == "true"
    
    # Cache miss, query DB
    try:
        supabase = get_supabase()
        res = supabase.table("system_settings").select("value").eq("key", "require_activation").execute()
        val = "false"
        if res.data:
            val = res.data[0]["value"]
        else:
            # Seed it if missing
            supabase.table("system_settings").insert({"key": "require_activation", "value": "false"}).execute()
        
        with _lock:
            _system_settings_cache["require_activation"] = (val, now)
        return val == "true"
    except Exception as e:
        logger.error(f"Failed to check require_activation status: {e}")
        return False




def evict_system_settings_cache() -> None:
    """Evict the system settings cache."""
    with _lock:
        _system_settings_cache.clear()


def get_model_metadata(model_alias: str) -> dict[str, Any]:
    """Retrieve model metadata (is_active, input_cost, output_cost) from cache or DB (TTL 60s)."""
    now = time.time()
    with _lock:
        if model_alias in _model_meta_cache:
            val, fetched_at = _model_meta_cache[model_alias]
            if now - fetched_at < 60.0:
                return val
    
    # Cache miss, query DB
    try:
        supabase = get_supabase()
        res = (
            supabase.table("model_mapping")
            .select("is_active, is_upcoming, input_cost_per_million, output_cost_per_million, "
                    "pricing_mode, cost_per_request_cents, points_cost, display_name")
            .eq("alias", model_alias)
            .execute()
        )
        if res.data:
            row = res.data[0]
            val = {
                "is_active": row.get("is_active") if row.get("is_active") is not None else True,
                "is_upcoming": bool(row.get("is_upcoming")),
                "input_cost_per_million": row.get("input_cost_per_million"),
                "output_cost_per_million": row.get("output_cost_per_million"),
                "pricing_mode": row.get("pricing_mode") or "per_token",
                "cost_per_request_cents": row.get("cost_per_request_cents"),
                "points_cost": row.get("points_cost"),
                "display_name": row.get("display_name"),
            }
        else:
            val = {
                "is_active": True,
                "is_upcoming": False,
                "input_cost_per_million": None,
                "output_cost_per_million": None,
                "pricing_mode": "per_token",
                "cost_per_request_cents": None,
                "points_cost": None,
                "display_name": None,
            }
        
        with _lock:
            _model_meta_cache[model_alias] = (val, now)
        return val
    except Exception as e:
        logger.error(f"Failed to fetch model metadata for {model_alias}: {e}")
        return {
            "is_active": True,
            "is_upcoming": False,
            "input_cost_per_million": None,
            "output_cost_per_million": None,
            "pricing_mode": "per_token",
            "cost_per_request_cents": None,
            "points_cost": None,
            "display_name": None,
        }


def is_model_active(model_alias: str) -> bool:
    """Check if a model is active. Cached for 60s via metadata cache."""
    meta = get_model_metadata(model_alias)
    return meta["is_active"]


def evict_model_active_cache(model_alias: str) -> None:
    """Evict a specific model's active status and metadata from cache."""
    with _lock:
        if model_alias in _model_active_cache:
            del _model_active_cache[model_alias]
        if model_alias in _model_meta_cache:
            del _model_meta_cache[model_alias]


def evict_all_model_caches() -> None:
    """Evict all model metadata + active caches. Used after schema migrations
    so the new is_upcoming column + new prices take effect immediately rather
    than waiting for the 60s TTL."""
    with _lock:
        _model_meta_cache.clear()
        _model_active_cache.clear()


def get_jwt_cache(token: str) -> Optional[dict[str, Any]]:
    """Retrieve verified user info for a JWT if present and not expired."""
    with _lock:
        if token in _jwt_cache:
            data, expires_at = _jwt_cache[token]
            if time.time() < expires_at:
                return data
            del _jwt_cache[token]
    return None


def set_jwt_cache(token: str, user_info: dict[str, Any], ttl: float = 5.0) -> None:
    """
    Cache verified Supabase JWT user info.

    SECURITY: TTL reduced from 60s → 10s → 5s. With a 60s cache, role/status/suspension
    changes by an admin would not propagate for up to 60s, leaving banned users
    authenticated. With a 10s cache, an admin who demotes another admin has a 10s
    window of elevated access. 5s tightens that window further — admin role/status
    changes are still propagated immediately via evict_account_caches() which is
    called from the Whop webhook handler and admin endpoints. 5s gives us the same
    perf characteristics (most calls re-use cache) while halving the privilege-
    escalation window.
    """
    with _lock:
        _jwt_cache[token] = (user_info, time.time() + ttl)


def get_active_providers_cache() -> Optional[list[dict[str, Any]]]:
    """Retrieve active providers list from cache if present and not expired."""
    global _provider_cache
    with _lock:
        if _provider_cache is not None:
            data, expires_at = _provider_cache
            if time.time() < expires_at:
                return data
            _provider_cache = None
    return None


def set_active_providers_cache(providers: list[dict[str, Any]], ttl: float = 60.0) -> None:
    """Cache active providers list with a short TTL."""
    global _provider_cache
    with _lock:
        _provider_cache = (providers, time.time() + ttl)


def clear_active_providers_cache() -> None:
    """Evict the active providers cache (e.g., when a provider degrades)."""
    global _provider_cache
    with _lock:
        _provider_cache = None


# --- In-Flight Request Tracker ---

def get_in_flight(provider_id: str) -> int:
    """Get the current in-flight request count for a provider."""
    with _lock:
        return _in_flight_tracker.get(provider_id, 0)


def inc_in_flight(provider_id: str) -> int:
    """Increment and return the in-flight request count for a provider."""
    with _lock:
        current = _in_flight_tracker.get(provider_id, 0)
        _in_flight_tracker[provider_id] = current + 1
        return _in_flight_tracker[provider_id]


def dec_in_flight(provider_id: str) -> int:
    """Decrement and return the in-flight request count for a provider (gated at 0)."""
    with _lock:
        current = _in_flight_tracker.get(provider_id, 0)
        _in_flight_tracker[provider_id] = max(0, current - 1)
        return _in_flight_tracker[provider_id]


# --- Consecutive Error Tracking ---

def inc_consecutive_errors(provider_id: str) -> int:
    """Increment and return consecutive error count for a provider."""
    with _lock:
        current = _provider_consecutive_errors.get(provider_id, 0)
        _provider_consecutive_errors[provider_id] = current + 1
        return _provider_consecutive_errors[provider_id]


def reset_consecutive_errors(provider_id: str) -> None:
    """Reset consecutive error count for a provider to 0."""
    with _lock:
        _provider_consecutive_errors[provider_id] = 0


# --- Throttled Database Updates Gate ---

def should_update_last_used_at(item_id: str, throttle_seconds: float = 60.0) -> bool:
    """Return True if last_used_at should be written to DB, updating the timestamp gate."""
    now = time.time()
    with _lock:
        last_write = _last_used_at_timestamps.get(item_id, 0.0)
        if now - last_write > throttle_seconds:
            _last_used_at_timestamps[item_id] = now
            return True
    return False


# --- Buffering for Deferred DB Writes ---

def buffer_account_usage(account_id: str) -> None:
    """Accumulate account usage request counts in memory."""
    with _lock:
        if account_id not in _account_usage_buffer:
            _account_usage_buffer[account_id] = {"monthly": 0, "total": 0}
        _account_usage_buffer[account_id]["monthly"] += 1
        _account_usage_buffer[account_id]["total"] += 1


def buffer_provider_usage(provider_id: str, success: bool) -> None:
    """Accumulate provider total requests and error counts in memory."""
    with _lock:
        if provider_id not in _provider_usage_buffer:
            _provider_usage_buffer[provider_id] = {"requests": 0, "errors": 0}
        _provider_usage_buffer[provider_id]["requests"] += 1
        if not success:
            _provider_usage_buffer[provider_id]["errors"] += 1


def buffer_request_log(log_data: dict[str, Any]) -> None:
    """Queue a request log to be batch inserted asynchronously."""
    with _lock:
        _request_log_buffer.append(log_data)


# --- Asynchronous Background Flusher ---

async def flush_buffers_to_db() -> None:
    """Perform a batch flush of all memory buffers into Supabase."""
    global _request_log_buffer, _account_usage_buffer, _provider_usage_buffer
    
    # Safely swap out buffer contents under lock to minimize lock-holding time
    with _lock:
        logs_to_insert = _request_log_buffer
        _request_log_buffer = []
        
        accounts_to_update = _account_usage_buffer
        _account_usage_buffer = {}
        
        providers_to_update = _provider_usage_buffer
        _provider_usage_buffer = {}

    supabase = get_supabase()

    # 1. Batch insert request logs
    if logs_to_insert:
        try:
            logger.debug("Flushing %d request logs to Supabase...", len(logs_to_insert))
            supabase.table("request_logs").insert(logs_to_insert).execute()
        except Exception as e:
            logger.error("Failed to batch insert request logs, dropping logs: %s", e)

    # 2. Flush account usages (deferred atomic RPC updates)
    for account_id, counts in accounts_to_update.items():
        try:
            logger.debug("Flushing account usage for %s: %s", account_id, counts)
            supabase.rpc("increment_account_usage", {
                "p_account_id": account_id,
                "p_monthly_delta": counts["monthly"],
                "p_total_delta": counts["total"]
            }).execute()
        except Exception as e:
            logger.error("Failed to flush usage for account %s: %s", account_id, e)

    # 3. Flush provider statistics (deferred atomic RPC updates)
    for provider_id, stats in providers_to_update.items():
        try:
            logger.debug("Flushing provider stats for %s: %s", provider_id, stats)
            supabase.rpc("increment_provider_stats", {
                "p_provider_id": provider_id,
                "p_requests_delta": stats["requests"],
                "p_errors_delta": stats["errors"]
            }).execute()
        except Exception as e:
            logger.error("Failed to flush stats for provider %s: %s", provider_id, e)


async def _flusher_worker() -> None:
    """Asynchronous worker that flushes buffers periodically."""
    logger.info("Background cache flusher worker started")
    while _should_flush:
        try:
            await asyncio.sleep(5.0)
            await flush_buffers_to_db()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Error in background cache flusher: %s", e)
    logger.info("Background cache flusher worker stopped")


def start_flusher() -> None:
    """Start the background flusher task."""
    global _flusher_task, _should_flush
    _should_flush = True
    if _flusher_task is None or _flusher_task.done():
        _flusher_task = asyncio.create_task(_flusher_worker())
        logger.info("Cache flusher background task initialized")


async def stop_flusher() -> None:
    """Stop the background flusher task and perform a final cleanup flush."""
    global _flusher_task, _should_flush
    _should_flush = False
    if _flusher_task is not None:
        _flusher_task.cancel()
        try:
            await _flusher_task
        except asyncio.CancelledError:
            pass
        _flusher_task = None
    logger.info("Performing final cache flush before shutdown...")
    await flush_buffers_to_db()
