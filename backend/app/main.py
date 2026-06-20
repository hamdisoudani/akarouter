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
        from app.core.router import RateLimitException, BudgetLimitException, SuspendedAccountException, BannedAccountException
        check_limits = path.startswith("/v1/")
        try:
            auth_result = await authenticate_api_key(token, check_limits=check_limits)
        except RateLimitException as e:
            return JSONResponse(status_code=429, content={"detail": str(e)})
        except BudgetLimitException as e:
            return JSONResponse(status_code=429, content={"detail": str(e)})
        except BannedAccountException as e:
            # 403 Forbidden — banned accounts are blocked at every API path,
            # not just the dashboard. The auth path inside authenticate_api_key
            # also auto-revokes all active API keys for the banned account.
            return JSONResponse(status_code=403, content={"detail": str(e), "reason": "banned"})
        except SuspendedAccountException as e:
            return JSONResponse(status_code=403, content={"detail": str(e), "reason": "suspended"})
            
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
                    # Banned accounts: only allow /user/me (so the BannedAccountWall can render) and /auth/logout
                    is_allowed_banned_path = user_status == "banned" and path in ("/user/me",)
                    if not is_allowed_pending_path and not is_allowed_banned_path:
                        if not (path.startswith(ADMIN_PREFIX) and user_info.get("role") == "admin"):
                            detail_msg = f"Account status is {user_status}"
                            reason_label = user_status  # default: 'suspended', 'cancelled', etc
                            if user_status == "suspended":
                                detail_msg = f"Account is suspended: {user_info.get('suspended_reason') or 'Suspended by administrator'}"
                            elif user_status == "banned":
                                detail_msg = f"Account is banned: {user_info.get('ban_reason') or 'Violation of terms of service'}"
                            return JSONResponse(
                                status_code=403, 
                                content={"detail": detail_msg, "reason": reason_label}
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


@app.get("/v1/system/status")
async def public_system_status():
    """Public read-only flags the landing/signup UI needs.

    No auth — only returns non-sensitive booleans. Used by the frontend
    signup form to decide whether to show the form or a 'signups closed'
    banner.
    """
    from app.core.cache import is_gateway_enabled, is_signup_enabled
    return {
        "gateway_enabled": is_gateway_enabled(),
        "signup_enabled": is_signup_enabled(),
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
            def _safe_insert(sql: str) -> None:
                try:
                    cur.execute(sql)
                    if cur.rowcount > 0:
                        logger.info(f"migration insert applied (rowcount={cur.rowcount}): {sql[:80]}...")
                except Exception as e:
                    logger.warning(f"migration insert skipped (non-fatal): {sql[:80]}... — {e}")
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
            # 12. 2026-06-20: Plan-tier points multiplier + promotional model + per_token → per_request.
            # Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE WHERE clauses.
            # Schema:
            #   plan_presets.points_cost_multiplier NUMERIC(4,3) DEFAULT 1.0
            #   model_mapping.is_promotional BOOLEAN DEFAULT FALSE
            #   model_mapping.promotional_discount_pct NUMERIC(4,3) DEFAULT 0
            _safe_update("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS points_cost_multiplier NUMERIC(4,3) NOT NULL DEFAULT 1.0 CHECK (points_cost_multiplier > 0 AND points_cost_multiplier <= 1.0);")
            _safe_update("UPDATE plan_presets SET points_cost_multiplier = 1.0  WHERE tier = 'free';")
            _safe_update("UPDATE plan_presets SET points_cost_multiplier = 0.9  WHERE tier = 'starter';")
            _safe_update("UPDATE plan_presets SET points_cost_multiplier = 0.75 WHERE tier = 'pro';")
            _safe_update("UPDATE plan_presets SET points_cost_multiplier = 0.6  WHERE tier = 'ultra';")
            _safe_update("UPDATE plan_presets SET points_cost_multiplier = 0.5  WHERE tier = 'enterprise';")
            _safe_update("ALTER TABLE model_mapping ADD COLUMN IF NOT EXISTS is_promotional BOOLEAN NOT NULL DEFAULT FALSE;")
            _safe_update("ALTER TABLE model_mapping ADD COLUMN IF NOT EXISTS promotional_discount_pct NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (promotional_discount_pct >= 0 AND promotional_discount_pct <= 1);")
            _safe_update("ALTER TABLE model_mapping ADD COLUMN IF NOT EXISTS promotional_admin_note TEXT;")
            # Seed MiniMax-M3 (akarouter-mini) as promotional loss leader.
            _safe_update("UPDATE model_mapping SET is_promotional = TRUE, promotional_discount_pct = 0.5, promotional_admin_note = 'Loss-leader launch promo. Frontier-class model at promotional rate.' WHERE alias = 'akarouter-mini';")
            # Migrate per_token models to per_request. Per-token upstream cost is very low
            # (≤¥0.2/1M tokens), so per_request at 1–2¢ is cleaner billing.
            _safe_update("UPDATE model_mapping SET pricing_mode = 'per_request', cost_per_request_cents = 1, points_cost = 1 WHERE alias = 'akarouter-flash' AND pricing_mode = 'per_token';")
            _safe_update("UPDATE model_mapping SET pricing_mode = 'per_request', cost_per_request_cents = 1, points_cost = 1 WHERE alias = 'akarouter-pro'   AND pricing_mode = 'per_token';")
            _safe_update("UPDATE model_mapping SET pricing_mode = 'per_request', cost_per_request_cents = 2, points_cost = 2 WHERE alias = 'akarouter-large' AND pricing_mode = 'per_token';")
            # 13. 2026-06-20: ensure all 5 plan tiers exist. Live DB was missing
            # the enterprise row entirely. Idempotent INSERT...ON CONFLICT DO NOTHING.
            _safe_insert("INSERT INTO plan_presets (tier, monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit, monthly_point_allowance, daily_free_requests_limit, points_cost_multiplier) VALUES ('enterprise', 100000, 600, 5000000, 50000000, 25000, 0, 0.5) ON CONFLICT (tier) DO NOTHING;")
            # 14. 2026-06-20: add missing plan_presets columns to bring live DB
            # in line with schema.sql. Some were declared in schema but never
            # ALTERed in production. These support price/billing_period/display
            # fields used by the /v1/plans frontend rendering.
            _safe_update("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS price TEXT DEFAULT '$0';")
            _safe_update("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS billing_period TEXT DEFAULT 'mo';")
            _safe_update("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS description TEXT;")
            _safe_update("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS badge TEXT;")
            _safe_update("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS has_trial BOOLEAN NOT NULL DEFAULT FALSE;")
            _safe_update("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS trial_days INT NOT NULL DEFAULT 7;")
            # Backfill default prices for all tiers
            _safe_update("UPDATE plan_presets SET price = '$0',    billing_period = 'mo' WHERE tier = 'free'       AND (price IS NULL OR price = '$0');")
            _safe_update("UPDATE plan_presets SET price = '$19',   billing_period = 'mo' WHERE tier = 'starter'    AND (price IS NULL OR price = '$0');")
            _safe_update("UPDATE plan_presets SET price = '$49',   billing_period = 'mo' WHERE tier = 'pro'        AND (price IS NULL OR price = '$0');")
            _safe_update("UPDATE plan_presets SET price = '$149',  billing_period = 'mo' WHERE tier = 'ultra'      AND (price IS NULL OR price = '$0');")
            _safe_update("UPDATE plan_presets SET price = '$499',  billing_period = 'mo' WHERE tier = 'enterprise' AND (price IS NULL OR price = '$0');")
            # 15. 2026-06-20: 'banned' account status. Distinct from 'suspended':
            #   - suspended = temporary, admin will restore (e.g. payment failed)
            #   - banned    = permanent, ToS violation. User must contact support.
            # Banned users see ONLY contact-support wall + ban reason + sign-out.
            # We:
            #   (a) add 'banned' to the accounts.status CHECK constraint
            #   (b) add a ban_reason TEXT column (separate from suspended_reason
            #       because the messaging is different: "you violated ToS" vs
            #       "we're reviewing your account")
            _safe_update("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ban_reason TEXT;")
            # The accounts.status CHECK is auto-named accounts_status_check.
            # Use DO $$ to drop + recreate idempotently. If the constraint was
            # renamed in a prior manual migration, the IF EXISTS prevents failure.
            cur.execute("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_status_check') THEN
                    ALTER TABLE accounts DROP CONSTRAINT accounts_status_check;
                  END IF;
                EXCEPTION WHEN others THEN NULL; END $$;
            """)
            cur.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_status_check') THEN
                    ALTER TABLE accounts
                      ADD CONSTRAINT accounts_status_check
                      CHECK (status IN ('active', 'pending', 'suspended', 'cancelled', 'banned'));
                  END IF;
                EXCEPTION WHEN others THEN NULL; END $$;
            """)
            logger.info("migration step 15: banned status + ban_reason column applied")
            # 16. 2026-06-20: REVISE pricing tiers per user directive.
            # The previous values ($19/$49/$149, RPM 60/60/60, 5h+7d caps)
            # were over-engineered. The new model is:
            #   - Point-based monthly allowance is the ONLY budget
            #   - RPM is the ONLY rate limit
            #   - No 5h/7d caps (users spend their allowance freely)
            #   - Prices: free $0, starter $4.99, pro $19.99, ultra $99.99
            #   - RPM: free 2, starter 20, pro 40, ultra 60
            #   - Enterprise: kept in DB for legacy users, but hidden from /v1/plans
            # Idempotent: every UPDATE is conditional so re-running does nothing
            # if the values are already correct.
            _safe_update("ALTER TABLE plan_presets ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;")
            _safe_update("UPDATE plan_presets SET is_visible = TRUE  WHERE tier IN ('free','starter','pro','ultra') AND is_visible = FALSE;")
            _safe_update("UPDATE plan_presets SET is_visible = FALSE WHERE tier = 'enterprise';")
            # Prices (correct ones — confirmed from 2026-06-19 memory)
            _safe_update("UPDATE plan_presets SET price = '$0'      WHERE tier = 'free'       AND price <> '$0';")
            _safe_update("UPDATE plan_presets SET price = '$4.99'   WHERE tier = 'starter'    AND price <> '$4.99';")
            _safe_update("UPDATE plan_presets SET price = '$19.99'  WHERE tier = 'pro'        AND price <> '$19.99';")
            _safe_update("UPDATE plan_presets SET price = '$99.99'  WHERE tier = 'ultra'      AND price <> '$99.99';")
            # RPM (point-rate-based: 1 cheap model = 1 pt, so rpm * 1 = pts/min)
            _safe_update("UPDATE plan_presets SET rpm_limit = 2   WHERE tier = 'free'    AND rpm_limit <> 2;")
            _safe_update("UPDATE plan_presets SET rpm_limit = 20  WHERE tier = 'starter' AND rpm_limit <> 20;")
            _safe_update("UPDATE plan_presets SET rpm_limit = 40  WHERE tier = 'pro'     AND rpm_limit <> 40;")
            _safe_update("UPDATE plan_presets SET rpm_limit = 60  WHERE tier = 'ultra'   AND rpm_limit <> 60;")
            # Drop 5h/7d semantics — set to 0 (sentinel for "not enforced") rather than
            # dropping the column. The columns remain in DB for backward compat and
            # for any future re-introduction, but the rate-limit middleware ignores them.
            _safe_update("UPDATE plan_presets SET tokens_5h_limit = 0, tokens_7d_limit = 0 WHERE tokens_5h_limit <> 0 OR tokens_7d_limit <> 0;")
            # monthly_limit is the legacy "requests/mo" dollar-era cap. Drop its
            # enforcement value to 0 (sentinel). The point-based budget is now
            # `monthly_point_allowance`, which is already populated.
            _safe_update("UPDATE plan_presets SET monthly_limit = 0 WHERE monthly_limit <> 0;")
            # 2026-06-20: Migrate `included_model_aliases` from branded ids
            # (e.g. 'akarouter-opus') to provider slugs (e.g. 'claude-opus-48')
            # — the new system of record is the provider's own model name, the
            # same one used in /models/[id]/page.tsx. All pay-per-token models
            # (owl, nomotron, flash 3.7) are now accessible on EVERY plan.
            _safe_update("""
                UPDATE plan_presets SET included_model_aliases = ARRAY['claude-haiku-45','minimax-m3']
                WHERE tier = 'free' AND (
                    included_model_aliases IS NULL
                    OR 'akarouter-haiku' = ANY(included_model_aliases)
                    OR 'akarouter-mini' = ANY(included_model_aliases)
                );
            """)
            _safe_update("""
                UPDATE plan_presets SET included_model_aliases = ARRAY[
                    'claude-haiku-45','minimax-m3','owl-alpha','nemotron-ultra','step-37-flash'
                ]
                WHERE tier = 'starter' AND (
                    included_model_aliases IS NULL
                    OR 'akarouter-haiku' = ANY(included_model_aliases)
                    OR 'akarouter-mini' = ANY(included_model_aliases)
                );
            """)
            _safe_update("""
                UPDATE plan_presets SET included_model_aliases = ARRAY[
                    'claude-haiku-45','minimax-m3','owl-alpha','nemotron-ultra','step-37-flash',
                    'claude-sonnet-46','gpt-54','gemini-31-pro'
                ]
                WHERE tier = 'pro' AND (
                    included_model_aliases IS NULL
                    OR 'akarouter-haiku' = ANY(included_model_aliases)
                    OR 'akarouter-mini' = ANY(included_model_aliases)
                );
            """)
            _safe_update("""
                UPDATE plan_presets SET included_model_aliases = ARRAY[
                    'claude-haiku-45','minimax-m3','owl-alpha','nemotron-ultra','step-37-flash',
                    'claude-sonnet-46','gpt-54','gemini-31-pro',
                    'gpt-55','gpt-53-codex-spark','claude-opus-48'
                ]
                WHERE tier = 'ultra' AND (
                    included_model_aliases IS NULL
                    OR 'akarouter-haiku' = ANY(included_model_aliases)
                    OR 'akarouter-mini' = ANY(included_model_aliases)
                );
            """)
            _safe_update("""
                UPDATE plan_presets SET included_model_aliases = ARRAY[
                    'claude-haiku-45','minimax-m3','owl-alpha','nemotron-ultra','step-37-flash',
                    'claude-sonnet-46','gpt-54','gemini-31-pro',
                    'gpt-55','gpt-53-codex-spark','claude-opus-48'
                ]
                WHERE tier = 'enterprise' AND (
                    included_model_aliases IS NULL
                    OR 'akarouter-haiku' = ANY(included_model_aliases)
                    OR 'akarouter-mini' = ANY(included_model_aliases)
                );
            """)
            # Plan descriptions (the "X plan + Y, Z" hierarchy)
            _safe_update("UPDATE plan_presets SET description = '100 points/month. Try the cheapest models for free.' WHERE tier = 'free' AND (description IS NULL OR description NOT LIKE '100 points/month%');")
            _safe_update("UPDATE plan_presets SET description = 'Starter + Owl Alpha, Nemotron Ultra, Step 3.7 Flash' WHERE tier = 'starter' AND (description IS NULL OR description NOT LIKE 'Starter +%');")
            _safe_update("UPDATE plan_presets SET description = 'Starter + Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro' WHERE tier = 'pro' AND (description IS NULL OR description NOT LIKE 'Starter + Claude%');")
            _safe_update("UPDATE plan_presets SET description = 'Pro + GPT-5.5, GPT-5.3 Codex Spark, Claude Opus 4.8' WHERE tier = 'ultra' AND (description IS NULL OR description NOT LIKE 'Pro + GPT%');")
            # Badges
            _safe_update("UPDATE plan_presets SET badge = 'Most popular • 7-day free trial' WHERE tier = 'pro' AND (badge IS NULL OR badge <> 'Most popular • 7-day free trial');")
            _safe_update("UPDATE plan_presets SET badge = 'Elite performance' WHERE tier = 'ultra' AND (badge IS NULL OR badge <> 'Elite performance');")
            logger.info("migration step 16: pricing tiers revised (correct prices, RPM 2/20/40/60, no 5h/7d, enterprise hidden, included_model_aliases = provider slugs, descriptions added)")
            cur.close()
            conn.close()
            logger.info("model_mapping migrations applied (slug + included_model_aliases + is_upcoming + 2x markup + tier multiplier + promotional + per_token→per_request + banned status + pricing revision)")
    except Exception as e:
        # Don't fail startup — log and continue. The /api/v1/models endpoint already
        # falls back to alias if slug is missing in a row.
        logger.warning(f"slug auto-migration skipped: {e}")

    # Evict model metadata cache so the new is_upcoming column + new prices
    # take effect immediately on first request after deploy, rather than
    # waiting up to 60s for the TTL.
    try:
        from app.core.cache import evict_all_model_caches, evict_plan_meta_cache
        evict_all_model_caches()
        evict_plan_meta_cache()
        logger.info("Model metadata + plan meta cache evicted after pricing migration")
    except Exception as e:
        logger.warning(f"Failed to evict caches (non-fatal): {e}")


@app.on_event("shutdown")
async def shutdown():
    logger.info("AKAROUTER shutting down")
    
    # Close the global HTTP client pool
    await close_http_client()
    
    # Stop flusher task and execute final database flush
    from app.core.cache import stop_flusher
    await stop_flusher()
