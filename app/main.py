"""AKAROUTER — Multi-Account AI Inference Proxy."""
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.router import authenticate_api_key
from app.core.supabase import get_supabase
from app.api import health, models, chat
from app.api.admin.routes import router as admin_router
from app.api.user import router as user_router

# Configure logging BEFORE anything else
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("akarouter")
logger.setLevel(logging.DEBUG)

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

PUBLIC_PREFIXES = ("/health", "/healthz", "/docs", "/redoc", "/openapi", "/v1/models", "/")
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
        auth_result = await authenticate_api_key(token)
        if auth_result:
            request.state.auth = auth_result
            return await call_next(request)
        return JSONResponse(status_code=401, content={"detail": "Invalid API key"})

    # Try Supabase JWT auth
    if token.startswith("eyJ"):
        try:
            user_info = _verify_supabase_jwt(token)
            if user_info:
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
# Supabase JWT verification
# ---------------------------------------------------------------------------

def _verify_supabase_jwt(token: str) -> dict | None:
    """Verify a Supabase JWT via Supabase Auth API and return user info with role."""
    try:
        supabase = get_supabase()
        # Retrieve user from token (validates the signature and session in real-time)
        user_resp = supabase.auth.get_user(token)
        if not user_resp or not getattr(user_resp, "user", None):
            logger.warning("Supabase Auth: failed to retrieve user from token")
            return None

        user = user_resp.user
        auth_user_id = user.id

        # Look up account in our DB
        account_resp = supabase.table("accounts").select("id, email, role, tier, status").eq("auth_user_id", str(auth_user_id)).execute()
        if not account_resp.data:
            logger.warning("Supabase Auth: no user account found in DB for auth_user_id=%s", auth_user_id)
            return None

        account = account_resp.data[0]
        return {
            "auth_user_id": str(auth_user_id),
            "account_id": account["id"],
            "email": account.get("email", user.email or ""),
            "role": account.get("role", "user"),
            "tier": account.get("tier", "free"),
            "status": account.get("status", "active"),
        }
    except Exception as exc:
        logger.error("Supabase Auth: verification failed: %s", exc, exc_info=True)
        return None


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
