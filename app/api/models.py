"""Models endpoint — OpenAI-compatible /v1/models."""
from fastapi import APIRouter, Request

from app.core.config import settings

router = APIRouter()


@router.get("/v1/models")
async def list_models(request: Request) -> dict:
    """List available models (OpenAI-compatible)."""
    # Determine available models based on tier
    models = [
        {
            "id": settings.default_model,
            "object": "model",
            "created": 1700000000,
            "owned_by": "akarouter",
            "permission": [],
        },
    ]

    # If user has pro tier, also show pro model
    auth = getattr(request.state, "auth", None)
    if auth and auth.get("tier") in ("pro", "enterprise"):
        models.append({
            "id": settings.default_pro_model,
            "object": "model",
            "created": 1700000000,
            "owned_by": "akarouter",
            "permission": [],
        })

    # Always show pro model for discovery (but requests may be rejected)
    if settings.default_pro_model not in [m["id"] for m in models]:
        models.append({
            "id": settings.default_pro_model,
            "object": "model",
            "created": 1700000000,
            "owned_by": "akarouter",
            "permission": [],
        })

    return {"object": "list", "data": models}
