"""AKAROUTER — Multi-Account AI Inference Proxy."""
import time
import logging
import httpx
import jwt
from jwt.algorithms import ECAlgorithm, RSAAlgorithm
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.router import authenticate_api_key
from app.core.supabase import get_supabase
from app.api import health, models, chat
from app.api.admin.routes import router as admin_router
from app.api.user import router as user_router

_SUPABASE_JWKS_URL = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"

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
    path = request.url.path
    auth_header = request.headers.get("authorization", "")
    parts = auth_header.split(" ", 1)
    token = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else ""
    print(f"MIDDLEWARE_DEBUG: path={path} auth_header_len={len(auth_header)} token_len={len(token)}")
    if token:
        print(f"MIDDLEWARE_DEBUG: token starts with={token[:15]}")


    # Public paths — no auth needed
    if any(path.startswith(p) for p in PUBLIC_PREFIXES) and not path.startswith("/v1/chat/completions"):
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
# JWKS Cache
# ---------------------------------------------------------------------------

_jwks_cache: dict | None = None
_jwks_cache_ts: float = 0.0
_JWKS_TTL = 3600


def _get_supabase_jwks() -> dict:
    """Fetch JWKS from Supabase Auth endpoint (with caching)."""
    global _jwks_cache, _jwks_cache_ts
    now = time.time()
    if _jwks_cache is not None and (now - _jwks_cache_ts) < _JWKS_TTL:
        logger.debug("JWKS: serving from cache (%d keys)", len(_jwks_cache.get("keys", [])))
        return _jwks_cache

    logger.info("JWKS: fetching from %s", _SUPABASE_JWKS_URL)
    try:
        resp = httpx.get(_SUPABASE_JWKS_URL, timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_cache_ts = now
        logger.info("JWKS: fetched %d keys from %s", len(_jwks_cache.get("keys", [])), _SUPABASE_JWKS_URL)
        return _jwks_cache
    except Exception as exc:
        logger.error("JWKS: fetch failed: %s", exc)
        if _jwks_cache is not None:
            return _jwks_cache
        raise


# ---------------------------------------------------------------------------
# Supabase JWT verification via JWKS
# ---------------------------------------------------------------------------

def _verify_supabase_jwt(token: str) -> dict | None:
    """Verify a Supabase JWT via JWKS and return user info with role."""
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        alg = header.get("alg", "ES256")
        logger.info("JWT_DEBUG: token kid=%s alg=%s", kid, alg)
        if not kid:
            logger.warning("Supabase JWT missing kid header")
            return None

        jwks = _get_supabase_jwks()
        logger.info("JWT_DEBUG: jwks_url=%s keys_count=%s", _SUPABASE_JWKS_URL, len(jwks.get("keys", [])))
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if not key:
            logger.warning("Supabase JWT kid not found in JWKS: %s", kid)
            return None

        key_alg = key.get("alg", alg)
        logger.info("JWT_DEBUG: key found kid=%s alg=%s", key.get("kid"), key_alg)

        # ES256 uses elliptic curve keys; RS256 uses RSA keys
        if key_alg.startswith("ES"):
            public_key = ECAlgorithm.from_jwk(key)
        else:
            public_key = RSAAlgorithm.from_jwk(key)

        payload = jwt.decode(
            token,
            key=public_key,
            algorithms=[alg],
            options={"verify_aud": False},
        )
        logger.info("JWT_DEBUG: decoded sub=%s email=%s", payload.get("sub"), payload.get("email"))
        sub = payload.get("sub")
        if not sub:
            return None

        supabase = get_supabase()
        account_resp = supabase.table("accounts").select("id,email,role,tier,status").eq("auth_user_id", str(sub)).execute()
        logger.info("JWT_DEBUG: account lookup count=%s data=%s", len(account_resp.data or []), account_resp.data)
        if not account_resp.data:
            logger.warning("JWT_DEBUG: no account found for sub=%s", sub)
            return None

        account = account_resp.data[0]
        return {
            "auth_user_id": str(sub),
            "account_id": account["id"],
            "email": account.get("email", payload.get("email", "")),
            "role": account.get("role", "user"),
            "tier": account.get("tier", "free"),
            "status": account.get("status", "active"),
        }
    except jwt.ExpiredSignatureError:
        logger.warning("Supabase JWT expired")
        return None
    except jwt.InvalidTokenError as exc:
        logger.warning("Supabase JWT invalid: %s", exc)
        return None
    except Exception as exc:
        logger.error("Supabase JWT verification error: %s", exc, exc_info=True)
        return None


_jwks_cache: dict | None = None


def _get_supabase_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    resp = httpx.get(_SUPABASE_JWKS_URL, timeout=10)
    resp.raise_for_status()
    _jwks_cache = resp.json()
    return _jwks_cache

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
