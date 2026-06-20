"""AKAROUTER Models endpoint — returns AkaRouter-branded model names."""
import logging
from fastapi import APIRouter, Request
from app.core.config import settings
from app.core.rate_limit_middleware import enforce_ip_rate_limit, rate_limit_429
from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/v1/models")
async def list_models(request: Request) -> dict:
    """List available models — AkaRouter branded names from model_mapping table."""
    # SECURITY: per-IP rate limit. This endpoint is unauthenticated and
    # exposes the model catalog, so an attacker can scrape it freely
    # without throttling — capped at 30 req/min/IP.
    rl = await enforce_ip_rate_limit(request, endpoint="v1.models")
    if not rl.allowed:
        raise rate_limit_429(rl)

    # Try DB first (allows dynamic updates from admin)
    try:
        supabase = get_supabase()
        # Include both active models AND is_upcoming models (so the UI can show
        # "Feature Upcoming" for not-yet-released ones). Filter out deprecated
        # ones (is_active=false AND is_upcoming=false).
        result = supabase.table("model_mapping").select(
            "alias, slug, display_name, provider_name, description, is_active, capabilities, "
            "input_cost_per_million, output_cost_per_million, pricing_mode, "
            "cost_per_request_cents, is_free_provider, points_cost, "
            "context_window_tokens, max_output_tokens, input_modalities, output_modalities, "
            "knowledge_cutoff, released_date, supports_vision, supports_video, supports_audio, "
            "supports_tool_use, supports_function_calling, supports_reasoning, specs_source, "
            "is_upcoming, is_promotional, promotional_discount_pct, promotional_admin_note"
        ).or_("is_active.eq.true,is_upcoming.eq.true").execute()
        if result.data:
            return {
                "object": "list",
                "data": [
                    {
                        # 2026-06-20: `id` is now the provider slug (e.g. 'claude-opus-48'),
                        # NOT the internal alias. The slug is the user-facing identifier
                        # used in /models/[id]/page.tsx and in /v1/chat/completions calls.
                        # Internal alias is kept in `alias` for backward compat / admin tools.
                        "id": row.get("slug") or row["alias"],
                        "alias": row["alias"],
                        "object": "model",
                        "owned_by": "akarouter",
                        "display_name": row.get("display_name", row["alias"]),
                        "provider_name": row.get("provider_name", ""),
                        "is_free_provider": row.get("is_free_provider", False),
                        "description": row.get("description", ""),
                        "is_active": row.get("is_active", True),
                        # is_upcoming: shown in catalog with price, but chat returns 403.
                        "is_upcoming": bool(row.get("is_upcoming", False)),
                        # NEW (2026-06-20): promotional model flag + discount.
                        # is_promotional models get an additional %-off on top of
                        # the plan-tier multiplier. Use for loss leaders / launch
                        # promos (e.g. MiniMax-M3).
                        "is_promotional": bool(row.get("is_promotional", False)),
                        "promotional_discount_pct": float(row.get("promotional_discount_pct") or 0),
                        "promotional_admin_note": row.get("promotional_admin_note") or "",
                        "capabilities": row.get("capabilities") or ["text"],
                        "input_cost_per_million": row.get("input_cost_per_million", 0.10),
                        "output_cost_per_million": row.get("output_cost_per_million", 0.30),
                        "pricing_mode": row.get("pricing_mode", "per_token"),
                        "cost_per_request_cents": row.get("cost_per_request_cents"),
                        # Per-call point cost (admin-editable, default 5)
                        "points_cost": row.get("points_cost", 5),
                        # Authoritative specs from research (2026-06-19)
                        "context_length": row.get("context_window_tokens") or 1000000,
                        "max_output_tokens": row.get("max_output_tokens") or 8192,
                        "input_modalities": row.get("input_modalities") or ["text"],
                        "output_modalities": row.get("output_modalities") or ["text"],
                        "knowledge_cutoff": row.get("knowledge_cutoff"),
                        "released_date": row.get("released_date"),
                        "supports": {
                            "vision": bool(row.get("supports_vision")),
                            "video": bool(row.get("supports_video")),
                            "audio": bool(row.get("supports_audio")),
                            "tool_use": bool(row.get("supports_tool_use")),
                            "function_calling": bool(row.get("supports_function_calling")),
                            "reasoning": bool(row.get("supports_reasoning")),
                        },
                    }
                    for row in result.data
                ],
            }
    except Exception:
        pass

    # Fallback to config mapping
    return {
        "object": "list",
        "data": [
            {
                "id": alias,
                "object": "model",
                "owned_by": "akarouter",
                "display_name": alias.replace("-", " ").title(),
                "provider_name": "",
                "is_free_provider": False,
                "is_active": True,
                "capabilities": ["text", "vision"] if alias == "akarouter-pro" else ["text"],
                "input_cost_per_million": settings.model_pricing.get(alias, {}).get("input_cost_per_million", 0.10),
                "output_cost_per_million": settings.model_pricing.get(alias, {}).get("output_cost_per_million", 0.30),
                "pricing_mode": "per_token",
                "cost_per_request_cents": None,
                # Fallback per-call point cost (config-driven; can be overridden via DB)
                "points_cost": settings.model_pricing.get(alias, {}).get("points_cost", 5),
                "context_length": (
                    256000 if alias == "akarouter-pro" else 1000000
                ),
            }
            for alias in settings.model_mapping
        ],
    }


