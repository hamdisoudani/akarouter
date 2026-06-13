"""AKAROUTER — Multi-Account AI Inference Proxy."""
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.router import authenticate_api_key
from app.core.supabase import get_supabase, _verify_supabase_jwt
from app.api import health, models, chat
from app.api.admin.routes import router as admin_router
from app.api.user import router as user_router
from app.api.hosted_agents import router as hosted_agents_router
from app.api.webhooks import router as webhooks_router


# Configure logging
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
# Suppress chatty third-party library logs
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("supabase").setLevel(logging.WARNING)
logging.getLogger("postgrest").setLevel(logging.WARNING)
logging.getLogger("gotrue").setLevel(logging.WARNING)

# Set app and akarouter logger to INFO to track subscriptions and completions activity
logging.getLogger("app").setLevel(logging.INFO)
logger = logging.getLogger("akarouter")
logger.setLevel(logging.INFO)

app = FastAPI(
    title="AKAROUTER",
    description="Multi-Account AI Inference Proxy — OpenAI-compatible API with health-weighted routing, auto-refresh, and Supabase-backed state.",
    version="0.3.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------

PUBLIC_PREFIXES = ("/health", "/healthz", "/docs", "/redoc", "/openapi", "/v1/models", "/v1/plans", "/v1/webhooks", "/")
ADMIN_PREFIX = "/admin"
USER_PREFIX = "/user"


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    auth_header = request.headers.get("authorization", "")
    parts = auth_header.split(" ", 1)
    token = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else ""
    print(f"MIDDLEWARE_DEBUG: path={path} auth_header_len={len(auth_header)} token_len={len(token)}")
    if token:
        print(f"MIDDLEWARE_DEBUG: token starts with={token[:15]}")

    # Enforce gateway-wide status check for completions and model paths
    if path.startswith("/v1/"):
        from app.core.cache import is_gateway_enabled
        if not is_gateway_enabled():
            return JSONResponse(
                status_code=503,
                content={"detail": "AkaRouter API gateway is temporarily disabled by administrator"}
            )


    # Public paths — no auth needed
    is_public = path == "/" or any(path.startswith(p) for p in PUBLIC_PREFIXES if p != "/")
    if is_public and not path.startswith("/v1/chat/completions"):
        return await call_next(request)

    # Admin endpoints — handled by _verify_admin inside each route
    if path.startswith(ADMIN_PREFIX):
        return await call_next(request)



    if not token:
        if path.startswith(USER_PREFIX):
            return JSONResponse(status_code=401, content={"detail": "Authorization required"})
        if path == "/v1/chat/completions":
            return JSONResponse(status_code=401, content={"detail": "API key required"})
        return await call_next(request)

    # Try API key auth first (tokens starting with "akar_")
    if token.startswith("akar_"):
        from app.core.router import RateLimitException, BudgetLimitException, SuspendedAccountException
        check_limits = path.startswith("/v1/")
        try:
            auth_result = await authenticate_api_key(token, check_limits=check_limits)
        except RateLimitException as e:
            return JSONResponse(status_code=429, content={"detail": str(e)})
        except BudgetLimitException as e:
            return JSONResponse(status_code=429, content={"detail": str(e)})
        except SuspendedAccountException as e:
            return JSONResponse(status_code=403, content={"detail": str(e)})
            
        if auth_result:
            request.state.auth = auth_result
            return await call_next(request)
        return JSONResponse(status_code=401, content={"detail": "Invalid API key"})

    # Try Supabase JWT auth
    if token.startswith("eyJ"):
        try:
            user_info = _verify_supabase_jwt(token)
            if user_info:
                user_status = user_info.get("status") or "active"
                if user_status != "active":
                    # Pending activation accounts can access /user/me, /user/usage, and /user/activate
                    is_allowed_pending_path = user_status == "pending" and path in ("/user/me", "/user/usage", "/user/activate")
                    if not is_allowed_pending_path:
                        if not (path.startswith(ADMIN_PREFIX) and user_info.get("role") == "admin"):
                            detail_msg = f"Account status is {user_status}"
                            if user_status == "suspended":
                                detail_msg = f"Account is suspended: {user_info.get('suspended_reason') or 'Suspended by administrator'}"
                            return JSONResponse(
                                status_code=403, 
                                content={"detail": detail_msg}
                            )
                request.state.supabase_user = user_info
                request.state.auth = {
                    "account_id": user_info["account_id"],
                    "email": user_info.get("email", ""),
                    "tier": user_info.get("tier", "free"),
                    "role": user_info.get("role", "user"),
                }
                return await call_next(request)
            else:
                logger.warning("AUTH: _verify_supabase_jwt returned None for path=%s", path)
        except Exception as exc:
            logger.error("AUTH: JWT verification exception: %s", exc, exc_info=True)

    if path.startswith(USER_PREFIX):
        return JSONResponse(status_code=401, content={"detail": "Invalid credentials"})

    if path == "/v1/chat/completions":
        return JSONResponse(status_code=401, content={"detail": "Invalid credentials"})

    return await call_next(request)





# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

app.include_router(health.router, tags=["Health"])
app.include_router(models.router, tags=["Models"])
app.include_router(chat.router, tags=["Chat"])
app.include_router(admin_router, tags=["Admin"])
app.include_router(user_router, tags=["User"])
app.include_router(hosted_agents_router, tags=["Hosted Agents"])
app.include_router(webhooks_router, tags=["Webhooks"])



@app.get("/")
async def root():
    return {
        "service": "AKAROUTER",
        "version": "0.3.0",
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
    
    # Start the background cache and write-buffer flusher
    from app.core.cache import start_flusher
    start_flusher()


@app.on_event("shutdown")
async def shutdown():
    logger.info("AKAROUTER shutting down")
    
    # Stop flusher task and execute final database flush
    from app.core.cache import stop_flusher
    await stop_flusher()
