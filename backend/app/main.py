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
from app.api.webhooks import router as webhooks_router
from app.api.plans import router as plans_router
from app.core.http_client import init_http_client, close_http_client


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

# CORS — fail-closed in production.
# SECURITY: an empty cors_origins list used to fall back to ["*"] which is a wildcard
# CORS origin. Even with allow_credentials=False, a wildcard origin still exposes the
# API to any site (browsers will reflect the request). In production, an empty / missing
# AKAROUTER_CORS_ORIGINS now causes startup to fail rather than silently opening CORS.
def _resolve_cors_origins() -> list[str]:
    raw = [str(o).strip() for o in settings.cors_origins if o]
    if not raw:
        if settings.app_env == "production":
            raise RuntimeError(
                "AKAROUTER_CORS_ORIGINS is empty in production. "
                "Refusing to start with a permissive CORS policy. "
                "Set the env var to a comma-separated list of allowed origins."
            )
        # In dev, default to localhost:3000 (Next.js dev server)
        return ["http://localhost:3000"]
    # Reject wildcard in production
    if settings.app_env == "production" and "*" in raw:
        raise RuntimeError(
            "AKAROUTER_CORS_ORIGINS contains '*' in production. "
            "Wildcard CORS origins are not allowed in non-dev environments."
        )
    return raw

cors_origins = _resolve_cors_origins()
allow_credentials = "*" not in cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_credentials,
    # Restrict to methods we actually use. Wildcards make CSRF / cross-origin abuse surface larger.
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    # Restrict to headers we actually accept. Authorization + Content-Type cover all current calls.
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    # Cache preflight for 1 hour to avoid hammering OPTIONS.
    max_age=3600,
)

