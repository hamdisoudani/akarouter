FROM python:3.12-slim
WORKDIR /app

# Install dependencies first to maximize layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# SECURITY: every var the app reads at startup or first request must be
# declared here AND exported as ENV. A var that's only ARG'd is set during
# the build stage but lost at runtime — the container would start with
# undefined settings and either crash or silently fall back to defaults.
#
# SECURITY: we DELIBERATELY do not pass secrets as ARG/ENV. Railway injects
# all AKAROUTER_* secrets at runtime as container env vars. Baked-in
# secrets (via ARG/ENV) are extractable from `docker history` and any
# registry the image is pushed to. Pass them through Railway's runtime
# env injection only.
ARG AKAROUTER_APP_ENV
ARG AKAROUTER_SUPABASE_URL
ARG AKAROUTER_SUPABASE_SERVICE_ROLE_KEY
ARG AKAROUTER_SUPABASE_DB_URL
ARG AKAROUTER_NOUS_API_BASE
ARG AKAROUTER_NOUS_CLIENT_ID
ARG AKAROUTER_NOUS_SCOPE
ARG AKAROUTER_NOUS_DEVICE_CODE_URL
ARG AKAROUTER_NOUS_TOKEN_URL
ARG AKAROUTER_TOKEN_REFRESH_SKEW
ARG AKAROUTER_REFRESH_LOCK_TTL
ARG AKAROUTER_MAX_CONCURRENT_PER_ACCOUNT
ARG AKAROUTER_WHOP_API_KEY
ARG AKAROUTER_WHOP_WEBHOOK_SECRET
ARG AKAROUTER_WHOP_COMPANY_ID
ARG AKAROUTER_WHOP_PLAN_STARTER
ARG AKAROUTER_WHOP_PLAN_PRO
ARG AKAROUTER_WHOP_PLAN_ULTRA
# Fernet key for at-rest encryption of hosted agent API keys
ARG AKAROUTER_AGENT_KEY_ENCRYPTION_SECRET
# Lock backend selection: postgres | memory
ARG AKAROUTER_LOCK_BACKEND
# CORS allowlist (comma-separated or JSON list)
ARG AKAROUTER_CORS_ORIGINS
# Daytona sandbox integration (used by hosted_agents endpoints)
ARG AKAROUTER_DAYTONA_API_BASE
ARG AKAROUTER_DAYTONA_API_KEY
ARG AKAROUTER_DAYTONA_SANDBOX_CPU
ARG AKAROUTER_DAYTONA_SANDBOX_MEMORY
ARG AKAROUTER_DAYTONA_SANDBOX_DISK
ARG AKAROUTER_PUBLIC_BACKEND_URL
# Dev-only admin token (must remain empty in production)
ARG AKAROUTER_ADMIN_DEV_TOKEN

# SECURITY: only NON-SECRET defaults are exported as runtime env. Secrets
# are intentionally NOT exported here — they must be supplied by the
# runtime (Railway / Render / docker run -e). The previous Dockerfile
# exported every ARG (including WHOP_API_KEY, AGENT_KEY_ENCRYPTION_SECRET,
# etc.) as a runtime ENV, which baked them into image layers. Even
# though Railway overrides them at runtime, the values persisted in
# `docker history` and in any intermediate registry, and a developer
# running the image locally would accidentally pick up production keys.
#
# The only ENV exports below are configuration flags with safe defaults
# that any deployment should want.
ENV AKAROUTER_APP_ENV=${AKAROUTER_APP_ENV:-production}
ENV AKAROUTER_NOUS_API_BASE=${AKAROUTER_NOUS_API_BASE:-https://inference-api.nousresearch.com/v1}
ENV AKAROUTER_NOUS_CLIENT_ID=${AKAROUTER_NOUS_CLIENT_ID:-hermes-cli}
ENV AKAROUTER_NOUS_SCOPE=${AKAROUTER_NOUS_SCOPE:-inference:invoke}
ENV AKAROUTER_NOUS_DEVICE_CODE_URL=${AKAROUTER_NOUS_DEVICE_CODE_URL:-https://portal.nousresearch.com/api/oauth/device/code}
ENV AKAROUTER_NOUS_TOKEN_URL=${AKAROUTER_NOUS_TOKEN_URL:-https://portal.nousresearch.com/api/oauth/token}
ENV AKAROUTER_TOKEN_REFRESH_SKEW=${AKAROUTER_TOKEN_REFRESH_SKEW:-120}
ENV AKAROUTER_REFRESH_LOCK_TTL=${AKAROUTER_REFRESH_LOCK_TTL:-30}
ENV AKAROUTER_MAX_CONCURRENT_PER_ACCOUNT=${AKAROUTER_MAX_CONCURRENT_PER_ACCOUNT:-12}
ENV AKAROUTER_LOCK_BACKEND=${AKAROUTER_LOCK_BACKEND:-postgres}

# SECURITY: create a non-root user. Without USER, the container runs as
# root. A container-escape vulnerability (e.g., a future RCE in any of
# our deps) would then give the attacker root on the host. The `appuser`
# account has no password, no shell, and no home directory — strictly a
# service account.
RUN groupadd --system --gid 1000 appuser \
    && useradd  --system --uid 1000 --gid appuser \
                --no-create-home --shell /usr/sbin/nologin appuser

# Copy the source AFTER user creation so the files are owned by root
# (appuser can't modify them at runtime).
COPY --chown=root:appuser --chmod=550 . .

# Mark start.sh as the entrypoint. It honors $PORT and uses uvicorn.
# Mark it executable in case the source tree didn't preserve perms.
RUN chmod 550 start.sh

ENV PORT=8000
EXPOSE 8000

# SECURITY: switch to non-root for runtime. Any code that needs to bind
# to a low port (uvicorn on 8000 is fine) is OK as this uid.
USER appuser

# HEALTHCHECK lets orchestrators detect a dead container and restart it.
# curl is included in python:3.12-slim. The endpoint is whitelisted in
# backend/railway.toml so the platform's own probe doesn't compete.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/healthz" || exit 1

CMD ["sh", "start.sh"]
