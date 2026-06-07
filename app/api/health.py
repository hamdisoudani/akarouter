from fastapi import APIRouter

from app.core.router import router as account_router
from app.core.supabase import get_supabase

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    supabase = get_supabase()
    rows = (
        supabase.table("providers")
        .select("id,account_label,health_status,weight,total_requests,total_errors,in_flight,last_used_at,updated_at")
        .execute()
        .data or []
    )
    return {
        "ok": True,
        "accounts": len(rows),
        "provider": "nous",
        "details": rows,
    }


@router.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}
