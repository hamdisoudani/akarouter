"""AKAROUTER Models endpoint — returns AkaRouter-branded model names."""
import logging
from fastapi import APIRouter, Request
from app.core.config import settings
from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/v1/models")
async def list_models(request: Request) -> dict:
    """List available models — AkaRouter branded names from model_mapping table."""
    # Try DB first (allows dynamic updates from admin)
    try:
        supabase = get_supabase()
        result = supabase.table("model_mapping").select("alias, display_name, description, is_active, capabilities, input_cost_per_million, output_cost_per_million").eq("is_active", True).execute()
        if result.data:
            return {
                "object": "list",
                "data": [
                    {
                        "id": row["alias"],
                        "object": "model",
                        "owned_by": "akarouter",
                        "display_name": row.get("display_name", row["alias"]),
                        "description": row.get("description", ""),
                        "is_active": row.get("is_active", True),
                        "capabilities": row.get("capabilities") or ["text"],
                        "input_cost_per_million": row.get("input_cost_per_million", 0.10),
                        "output_cost_per_million": row.get("output_cost_per_million", 0.30),
                        "context_length": (
                            256000 if row["alias"] == "akarouter-pro" else 1000000
                        ),
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
                "is_active": True,
                "capabilities": ["text", "vision"] if alias == "akarouter-pro" else ["text"],
                "input_cost_per_million": settings.model_pricing.get(alias, {}).get("input_cost_per_million", 0.10),
                "output_cost_per_million": settings.model_pricing.get(alias, {}).get("output_cost_per_million", 0.30),
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
                "openclaw_enabled": False,
                "max_agents": 0,
                "agent_cpu": 1,
                "agent_ram": 1
            },
            {
                "tier": "starter",
                "monthly_limit": 10.0,
                "rpm_limit": 60,
                "tokens_5h_limit": 1.0,
                "tokens_7d_limit": 5.0,
                "openclaw_enabled": False,
                "max_agents": 0,
                "agent_cpu": 1,
                "agent_ram": 1
            },
            {
                "tier": "pro",
                "monthly_limit": 100.0,
                "rpm_limit": 300,
                "tokens_5h_limit": 10.0,
                "tokens_7d_limit": 50.0,
                "openclaw_enabled": True,
                "max_agents": 2,
                "agent_cpu": 1,
                "agent_ram": 2
            },
            {
                "tier": "ultra",
                "monthly_limit": 1000.0,
                "rpm_limit": 1000,
                "tokens_5h_limit": 100.0,
                "tokens_7d_limit": 500.0,
                "openclaw_enabled": True,
                "max_agents": 5,
                "agent_cpu": 2,
                "agent_ram": 4
            }
        ]
    }
