from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.api import admin, chat, health, models
from app.core.router import router as account_router

app = FastAPI(
    title="AKAROUTER",
    description="Multi-account AI inference proxy with round-robin routing",
    version="0.1.0",
)

app.include_router(health.router)
app.include_router(models.router)
app.include_router(chat.router)
app.include_router(admin.router)


@app.on_event("startup")
async def startup() -> None:
    try:
        account_router.load_accounts()
        print(f"[startup] Loaded {len(account_router.accounts)} accounts from Supabase")
    except Exception as exc:
        print(f"[startup] Failed to load accounts: {exc}")


@app.get("/")
async def root() -> JSONResponse:
    return JSONResponse({"service": "akarouter", "status": "ok", "docs": "/docs"})