# Security headers — applied after CORS so we don't strip the CORS
# headers the middleware adds (Access-Control-Allow-Origin etc.). The
# security_headers middleware is non-destructive: it never overwrites
# a header a route handler set, so anything CORS adds is preserved.
from app.core.security_headers import SecurityHeadersMiddleware
app.add_middleware(SecurityHeadersMiddleware)


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
app.include_router(webhooks_router, tags=["Webhooks"])
app.include_router(plans_router, tags=["Plans"])



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

    # SECURITY: fail-closed in production if the Fernet encryption secret is missing or
    # the wrong length. An empty secret either crashes Fernet at first use (good) or, in
    # edge cases, derives a deterministic key from empty bytes (bad). Force the failure
    # to surface at startup, not on the first encrypt call.
    if not settings.agent_key_encryption_secret or len(settings.agent_key_encryption_secret) < 32:
        if settings.app_env == "production":
            raise RuntimeError(
                "AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET is missing or too short in production. "
                "Generate a 32-byte url-safe base64 Fernet key with: "
                "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`"
            )
        logger.warning(
            "AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET is missing or weak. "
            "Provider endpoint API key encryption will FAIL on first use. Set it before deploying to production."
        )

    # SECURITY: in production, refuse to start without a webhook secret.
    if settings.app_env == "production" and not settings.whop_webhook_secret:
        raise RuntimeError(
            "AKAROUTER_WHOP_WEBHOOK_SECRET is missing in production. "
            "Webhook signature verification would be disabled. Refusing to start."
        )

    # Initialize the global HTTP client pool
    await init_http_client()

    # Initialize the in-memory rate limiter. Stored on app.state so
    # route handlers can pull it via `request.app.state.rate_limiter`.
    # In-memory only — no shared state across instances. A future Redis
    # implementation can drop in behind the same RateLimiter Protocol.
    from app.core.rate_limit import InMemoryRateLimiter
    app.state.rate_limiter = InMemoryRateLimiter()
    logger.info("Rate limiter initialized (in-memory, sliding-window log)")

    # Start the background cache and write-buffer flusher
    from app.core.cache import start_flusher
    start_flusher()

    # Auto-migrate model_mapping to add slug column if missing (idempotent).
    # Uses psycopg2 directly because Supabase PostgREST RPC isn't available here.
    try:
        import psycopg2
        if settings.supabase_db_url:
            conn = psycopg2.connect(settings.supabase_db_url)
            conn.autocommit = True
            cur = conn.cursor()
            # 1. Add slug column (idempotent)
            cur.execute("ALTER TABLE model_mapping ADD COLUMN IF NOT EXISTS slug TEXT;")
            # 2. Backfill from display_name (lowercase, dashes, alphanumeric)
            cur.execute(
                "UPDATE model_mapping SET slug = LOWER(REGEXP_REPLACE(REGEXP_REPLACE("
                "COALESCE(display_name, alias), '[^a-zA-Z0-9\\s-]', '', 'g'), '\\s+', '-', 'g'))"
                " WHERE slug IS NULL;"
            )
            # 3. Resolve any duplicate slugs (append -2, -3, ...)
            cur.execute("""
                DO $$
                DECLARE
                  dup RECORD;
                  counter INT;
                BEGIN
                  FOR dup IN
                    SELECT alias, slug FROM model_mapping
                    WHERE slug IN (
                      SELECT slug FROM model_mapping GROUP BY slug HAVING COUNT(*) > 1
                    )
                  LOOP
                    counter := 1;
                    WHILE EXISTS (SELECT 1 FROM model_mapping WHERE slug = dup.slug || '-' || counter) LOOP
                      counter := counter + 1;
                    END LOOP;
                    UPDATE model_mapping SET slug = dup.slug || '-' || counter WHERE alias = dup.alias;
                  END LOOP;
                END $$;
            """)
            # 4. Make slug NOT NULL (safe — only fails if duplicates still exist; we resolved them above)
            cur.execute("ALTER TABLE model_mapping ALTER COLUMN slug SET NOT NULL;")
            # 5. Add unique constraint (idempotent)
            cur.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_mapping_slug_unique') THEN
                    ALTER TABLE model_mapping ADD CONSTRAINT model_mapping_slug_unique UNIQUE (slug);
                  END IF;
                EXCEPTION WHEN others THEN NULL; END $$;
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_model_mapping_slug ON model_mapping(slug);")
            # 6. Helper function for slug generation
            cur.execute("""
                CREATE OR REPLACE FUNCTION generate_model_slug(display_name TEXT)
                RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
                BEGIN
                  RETURN LOWER(REGEXP_REPLACE(REGEXP_REPLACE(
                    display_name, '[^a-zA-Z0-9\\s-]', '', 'g'
                  ), '\\s+', '-', 'g'));
                END; $$;
            """)
            # 7. plan_presets.included_model_aliases column
            cur.execute("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS included_model_aliases TEXT[];")
            cur.execute("COMMENT ON COLUMN plan_presets.included_model_aliases IS 'Model aliases included in this plan. NULL = all active models. Admin editable via /admin/plans.';")
            # Seed plan tier model access (idempotent — skip if already populated)
            cur.execute("UPDATE plan_presets SET included_model_aliases = NULL WHERE tier = 'free' AND included_model_aliases IS NOT NULL;")
            cur.execute("UPDATE plan_presets SET included_model_aliases = ARRAY['akarouter-mini'] WHERE tier = 'starter' AND included_model_aliases IS NULL;")
            cur.execute("UPDATE plan_presets SET included_model_aliases = ARRAY['akarouter-mini','akarouter-haiku','akarouter-sonnet','akarouter-gpt54'] WHERE tier = 'pro' AND included_model_aliases IS NULL;")
            cur.execute("UPDATE plan_presets SET included_model_aliases = ARRAY['akarouter-mini','akarouter-haiku','akarouter-sonnet','akarouter-gpt54','akarouter-gemini31','akarouter-gpt55','akarouter-opus'] WHERE tier = 'ultra' AND included_model_aliases IS NULL;")
            cur.execute("UPDATE plan_presets SET included_model_aliases = ARRAY['akarouter-mini','akarouter-haiku','akarouter-sonnet','akarouter-gpt54','akarouter-gemini31','akarouter-gpt55','akarouter-opus','akarouter-gpt53-codex'] WHERE tier = 'enterprise' AND included_model_aliases IS NULL;")
            # 8. Data integrity: is_free_provider is only meaningful when points_cost <= 1.
            # If a row has is_free_provider=true but points_cost >= 2, the flag is dead and misleading.
            # Flip to false so the UI shows the truth.
            cur.execute("UPDATE model_mapping SET is_free_provider = false WHERE is_free_provider = true AND points_cost >= 2;")
            # 9. Add CHECK constraint to keep the invariant: is_free_provider implies points_cost <= 1
            # (only added if not already present; idempotent).
            cur.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'model_mapping_free_provider_cost_check'
                  ) THEN
                    ALTER TABLE model_mapping
                      ADD CONSTRAINT model_mapping_free_provider_cost_check
                      CHECK (NOT is_free_provider OR points_cost <= 1);
                  END IF;
                EXCEPTION WHEN others THEN NULL; END $$;
            """)
            # 10. is_upcoming flag: model is shown in catalog with price but cannot be used
            # for chat. Use for "feature upcoming" / soon-to-launch models.
            cur.execute("ALTER TABLE model_mapping ADD COLUMN IF NOT EXISTS is_upcoming BOOLEAN DEFAULT FALSE;")
            # 11. 2026-06-20: 2x CNY→USD markup on pricing. Upstream costs in CNY
            # (see https://justpaste.it/bor0t). Conversion 0.14 USD/CNY × 2 markup.
            # Per-request models: cost_per_request_cents + points_cost.
            # Per-token models: input_cost_per_million + output_cost_per_million.
            # Idempotent — re-running applies the same target values.
            # NOTE: conn is in autocommit mode (set above), so each UPDATE is its
            # own implicit transaction. We can catch per-statement errors with a
            # simple try/except — no SAVEPOINT needed. A bad row only blocks its
            # own UPDATE; subsequent UPDATEs still run.
            def _safe_update(sql: str) -> None:
                try:
                    cur.execute(sql)
                except Exception as e:
                    logger.warning(f"migration update skipped (non-fatal): {sql[:80]}... — {e}")
            # First: fix any rows that would violate model_mapping_free_provider_cost_check
            # when the upcoming pricing changes land. The constraint requires that
            # if is_free_provider=true then points_cost <= 1. Several rows currently
            # have is_free_provider=true with points_cost=1 (which is fine) but our
            # pricing migration wants to set points_cost=3+ on them. To unblock the
            # constraint we flip is_free_provider=false on the specific aliases we
            # are about to price. This preserves the "is_free_provider" intent on
            # models we DO NOT touch (e.g. the true free tier).
            _safe_update("UPDATE model_mapping SET is_free_provider = FALSE WHERE alias IN ('akarouter-flash','akarouter-pro','akarouter-large') AND is_free_provider = TRUE;")
            # Then: Opus → upcoming + deactivated
            _safe_update("UPDATE model_mapping SET is_upcoming = TRUE, is_active = FALSE WHERE alias = 'akarouter-opus';")
            # Then: 2x CNY→USD markup on every active model
            _safe_update("UPDATE model_mapping SET cost_per_request_cents = 1,  points_cost = 1  WHERE alias = 'akarouter-haiku';")
            _safe_update("UPDATE model_mapping SET cost_per_request_cents = 2,  points_cost = 2  WHERE alias = 'akarouter-sonnet';")
            _safe_update("UPDATE model_mapping SET cost_per_request_cents = 2,  points_cost = 2  WHERE alias = 'akarouter-gemini31';")
            _safe_update("UPDATE model_mapping SET cost_per_request_cents = 2,  points_cost = 2  WHERE alias = 'akarouter-gpt54';")
            _safe_update("UPDATE model_mapping SET cost_per_request_cents = 5,  points_cost = 3  WHERE alias = 'akarouter-gpt55';")
            _safe_update("UPDATE model_mapping SET cost_per_request_cents = 5,  points_cost = 3  WHERE alias = 'akarouter-gpt53-codex';")
            _safe_update("UPDATE model_mapping SET input_cost_per_million = 0.013, output_cost_per_million = 0.038, cost_per_request_cents = 1, points_cost = 1 WHERE alias = 'akarouter-flash';")
            _safe_update("UPDATE model_mapping SET input_cost_per_million = 0.056, output_cost_per_million = 0.280, cost_per_request_cents = 5, points_cost = 3 WHERE alias = 'akarouter-pro';")
            _safe_update("UPDATE model_mapping SET input_cost_per_million = 0.280, output_cost_per_million = 1.120, cost_per_request_cents = 10, points_cost = 10 WHERE alias = 'akarouter-large';")
            cur.close()
            conn.close()
            logger.info("model_mapping migrations applied (slug + included_model_aliases + is_upcoming + 2x markup)")
    except Exception as e:
        # Don't fail startup — log and continue. The /api/v1/models endpoint already
        # falls back to alias if slug is missing in a row.
        logger.warning(f"slug auto-migration skipped: {e}")

    # Evict model metadata cache so the new is_upcoming column + new prices
    # take effect immediately on first request after deploy, rather than
    # waiting up to 60s for the TTL.
    try:
        from app.core.cache import evict_all_model_caches
        evict_all_model_caches()
        logger.info("Model metadata cache evicted after pricing migration")
    except Exception as e:
        logger.warning(f"Failed to evict model cache (non-fatal): {e}")


@app.on_event("shutdown")
async def shutdown():
    logger.info("AKAROUTER shutting down")
    
    # Close the global HTTP client pool
    await close_http_client()
    
    # Stop flusher task and execute final database flush
    from app.core.cache import stop_flusher
    await stop_flusher()
