"""Audit log helper.

Wraps the `public.write_audit_log` Postgres function (defined in
scratch/migrate_rls_and_audit_log.sql) with a fail-soft Python helper.

Usage:
    from app.core.audit import audit

    audit(
        action="tier.upgrade",
        target_type="account",
        target_id=str(account_id),
        metadata={"from": "free", "to": "ultra"},
        request=request,  # optional; pulls IP and UA from headers
    )

Fail-soft semantics: if the audit write fails (network blip, missing RPC,
DB down), we LOG the failure but DO NOT raise. The privileged action
should still proceed — losing an audit row is much less bad than failing
to deliver a webhook tier sync to a paying customer. The failure itself
becomes a separate, high-severity log line that ops can alert on.

For actions where you absolutely want the audit row to succeed before the
privileged action commits, use `audit_strict()` which raises on failure.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)


def _extract_request_meta(request: Any) -> dict[str, Any]:
    """Pull IP and user-agent from a FastAPI Request, if available.

    Returns an empty dict if `request` is None or doesn't have headers.
    """
    if request is None:
        return {}
    out: dict[str, Any] = {}
    try:
        # X-Forwarded-For is set by Railway/Cloudflare when behind a proxy.
        xff = request.headers.get("x-forwarded-for")
        if xff:
            # Take the leftmost (client) IP
            out["ip_address"] = xff.split(",")[0].strip()
        elif request.client and request.client.host:
            out["ip_address"] = request.client.host
        ua = request.headers.get("user-agent")
        if ua:
            out["user_agent"] = ua
    except Exception:
        # Don't let header parsing break the audit write
        pass
    return out


def audit(
    *,
    action: str,
    target_type: str,
    target_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
    request: Any = None,
    request_id: Optional[str] = None,
) -> Optional[int]:
    """Write an audit log row. Fail-soft: logs but does not raise on failure.

    Returns the inserted row id, or None if the write failed.
    """
    try:
        payload = {
            "p_action": action,
            "p_target_type": target_type,
            "p_target_id": target_id,
            "p_metadata": metadata or {},
        }
        meta = _extract_request_meta(request)
        # Prefix with p_ to match the SQL function parameter names
        if "ip_address" in meta:
            payload["p_ip_address"] = meta["ip_address"]
        if "user_agent" in meta:
            payload["p_user_agent"] = meta["user_agent"]
        if request_id:
            payload["p_request_id"] = request_id

        supabase = get_supabase()
        res = supabase.rpc("write_audit_log", payload).execute()
        if res is not None and getattr(res, "data", None):
            return int(res.data)
        logger.warning("write_audit_log returned no data: %s", payload)
        return None
    except Exception as exc:
        # Fail-soft: never break the calling action because the audit failed.
        # But make the failure visible so ops can alert on it.
        logger.error(
            "AUDIT WRITE FAILED — action=%s target=%s/%s metadata=%s err=%s",
            action, target_type, target_id, metadata, exc,
        )
        return None


def audit_strict(
    *,
    action: str,
    target_type: str,
    target_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
    request: Any = None,
    request_id: Optional[str] = None,
) -> int:
    """Like `audit()` but raises on failure. Use only when you need a hard guarantee."""
    payload = {
        "p_action": action,
        "p_target_type": target_type,
        "p_target_id": target_id,
        "p_metadata": metadata or {},
    }
    meta = _extract_request_meta(request)
    payload.update(meta)
    if request_id:
        payload["p_request_id"] = request_id

    supabase = get_supabase()
    res = supabase.rpc("write_audit_log", payload).execute()
    if res is None or not getattr(res, "data", None):
        raise RuntimeError(f"audit_log write returned no data for action={action}")
    return int(res.data)