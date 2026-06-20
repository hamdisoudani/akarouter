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
    # Only return plans marked is_visible=true. Enterprise is hidden from the
    # marketing /v1/plans endpoint (kept in DB for legacy accounts only).
    # Order by tier so the response is always free, starter, pro, ultra.
    # Supabase-py 2.x boolean filters are unreliable (.eq() with True,
    # .filter() with True) — they silently return all rows. Fetch all
    # plans (5 total) and filter in Python. Cost is negligible.
    result = (
        supabase.table("plan_presets")
        .select("*")
        .order("tier")
        .execute()
    )
    all_plans = result.data or []
    # Supabase-py 2.x boolean filters are unreliable; filter in Python.
    # Only plans with is_visible=true are exposed publicly. Enterprise
    # is kept in DB for legacy accounts but hidden from /v1/plans.
    plans = [p for p in all_plans if p.get("is_visible") is True]
    return {"plans": plans}
