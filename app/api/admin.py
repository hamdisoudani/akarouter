from __future__ import annotations

import time
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.core.supabase import get_supabase

router = APIRouter(prefix="/admin", tags=["admin"])


class DeviceCodeResponse(BaseModel):
    connection_id: str
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int = 5


class AccountOut(BaseModel):
    id: str
    account_label: str | None = None
    provider_name: str = "hermes-nous"
    health_status: str = "unknown"
    weight: float = 1.0
    total_requests: int = 0
    total_errors: int = 0
    in_flight: int = 0
    max_concurrent: int = 12
    last_used_at: str | None = None
    last_error_at: str | None = None
    last_error_msg: str | None = None
    token_expires_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


@router.get("/accounts", response_model=list[AccountOut])
async def list_accounts() -> list[dict[str, Any]]:
    supabase = get_supabase()
    rows = (
        supabase.table("providers")
        .select("id,account_label,provider_name,health_status,weight,total_requests,total_errors,in_flight,max_concurrent,last_used_at,last_error_at,last_error_msg,token_expires_at,created_at,updated_at")
        .execute()
        .data or []
    )
    return rows


@router.post("/accounts/init-device-code", response_model=DeviceCodeResponse)
async def init_device_code() -> DeviceCodeResponse:
    """Initiate Hermes OAuth device code flow — returns URL for user to authorize."""
    payload = {
        "client_id": settings.nous_client_id,
        "scope": settings.nous_scope,
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(settings.nous_device_code_url, data=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Device code request failed: {exc}")

    connection_id = str(uuid.uuid4())

    # Store pending connection in providers table (no tokens yet)
    supabase = get_supabase()
    supabase.table("providers").insert(
        {
            "id": connection_id,
            "account_label": f"hermes-{connection_id[:8]}",
            "provider_name": "hermes-nous",
            "client_id": settings.nous_client_id,
            "access_token": "",
            "refresh_token": "",
            "health_status": "pending",
            "token_scope": settings.nous_scope,
        }
    ).execute()

    return DeviceCodeResponse(
        connection_id=connection_id,
        device_code=data["device_code"],
        user_code=data.get("user_code", ""),
        verification_uri=data.get("verification_uri", "https://portal.nousresearch.com/device"),
        expires_in=data.get("expires_in", 900),
        interval=data.get("interval", 5),
    )


@router.get("/accounts/poll/{connection_id}")
async def poll_device_code(connection_id: str) -> dict[str, Any]:
    """Poll for device code token completion."""
    supabase = get_supabase()

    # Get the provider row
    rows = supabase.table("providers").select("*").eq("id", connection_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Connection not found")

    provider = rows[0]

    # If already has a token, return success
    if provider.get("access_token"):
        return {"status": "completed", "account_label": provider.get("account_label")}

    if provider.get("health_status") != "pending":
        return {"status": provider["health_status"]}

    # We need the device_code — it's not stored in DB for security
    # In a production system, store it temporarily (Redis, etc.)
    # For now, return pending status
    return {
        "status": "pending",
        "account_label": provider.get("account_label"),
        "message": "Waiting for user authorization. Check the verification URI.",
    }
