from fastapi import APIRouter, Request
from app.core.rate_limit_middleware import enforce_ip_rate_limit, rate_limit_429
from app.core.supabase import get_supabase

router = APIRouter(prefix="/v1/plans")


@router.get("")
async def get_plans(request: Request):
    # SECURITY: per-IP rate limit. /v1/plans is unauthenticated and exposes
    # the public price catalog. Without this, a single IP can scrape the
    # whole price list once per ms, which is a tiny leak but also a
    # useful pre-attack recon signal (attacker can confirm the service
    # is alive and read tier names). Capped at 30 req/min/IP.
    rl = await enforce_ip_rate_limit(request, endpoint="v1.plans")
    if not rl.allowed:
        raise rate_limit_429(rl)
    supabase = get_supabase()
    result = supabase.table("plan_presets").select("*").order("tier").execute()
    return {"plans": result.data or []}
