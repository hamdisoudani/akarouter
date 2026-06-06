from fastapi import APIRouter
from app.core.router import router as account_router

router = APIRouter()


@router.get("/v1/models")
async def list_models() -> dict:
    raw = sorted({model for account in account_router.accounts for model in account.models})
    return {
        "object": "list",
        "data": [{"id": model, "object": "model"} for model in raw],
    }
