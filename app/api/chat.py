from __future__ import annotations

import uuid
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.router import router as account_router, Router
from app.core.supabase import get_supabase

router = APIRouter()


class ChatRequest(BaseModel):
    model: str = Field(..., alias="model")
    messages: list[dict[str, Any]] = Field(default_factory=list)
    stream: bool = False


class Refresher:
    async def try_refresh(self, account) -> bool:
        if not account.refresh_token:
            return False
        now = time.time()
        refresh_lock_at = getattr(account, "refresh_lock_at", None)
        if refresh_lock_at:
            try:
                lock_ts = time.mktime(time.strptime(refresh_lock_at[:19], "%Y-%m-%dT%H:%M:%S"))
                if (now - lock_ts) < settings.refresh_lock_ttl:
                    return False
            except Exception:
                pass

        payload = {
            "grant_type": "refresh_token",
            "refresh_token": account.refresh_token,
            "client_id": settings.nous_client_id,
        }
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "x-nous-refresh-token": account.refresh_token,
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(settings.nous_token_url, data=payload, headers=headers)
            response.raise_for_status()
            token_resp = response.json()
        except Exception as exc:
            print(f"[refresh] failed account={account.id} error={exc}")
            await self._clear_lock(account)
            return False

        account.access_token = token_resp["access_token"]
        account.refresh_token = token_resp.get("refresh_token", account.refresh_token)
        expires_in = int(token_resp.get("expires_in", 900))
        account.expires_at = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + expires_in - settings.token_refresh_skew)
        )
        await self._clear_lock(account)
        await self._persist_tokens(account)
        return True

    async def _clear_lock(self, account) -> None:
        supabase = get_supabase()
        supabase.table("accounts").update({"refresh_lock_at": None}).eq("id", account.id).execute()

    async def _persist_tokens(self, account) -> None:
        supabase = get_supabase()
        supabase.table("accounts").update(
            {
                "access_token": account.access_token,
                "refresh_token": account.refresh_token,
                "expires_at": account.expires_at,
            }
        ).eq("id", account.id).execute()


refresher = Refresher()


@router.post("/v1/chat/completions")
async def proxy_chat(request: ChatRequest) -> dict:
    account = account_router.pick(request.model)
    if not account:
        raise HTTPException(status_code=400, detail=f"No account available for model '{request.model}'")

    if account.expired():
        if not await refresher.try_refresh(account):
            raise HTTPException(status_code=502, detail="Token refresh failed for selected account")

    account.in_flight += 1
    started = time.time()
    try:
        response = await _upstream(account, request.model, request.messages, request.stream)
    except Exception as exc:
        await _record_result(account, started, False)
        raise HTTPException(status_code=502, detail=f"Upstream error: {exc}")
    finally:
        account.in_flight = max(0, account.in_flight - 1)

    await _record_result(account, started, True)
    response.setdefault("id", f"proxy-{uuid.uuid4().hex}")
    if isinstance(response.get("model"), str):
        response["model"] = request.model
    return response


async def _upstream(account, model: str, messages: list[dict[str, Any]], stream: bool) -> dict:
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            f"{settings.nous_api_base}/chat/completions",
            headers={"Authorization": f"Bearer {account.access_token}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages, "stream": stream},
        )
    response.raise_for_status()
    return response.json()


async def _record_result(account, started: float, ok: bool) -> None:
    latency = int((time.time() - started) * 1000)
    supabase = get_supabase()
    supabase.table("accounts").update(
        {
            "total_requests": account.total_requests + 1,
            "total_errors": account.total_errors + (0 if ok else 1),
            "health_status": "healthy" if ok else "degraded",
            "last_used_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "in_flight": account.in_flight,
        }
    ).eq("id", account.id).execute()
