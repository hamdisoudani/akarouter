"""AKAROUTER — Multi-Account AI Inference Proxy."""
import logging

from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.router import authenticate_api_key
from app.api import health, models, chat
from app.api.admin.routes import router as admin_router
from app.api.user import router as user_router

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("akarouter")

app = FastAPI(
    title="AKAROUTER",
    description="Multi-Account AI Inference Proxy — OpenAI-compatible API with health-weighted routing, auto-refresh, and Supabase-backed state.",
    version="0.2.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow frontend and direct API access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth middleware — extract API key for /v1/* and /user/* endpoints
# ---------------------------------------------------------------------------

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Authenticate requests to protected endpoints."""
    path = request.url.path

    # Public endpoints — no auth required
    public_prefixes = ("/health", "/healthz", "/docs", "/redoc", "/openapi", "/v1/models")
    if any(path.startswith(p) for p in public_prefixes) and path != "/v1/chat/completions":
        return await call_next(request)

    # Admin endpoints use their own auth
    if path.startswith("/admin"):
        return await call_next(request)

    # Protected: extract Bearer token
    auth_header = request.headers.get("authorization", "")
    parts = auth_header.split(" ", 1)
    api_key = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else None

    if api_key:
        auth_result = await authenticate_api_key(api_key)
        if auth_result:
            request.state.auth = auth_result
        # If auth fails, let the endpoint handle 401

    return await call_next(request)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

app.include_router(health.router, tags=["Health"])
app.include_router(models.router, tags=["Models"])
app.include_router(chat.router, tags=["Chat"])
app.include_router(admin_router, tags=["Admin"])
app.include_router(user_router, tags=["User"])


@app.get("/")
async def root():
    """Root redirect to docs."""
    return {
        "service": "AKAROUTER",
        "version": "0.2.0",
        "docs": "/docs",
        "health": "/health",
        "endpoints": {
            "chat": "POST /v1/chat/completions",
            "models": "GET /v1/models",
            "admin": "/admin/*",
            "user": "/user/*",
        },
    }


@app.on_event("startup")
async def startup():
    logger.info(f"AKAROUTER starting in {settings.app_env} mode")
    logger.info(f"Supabase configured: {settings.supabase_configured}")
    logger.info(f"Nous API base: {settings.nous_api_base}")


import asyncio
import time
import httpx
from datetime import datetime, timezone
from app.core.supabase import get_supabase

# ---------------------------------------------------------------------------
# Background Token Refresh Task
# ---------------------------------------------------------------------------
async def refresh_tokens_task():
    logger.info("Started background token refresh task")
    supabase = get_supabase()

    while True:
        try:
            # Query for active providers whose tokens are expiring soon (within next 5 minutes)
            # or already expired. We can do this safely by selecting all active and checking dates.
            # In production, doing a direct SQL filter is better, but Supabase Rest allows `.lt()`

            # 5 minutes from now in ISO
            threshold_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 300))

            result = supabase.table("providers").select("id, account_label, refresh_token, token_expires_at, health_status").eq("health_status", "active").lt("token_expires_at", threshold_iso).execute()

            providers_to_refresh = result.data

            for provider in providers_to_refresh:
                logger.info(f"Refreshing token for provider: {provider['account_label']} (expires_at: {provider['token_expires_at']})")

                async with httpx.AsyncClient() as client:
                    resp = await client.post(
                        settings.nous_token_url,
                        data={
                            "grant_type": "refresh_token",
                            "refresh_token": provider["refresh_token"],
                            "client_id": settings.nous_client_id,
                        },
                        headers={"x-nous-refresh-token": provider["refresh_token"]}
                    )

                    if resp.status_code == 200:
                        data = resp.json()
                        new_access_token = data.get("access_token")
                        new_refresh_token = data.get("refresh_token", provider["refresh_token"])
                        token_expires_in = int(data.get("expires_in", 900))

                        new_expires_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + token_expires_in - 120))

                        supabase.table("providers").update({
                            "access_token": new_access_token,
                            "refresh_token": new_refresh_token,
                            "token_expires_at": new_expires_at,
                        }).eq("id", provider["id"]).execute()
                        logger.info(f"Successfully refreshed token for {provider['account_label']}")
                    else:
                        err = resp.json().get("error", "Unknown")
                        logger.error(f"Failed to refresh token for {provider['account_label']}: {resp.status_code} {err}")

                        # Optionally mark degraded if refresh fails
                        if "invalid_grant" in str(err) or "expired" in str(err):
                            supabase.table("providers").update({"health_status": "degraded"}).eq("id", provider["id"]).execute()

        except Exception as e:
            logger.error(f"Error in token refresh task: {e}")

        # Sleep for 1 minute before checking again
        await asyncio.sleep(60)

# Add startup event to trigger the background task
@app.on_event("startup")
async def start_background_tasks():
    asyncio.create_task(refresh_tokens_task())
