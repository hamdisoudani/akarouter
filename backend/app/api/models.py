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
        result = supabase.table("model_mapping").select(
            "alias, display_name, provider_name, description, is_active, capabilities, "
            "input_cost_per_million, output_cost_per_million, pricing_mode, "
            "cost_per_request_cents, is_free_provider, points_cost, "
            "context_window_tokens, max_output_tokens, input_modalities, output_modalities, "
            "knowledge_cutoff, released_date, supports_vision, supports_video, supports_audio, "
            "supports_tool_use, supports_function_calling, supports_reasoning, specs_source"
        ).eq("is_active", True).execute()
        if result.data:
            return {
                "object": "list",
                "data": [
                    {
                        "id": row["alias"],
                        "object": "model",
                        "owned_by": "akarouter",
                        "display_name": row.get("display_name", row["alias"]),
                        "provider_name": row.get("provider_name", ""),
                        "is_free_provider": row.get("is_free_provider", False),
                        "description": row.get("description", ""),
                        "is_active": row.get("is_active", True),
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


@router.get("/v1/plans")
async def list_plans() -> dict:
    """List plan presets — allows the frontend to dynamically display limits."""
    try:
        supabase = get_supabase()
        result = supabase.table("plan_presets").select("*").order("monthly_limit", desc=False).execute()
        if result.data:
            return {"plans": result.data}
    except Exception as e:
        logger.error(f"Failed to fetch plan presets from database: {e}")
        
    return {
        "plans": [
            {
                "tier": "free",
                "monthly_limit": 0.0,
                "rpm_limit": 0,
                "tokens_5h_limit": 0.0,
                "tokens_7d_limit": 0.0,
                "monthly_point_allowance": 100,
                "daily_free_requests_limit": 10
            },
            {
                "tier": "starter",
                "monthly_limit": 10.0,
                "rpm_limit": 60,
                "tokens_5h_limit": 1.0,
                "tokens_7d_limit": 5.0,
                "monthly_point_allowance": 500,
                "daily_free_requests_limit": 0
            },
            {
                "tier": "pro",
                "monthly_limit": 100.0,
                "rpm_limit": 300,
                "tokens_5h_limit": 10.0,
                "tokens_7d_limit": 50.0,
                "monthly_point_allowance": 2500,
                "daily_free_requests_limit": 0
            },
            {
                "tier": "ultra",
                "monthly_limit": 1000.0,
                "rpm_limit": 1000,
                "tokens_5h_limit": 100.0,
                "tokens_7d_limit": 500.0,
                "monthly_point_allowance": 7500,
                "daily_free_requests_limit": 0
            }
        ]
    }