@router.get("/v1/billing-matrix")
async def get_billing_matrix() -> dict:
    """Return the effective points cost for every model on every tier.

    The /upgrade page uses this to render a 'cost per request' table that
    shows how each model's point cost drops on higher tiers. Public endpoint
    (no auth) so the upgrade page can render before login.

    Response shape:
      {
        "tiers": ["free", "starter", "pro", "ultra"],  # enterprise hidden
        "plan_multipliers": { tier: float },
        "monthly_allowances": { tier: int },
        "rpm_limits": { tier: int },
        "models": [
          { alias, display_name, provider_name, is_upcoming, is_promotional,
            promotional_discount_pct, costs: { tier: { base, effective } } }
        ]
      }
    """
    try:
        from app.core.chat_billing import get_effective_points_cost
        tiers = ["free", "starter", "pro", "ultra"]  # enterprise not shown publicly
        # Read plans fresh from DB (bypass cache — values must reflect post-migration state)
        supabase = get_supabase()
        plans_res = supabase.table("plan_presets").select(
            "tier, points_cost_multiplier, monthly_point_allowance, daily_free_requests_limit, rpm_limit, price, billing_period"
        ).execute()
        # Supabase-py 2.x boolean filters are unreliable — filter in Python.
        # Only public tiers (no enterprise) are exposed via the matrix.
        multipliers: dict[str, float] = {}
        allowances: dict[str, int] = {}
        rpm_limits: dict[str, int] = {}
        prices: dict[str, str] = {}
        billing_periods: dict[str, str] = {}
        for row in (plans_res.data or []):
            if row.get("is_visible") is not True:
                continue
            t = row.get("tier")
            if t:
                multipliers[t] = float(row.get("points_cost_multiplier") or 1.0)
                allowances[t] = int(row.get("monthly_point_allowance") or 0)
                rpm_limits[t] = int(row.get("rpm_limit") or 0)
                prices[t] = row.get("price") or "$0"
                billing_periods[t] = row.get("billing_period") or "mo"
        # Fetch models (active + upcoming only)
        supabase = get_supabase()
        result = supabase.table("model_mapping").select(
            "alias, slug, display_name, provider_name, is_upcoming, is_promotional, "
            "promotional_discount_pct, points_cost, pricing_mode"
        ).or_("is_active.eq.true,is_upcoming.eq.true").execute()
        models_out: list[dict] = []
        if result.data:
            for row in result.data:
                alias = row.get("alias")
                slug = row.get("slug") or alias
                base_pts = int(row.get("points_cost") or 1)
                costs: dict[str, dict[str, int]] = {}
                for tier in tiers:
                    try:
                        effective = get_effective_points_cost(alias, tier)
                    except Exception:
                        effective = base_pts
                    costs[tier] = {
                        "base": base_pts,
                        "effective": effective,
                    }
                models_out.append({
                    # 2026-06-20: `id` is the user-facing provider slug (e.g. 'claude-opus-48').
                    # `alias` kept for admin / internal use. Frontend uses `id` for display.
                    "id": slug,
                    "alias": alias,
                    "slug": slug,
                    "display_name": row.get("display_name") or alias,
                    "provider_name": row.get("provider_name") or "",
                    "is_upcoming": bool(row.get("is_upcoming")),
                    "is_promotional": bool(row.get("is_promotional")),
                    "promotional_discount_pct": float(row.get("promotional_discount_pct") or 0),
                    "pricing_mode": row.get("pricing_mode") or "per_request",
                    "costs": costs,
                })
        return {
            "tiers": tiers,
            "plan_multipliers": multipliers,
            "monthly_allowances": allowances,
            "rpm_limits": rpm_limits,
            "prices": prices,
            "billing_periods": billing_periods,
            "models": models_out,
        }
    except Exception as e:
        logger.error(f"billing matrix fetch failed: {e}")
        return {"tiers": [], "plan_multipliers": {}, "monthly_allowances": {}, "rpm_limits": {}, "prices": {}, "billing_periods": {}, "models": [], "error": str(e)}


# NOTE (2026-06-20): /v1/plans is owned by app.api.plans (registered later
# in main.py). FastAPI uses the FIRST registered handler for a given path,
# so this duplicate endpoint used to win and bypass the is_visible filter.
# Removed. The proper handler with visibility filter lives in app/api/plans.py.
