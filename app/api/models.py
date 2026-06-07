from fastapi import APIRouter

from app.core.config import settings
from app.core.router import router as account_router

router = APIRouter()

# Default models supported by Hermes/NOUS
DEFAULT_MODELS = [
    "stepfun/step-3.7-flash:free",
]


@router.get("/v1/models")
async def list_models() -> dict:
    # Reload accounts in case new ones were added
    account_router.load_accounts()

    # Collect models from all active accounts, plus defaults
    model_set = set(DEFAULT_MODELS)
    for account in account_router.accounts:
        if account.models:
            model_set.update(account.models)

    raw = sorted(model_set)
    return {
        "object": "list",
        "data": [{"id": model, "object": "model", "owned_by": "nous"} for model in raw],
    }
