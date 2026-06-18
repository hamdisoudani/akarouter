"""migrate_dual_pricing.py

Additive schema migration for dual-mode billing (per_token + per_request).

Adds:
  - model_mapping.pricing_mode             text   ('per_token' | 'per_request')
  - model_mapping.cost_per_request_cents   int    (only meaningful when per_request)
  - accounts.monthly_requests              bigint (counter, default 0)
  - accounts.monthly_requests_limit        bigint (null = unlimited, default null)
  - plan_presets.monthly_requests_limit    bigint (null = unlimited, default null)
  - request_logs.requests_counted          bigint (default 1; 0 for streaming subframes)
  - provider_endpoints                     table  for vsllm-style single-URL providers

Safe defaults:
  - pricing_mode='per_token' for all existing rows -> no behavior change
  - monthly_requests_limit NULL -> existing plans/accounts unaffected
  - All ALTERs are ADD COLUMN IF NOT EXISTS -> idempotent
"""
import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")
if not db_url:
    print("ERROR: AKAROUTER_SUPABASE_DB_URL not set")
    sys.exit(1)


def run_migration():
    print("Connecting to database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # 1. model_mapping — dual-pricing columns
    print("[1/5] Adding pricing_mode + cost_per_request_cents to model_mapping...")
    cur.execute("""
        ALTER TABLE model_mapping
        ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'per_token'
            CHECK (pricing_mode IN ('per_token', 'per_request')),
        ADD COLUMN IF NOT EXISTS cost_per_request_cents BIGINT DEFAULT NULL
            CHECK (cost_per_request_cents IS NULL OR cost_per_request_cents >= 0);
    """)
    # Index for the routing query that filters by pricing_mode
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_model_mapping_pricing_mode
        ON model_mapping (pricing_mode) WHERE is_active = TRUE;
    """)

    # 2. accounts — request counter + quota
    print("[2/5] Adding monthly_requests + monthly_requests_limit to accounts...")
    cur.execute("""
        ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS monthly_requests BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS monthly_requests_limit BIGINT DEFAULT NULL
            CHECK (monthly_requests_limit IS NULL OR monthly_requests_limit >= 0);
    """)

    # 3. plan_presets — request quota per tier
    print("[3/5] Adding monthly_requests_limit to plan_presets...")
    cur.execute("""
        ALTER TABLE plan_presets
        ADD COLUMN IF NOT EXISTS monthly_requests_limit BIGINT DEFAULT NULL
            CHECK (monthly_requests_limit IS NULL OR monthly_requests_limit >= 0);
    """)
    # Seed defaults: existing paid tiers get a generous request quota; free = 0.
    cur.execute("""
        UPDATE plan_presets SET monthly_requests_limit = 500  WHERE tier = 'starter'  AND monthly_requests_limit IS NULL;
        UPDATE plan_presets SET monthly_requests_limit = 5000 WHERE tier = 'pro'      AND monthly_requests_limit IS NULL;
        UPDATE plan_presets SET monthly_requests_limit = 50000 WHERE tier = 'ultra'   AND monthly_requests_limit IS NULL;
    """)

    # 4. request_logs — explicit request counter (always 1 today; lets us
    # log streamed subframes as 0 in the future without ambiguity).
    print("[4/5] Adding requests_counted to request_logs...")
    cur.execute("""
        ALTER TABLE request_logs
        ADD COLUMN IF NOT EXISTS requests_counted BIGINT NOT NULL DEFAULT 1;
    """)

    # 5. provider_endpoints — vsllm-style single-URL providers (API-key auth)
    print("[5/5] Creating provider_endpoints table...")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS provider_endpoints (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name TEXT NOT NULL UNIQUE,                          -- e.g. 'vsllm-primary'
            base_url TEXT NOT NULL,                             -- e.g. 'https://api.vsllm.com/v1'
            api_key_encrypted TEXT NOT NULL,                     -- Fernet-encrypted, never plaintext
            auth_header TEXT NOT NULL DEFAULT 'Authorization',  -- most APIs use Bearer
            auth_scheme TEXT NOT NULL DEFAULT 'Bearer',
            -- What this endpoint serves
            model_aliases TEXT[] NOT NULL DEFAULT '{}',          -- which akarouter-* aliases it can serve
            default_pricing_mode TEXT NOT NULL DEFAULT 'per_request'
                CHECK (default_pricing_mode IN ('per_token', 'per_request')),
            default_cost_per_request_cents BIGINT,               -- endpoint-level fallback
            -- Health / load (mirrors providers table)
            health_status TEXT NOT NULL DEFAULT 'active'
                CHECK (health_status IN ('active', 'degraded', 'disabled')),
            max_concurrent INT NOT NULL DEFAULT 50,
            weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            -- Audit
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TIMESTAMPTZ,
            last_error_at TIMESTAMPTZ,
            last_error_msg TEXT
        );
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_provider_endpoints_active
        ON provider_endpoints (health_status) WHERE health_status = 'active';
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_provider_endpoints_models
        ON provider_endpoints USING GIN (model_aliases);
    """)

    # RLS — service_role only, like providers table
    cur.execute("ALTER TABLE provider_endpoints ENABLE ROW LEVEL SECURITY;")
    cur.execute("DROP POLICY IF EXISTS 'Service role can manage provider_endpoints' ON provider_endpoints;")
    cur.execute("""
        CREATE POLICY 'Service role can manage provider_endpoints' ON provider_endpoints
        FOR ALL USING (auth.role() = 'service_role');
    """)

    conn.commit()
    cur.close()
    conn.close()
    print("\nMigration complete. Verify with:")
    print("  \\d model_mapping")
    print("  \\d accounts")
    print("  \\d plan_presets")
    print("  \\d request_logs")
    print("  \\d provider_endpoints")


if __name__ == "__main__":
    run_migration()