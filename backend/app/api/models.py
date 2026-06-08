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
        result = supabase.table("model_mapping").select("alias, display_name, description, is_active").eq("is_active", True).execute()
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
            }
            for alias in settings.model_mapping
        ],
    }
