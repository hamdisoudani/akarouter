"""AKAROUTER Models endpoint — returns AkaRouter-branded model names."""
from fastapi import APIRouter, Request
from app.core.config import settings
from app.core.supabase import get_supabase

router = APIRouter()


@router.get("/v1/models")
async def list_models(request: Request) -> dict:
    """List available models — AkaRouter branded names from model_mapping table."""
    # Try DB first (allows dynamic updates from admin)
    try:
        supabase = get_supabase()
        result = supabase.table("model_mapping").select("alias, display_name, description, is_active, capabilities, input_cost_per_million, output_cost_per_million").execute()
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
