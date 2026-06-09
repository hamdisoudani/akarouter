"""AKAROUTER Local In-Memory Cache and Write-Buffering Layer."""
import time
import logging
import threading
import asyncio
from datetime import datetime, timezone
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

# Account-level budget tracking: account_id -> {"consumed_5h": float, "consumed_7d": float, "last_fetched_at": float}
_account_budgets: dict[str, dict[str, Any]] = {}

# Cached system settings: key -> (value, last_fetched_at)
_system_settings_cache: dict[str, tuple[Any, float]] = {}

# Cached model active status: model_alias -> (is_active, last_fetched_at)
_model_active_cache: dict[str, tuple[bool, float]] = {}

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


def get_account_budget(account_id: str) -> Optional[dict[str, Any]]:
    """Retrieve the cached budget tracking for an account if not expired (TTL 30s)."""
    with _lock:
        if account_id in _account_budgets:
            data = _account_budgets[account_id]
            if time.time() - data["last_fetched_at"] < 300.0:
                return data
            del _account_budgets[account_id]
    return None


def set_account_budget(account_id: str, consumed_5h: float, consumed_7d: float, consumed_month: float) -> None:
    """Set the cached budget tracking for an account."""
    with _lock:
        _account_budgets[account_id] = {
            "consumed_5h": consumed_5h,
            "consumed_7d": consumed_7d,
            "consumed_month": consumed_month,
            "last_fetched_at": time.time(),
        }


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


def evict_system_settings_cache() -> None:
    """Evict the system settings cache."""
    with _lock:
        _system_settings_cache.clear()


def is_model_active(model_alias: str) -> bool:
    """Check if a model is active. Cached for 10s."""
    now = time.time()
    with _lock:
        if model_alias in _model_active_cache:
            val, fetched_at = _model_active_cache[model_alias]
            if now - fetched_at < 60.0:
                return val
    
    # Cache miss, query DB
    try:
        supabase = get_supabase()
        res = supabase.table("model_mapping").select("is_active").eq("alias", model_alias).execute()
        val = True
        if res.data:
            val = res.data[0].get("is_active", True)
        
        with _lock:
            _model_active_cache[model_alias] = (val, now)
        return val
    except Exception as e:
        logger.error(f"Failed to check model active status for {model_alias}: {e}")
        # Fallback to true on DB error to avoid false-positive blocking
        return True


def evict_model_active_cache(model_alias: str) -> None:
    """Evict a specific model's active status from cache."""
    with _lock:
        if model_alias in _model_active_cache:
            del _model_active_cache[model_alias]


def get_jwt_cache(token: str) -> Optional[dict[str, Any]]:
    """Retrieve verified user info for a JWT if present and not expired."""
    with _lock:
        if token in _jwt_cache:
            data, expires_at = _jwt_cache[token]
            if time.time() < expires_at:
                return data
            del _jwt_cache[token]
    return None


def set_jwt_cache(token: str, user_info: dict[str, Any], ttl: float = 60.0) -> None:
    """Cache verified JWT user info with a given TTL."""
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

    # 2. Flush account usages (deferred reads/writes)
    for account_id, counts in accounts_to_update.items():
        try:
            logger.debug("Flushing account usage for %s: %s", account_id, counts)
            res = supabase.table("accounts").select("monthly_requests, total_requests").eq("id", account_id).execute()
            if res.data:
                curr = res.data[0]
                supabase.table("accounts").update({
                    "monthly_requests": curr.get("monthly_requests", 0) + counts["monthly"],
                    "total_requests": curr.get("total_requests", 0) + counts["total"],
                }).eq("id", account_id).execute()
        except Exception as e:
            logger.error("Failed to flush usage for account %s: %s", account_id, e)

    # 3. Flush provider statistics (deferred reads/writes)
    for provider_id, stats in providers_to_update.items():
        try:
            logger.debug("Flushing provider stats for %s: %s", provider_id, stats)
            res = supabase.table("providers").select("total_requests, total_errors").eq("id", provider_id).execute()
            if res.data:
                curr = res.data[0]
                supabase.table("providers").update({
                    "total_requests": curr.get("total_requests", 0) + stats["requests"],
                    "total_errors": curr.get("total_errors", 0) + stats["errors"],
                }).eq("id", provider_id).execute()
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
