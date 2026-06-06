"""Health check endpoints."""
import logging
from fastapi import APIRouter
from app.core.supabase import get_supabase
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """Detailed health check with account and provider status."""
    if not settings.supabase_configured:
        return {"ok": True, "accounts": 0, "provider": "nous", "details": [], "note": "Supabase not configured"}

    try:
        supabase = get_supabase()
        rows = (
            supabase.table("providers")
            .select("id,account_label,health_status,weight,total_requests,total_errors,in_flight,last_used_at")
            .execute()
            .data or []
        )
        return {
            "ok": True,
            "accounts": len(rows),
            "provider": "nous",
            "details": rows,
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {"ok": False, "error": str(e), "accounts": 0, "provider": "nous", "details": []}


@router.get("/healthz")
async def healthz() -> dict:
    """Lightweight health check for Railway / load balancers."""
    return {"ok": True}
