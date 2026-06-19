-- AKAROUTER Full SaaS Schema
-- Supabase project: fleouqrgltkodumrgxlt
-- Created: 2026-06-06

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROVIDERS: Hermes/NOUS OAuth accounts
-- ============================================
CREATE TABLE IF NOT EXISTS providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_name TEXT NOT NULL DEFAULT 'hermes-nous',
    client_id TEXT NOT NULL DEFAULT 'hermes-cli',
    
    -- OAuth tokens (encrypted at app layer)
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    token_scope TEXT DEFAULT 'inference:invoke',
    
    -- Account metadata
    account_label TEXT NOT NULL,
    health_status TEXT NOT NULL DEFAULT 'active' CHECK (health_status IN ('active', 'degraded', 'dead', 'refreshing')),
    weight REAL NOT NULL DEFAULT 1.0,
    
    -- Stats
    total_requests BIGINT NOT NULL DEFAULT 0,
    total_errors BIGINT NOT NULL DEFAULT 0,
    in_flight INT NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error_msg TEXT,
    
    -- Concurrency control
    max_concurrent INT NOT NULL DEFAULT 12,
    refresh_lock_acquired_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- ACCOUNTS: SaaS user accounts
-- ============================================
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Link to Supabase Auth user
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Account info
    email TEXT NOT NULL,
    display_name TEXT,
    
    -- Subscription tier
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro', 'ultra', 'enterprise')),
    
    -- Usage tracking
    monthly_requests BIGINT NOT NULL DEFAULT 0,
    monthly_limit BIGINT NOT NULL DEFAULT 1000,
    rpm_limit BIGINT NOT NULL DEFAULT 60,
    tokens_5h_limit BIGINT NOT NULL DEFAULT 500000,
    tokens_7d_limit BIGINT NOT NULL DEFAULT 5000000,
    budget_reset_at TIMESTAMPTZ,
    total_requests BIGINT NOT NULL DEFAULT 0,
    
    -- Features & Limits
    is_trialing BOOLEAN NOT NULL DEFAULT FALSE,

    -- Point system (added 2026-06-19): spendable point balance + daily free-model cap
    monthly_points_remaining BIGINT NOT NULL DEFAULT 0 CHECK (monthly_points_remaining >= 0),
    monthly_points_limit BIGINT NOT NULL DEFAULT 0 CHECK (monthly_points_limit >= 0),
    points_reset_at TIMESTAMPTZ,
    daily_free_requests_remaining BIGINT NOT NULL DEFAULT 0 CHECK (daily_free_requests_remaining >= 0),
    daily_free_requests_reset_at TIMESTAMPTZ,

    -- Status
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
    suspended_reason TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_email UNIQUE (email),
    CONSTRAINT unique_auth_user UNIQUE (auth_user_id)
);

-- ============================================
-- API_KEYS: User API keys for endpoint access
-- ============================================
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    
    -- The actual API key (hashed for security)
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,  -- e.g. "akar_" for identification
    key_name TEXT NOT NULL DEFAULT 'default',
    
    -- Permissions
    scopes TEXT[] NOT NULL DEFAULT ARRAY['chat:completion', 'models:list'],
    allowed_models TEXT[] DEFAULT ARRAY['*'],  -- * = all models for tier
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    CONSTRAINT unique_key_hash UNIQUE (key_hash)
);

-- ============================================
-- REQUEST_LOGS: Every API call logged
-- ============================================
CREATE TABLE IF NOT EXISTS request_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Who made the request
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    
    -- Which provider handled it
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    
    -- Request details
    model TEXT NOT NULL,
    endpoint TEXT NOT NULL DEFAULT '/v1/chat/completions',
    method TEXT NOT NULL DEFAULT 'POST',
    
    -- Response details
    status_code INT,
    latency_ms INT,
    prompt_tokens INT,
    completion_tokens INT,
    total_tokens INT,
    
    -- Error tracking
    error_message TEXT,
    
    -- Metadata
    ip_address INET,
    user_agent TEXT,
    
    -- Billing
    cost NUMERIC NOT NULL DEFAULT 0.0,
    upstream_model TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_providers_health ON providers(health_status);
CREATE INDEX IF NOT EXISTS idx_providers_last_used ON providers(last_used_at);

CREATE INDEX IF NOT EXISTS idx_accounts_auth_user ON accounts(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_tier ON accounts(tier);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

CREATE INDEX IF NOT EXISTS idx_request_logs_account ON request_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs(model);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SYSTEM_SETTINGS: Global configuration
-- ============================================
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- PLAN_PRESETS: SaaS Tiers Config
-- ============================================
CREATE TABLE IF NOT EXISTS plan_presets (
    tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'starter', 'pro', 'ultra', 'enterprise')),
    price TEXT DEFAULT '$0',
    billing_period TEXT DEFAULT 'mo',
    description TEXT,
    badge TEXT,
    has_trial BOOLEAN NOT NULL DEFAULT FALSE,
    trial_days INT NOT NULL DEFAULT 7,
    monthly_limit BIGINT NOT NULL DEFAULT 1000,
    rpm_limit BIGINT NOT NULL DEFAULT 60,
    tokens_5h_limit BIGINT NOT NULL DEFAULT 500000,
    tokens_7d_limit BIGINT NOT NULL DEFAULT 5000000,
    -- Point system (added 2026-06-19): monthly allowance + daily free-model cap
    monthly_point_allowance BIGINT NOT NULL DEFAULT 0 CHECK (monthly_point_allowance >= 0),
    daily_free_requests_limit BIGINT NOT NULL DEFAULT 0 CHECK (daily_free_requests_limit >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INVITATION_CODES: Beta/Invite codes
-- ============================================
CREATE TABLE IF NOT EXISTS invitation_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE,
    max_uses INT NOT NULL DEFAULT 1,
    used_count INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SECURITY: enable RLS on invitation_codes. Without this, anon can SELECT
-- all codes (incl. `code` and `used_count`) and harvest beta invite codes.
-- The RLS migration (scratch/migrate_rls_and_audit_log.sql) also enables RLS
-- on this table, but applying it in schema.sql means operators don't have to
-- run a separate migration to get a safe default.
ALTER TABLE invitation_codes ENABLE ROW LEVEL SECURITY;

-- Default-deny. Only service_role (used by the backend) can read or write
-- invitation codes. Users MUST NOT be able to enumerate codes.
DROP POLICY IF EXISTS "Service role can manage invitation_codes" ON invitation_codes;
CREATE POLICY "Service role can manage invitation_codes" ON invitation_codes
    FOR ALL USING (auth.role() = 'service_role');

-- Users can only read their own account
CREATE POLICY "Users can read own account" ON accounts
    FOR SELECT USING (auth_user_id = auth.uid());

-- Users can update own account (limited fields)
CREATE POLICY "Users can update own account" ON accounts
    FOR UPDATE USING (auth_user_id = auth.uid());

-- Users can read their own API keys
CREATE POLICY "Users can read own API keys" ON api_keys
    FOR SELECT USING (account_id IN (SELECT id FROM accounts WHERE auth_user_id = auth.uid()));

-- Users can insert their own API keys
CREATE POLICY "Users can insert own API keys" ON api_keys
    FOR INSERT WITH CHECK (account_id IN (SELECT id FROM accounts WHERE auth_user_id = auth.uid()));

-- Users can delete their own API keys
CREATE POLICY "Users can delete own API keys" ON api_keys
    FOR DELETE USING (account_id IN (SELECT id FROM accounts WHERE auth_user_id = auth.uid()));

-- Users can read their own request logs
CREATE POLICY "Users can read own request logs" ON request_logs
    FOR SELECT USING (account_id IN (SELECT id FROM accounts WHERE auth_user_id = auth.uid()));

-- Providers: only service role can access (backend-only)
CREATE POLICY "Service role can manage providers" ON providers
    FOR ALL USING (auth.role() = 'service_role');

-- Request logs: service role can insert
CREATE POLICY "Service role can insert request logs" ON request_logs
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-create account on signup, inheriting details from free plan preset
-- SECURITY: SET search_path = public, pg_catalog prevents schema-hijack
-- attacks. As SECURITY DEFINER, the function runs with the privileges of
-- its owner; if an attacker can create objects in a writable schema on
-- the search path, they could shadow built-ins or the accounts table.
-- Same hardening applies to every other SECURITY DEFINER function below.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    -- SECURITY: declare limit vars as BIGINT to match the accounts table
    -- column types. Previously declared as DOUBLE PRECISION which silently
    -- loses precision for values > 2^53 when inserted into BIGINT columns.
    free_monthly_limit BIGINT;
    free_rpm_limit BIGINT;
    free_tokens_5h_limit BIGINT;
    free_tokens_7d_limit BIGINT;
    req_act TEXT;
    init_status TEXT := 'active';
BEGIN
    -- Query the current FREE plan preset details.
    -- The plan_presets columns are NUMERIC/DOUBLE PRECISION in this schema
    -- (see plan_presets table definition), so we cast to BIGINT explicitly
    -- to match the accounts column types. If the limit is ever > 2^53 we
    -- would lose precision in the cast; in practice the only limit of
    -- that size is tokens_5h_limit/tokens_7d_limit which we round down.
    SELECT
        monthly_limit::BIGINT,
        rpm_limit::BIGINT,
        tokens_5h_limit::BIGINT,
        tokens_7d_limit::BIGINT
    INTO free_monthly_limit, free_rpm_limit, free_tokens_5h_limit, free_tokens_7d_limit
    FROM public.plan_presets
    WHERE tier = 'free';

    -- Safe check if system_settings table exists and require_activation setting is active
    BEGIN
        SELECT value INTO req_act FROM public.system_settings WHERE key = 'require_activation';
    EXCEPTION WHEN OTHERS THEN
        req_act := 'false';
    END;
    
    IF req_act = 'true' THEN
        init_status := 'pending';
    END IF;

    -- Insert account inheriting the FREE plan details and status
    INSERT INTO public.accounts (
        auth_user_id, 
        email, 
        display_name, 
        tier,
        monthly_limit,
        rpm_limit,
        tokens_5h_limit,
        tokens_7d_limit,
        status
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
        'free',
        COALESCE(free_monthly_limit, 10.0),
        COALESCE(free_rpm_limit, 60),
        COALESCE(free_tokens_5h_limit, 1.0),
        COALESCE(free_tokens_7d_limit, 5.0),
        init_status
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;


-- Trigger: auto-create account when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at timestamp
-- SECURITY: SECURITY INVOKER (the default) is correct here — this trigger
-- function does no privileged work and runs in the caller's context, so
-- RLS on the calling table applies normally. SECURITY DEFINER is only
-- needed when the function must run with the privileges of its owner
-- (e.g., to bypass RLS or access an object the caller cannot).
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public, pg_catalog;

CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_providers_updated_at
    BEFORE UPDATE ON providers
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- VIEWS for dashboard
-- ============================================
--
-- SECURITY: views in Postgres do NOT inherit RLS from the underlying
-- tables. A plain view is executed with the privileges of its owner
-- (typically the view creator), and PostgREST exposes it to anon and
-- authenticated roles just like a table. That means `monthly_usage` and
-- `provider_health` as plain views would let anon read aggregated data
-- across ALL users — a cross-account data leak.
--
-- Fix: with `security_invoker = true` (PG15+), the view is executed
-- with the privileges of the calling user, so the underlying table's
-- RLS policies apply and anon can no longer see other accounts' data.
--
-- Requires PostgreSQL 15+. If you're on an older Supabase version,
-- the alternative is to grant SELECT on the view only to service_role
-- and have the backend proxy the data to authenticated users.

-- Usage summary per account (current month)
-- SECURITY: security_invoker ensures the RLS policies on `accounts` and
-- `request_logs` apply to queries against this view. Anon users will see
-- zero rows (their auth.uid() won't match any account), authenticated
-- users will see only their own data.
CREATE OR REPLACE VIEW monthly_usage
WITH (security_invoker = true) AS
SELECT
    a.id AS account_id,
    a.email,
    a.tier,
    a.monthly_limit,
    COUNT(rl.id) AS request_count,
    SUM(rl.total_tokens) AS total_tokens_used,
    SUM(rl.prompt_tokens) AS prompt_tokens,
    SUM(rl.completion_tokens) AS completion_tokens
FROM accounts a
LEFT JOIN request_logs rl ON a.id = rl.account_id
    AND rl.created_at >= date_trunc('month', NOW())
GROUP BY a.id, a.email, a.tier, a.monthly_limit;

-- Provider health overview
-- SECURITY: providers table has a "Service role can manage providers"
-- policy, but without security_invoker on this view, anon could read
-- ALL provider health data (account_label, error_rate_pct, in_flight,
-- last_error_msg) which leaks operational secrets (which providers are
-- failing, what their concurrency limits are, etc.).
CREATE OR REPLACE VIEW provider_health
WITH (security_invoker = true) AS
SELECT
    p.id,
    p.account_label,
    p.health_status,
    p.weight,
    p.total_requests,
    p.total_errors,
    CASE WHEN p.total_requests > 0
        THEN ROUND((p.total_errors::FLOAT / p.total_requests::FLOAT) * 100, 2)
        ELSE 0
    END AS error_rate_pct,
    p.in_flight,
    p.max_concurrent,
    p.last_used_at,
    p.last_error_msg
FROM providers p;


-- ============================================
-- RPC FUNCTIONS FOR ATOMIC OPERATIONS
-- ============================================

-- Atomic increment for account requests and usage
-- SECURITY: SET search_path = public, pg_catalog prevents schema-hijack.
CREATE OR REPLACE FUNCTION public.increment_account_usage(
    p_account_id UUID,
    p_monthly_delta INT,
    p_total_delta INT
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.accounts
    SET monthly_requests = monthly_requests + p_monthly_delta,
        total_requests = total_requests + p_total_delta,
        updated_at = NOW()
    WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;


-- Atomic increment for provider usage and error stats
-- SECURITY: SET search_path = public, pg_catalog prevents schema-hijack.
CREATE OR REPLACE FUNCTION public.increment_provider_stats(
    p_provider_id UUID,
    p_requests_delta INT,
    p_errors_delta INT
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.providers
    SET total_requests = total_requests + p_requests_delta,
        total_errors = total_errors + p_errors_delta,
        updated_at = NOW()
    WHERE id = p_provider_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;


-- Atomic invitation code claiming with row locking
-- SECURITY: SET search_path = public, pg_catalog prevents schema-hijack.
CREATE OR REPLACE FUNCTION public.claim_invitation_code(
    p_code TEXT,
    p_account_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_id UUID;
    v_max_uses INT;
    v_used_count INT;
BEGIN
    -- Select and lock the invitation code row
    SELECT id, max_uses, used_count 
    INTO v_id, v_max_uses, v_used_count
    FROM public.invitation_codes
    WHERE code = p_code AND is_active = TRUE
    FOR UPDATE;
    
    IF v_id IS NULL OR v_used_count >= v_max_uses THEN
        RETURN FALSE;
    END IF;
    
    -- Update invitation code usage count and active status
    UPDATE public.invitation_codes
    SET used_count = v_used_count + 1,
        is_active = (v_used_count + 1 < v_max_uses),
        updated_at = NOW()
    WHERE id = v_id;
    
    -- Activate the associated account
    UPDATE public.accounts
    SET status = 'active',
        updated_at = NOW()
    WHERE id = p_account_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;


-- Optimized database aggregation for budget sliding cycle logic
-- SECURITY: SET search_path = public, pg_catalog prevents schema-hijack.
CREATE OR REPLACE FUNCTION public.get_budget_consumption(
    p_account_id UUID,
    p_month_start TIMESTAMPTZ,
    p_cycle_5h_start TIMESTAMPTZ,
    p_cycle_5h_reset TIMESTAMPTZ,
    p_cycle_7d_start TIMESTAMPTZ,
    p_cycle_7d_reset TIMESTAMPTZ
)
RETURNS TABLE (
    consumed_5h NUMERIC,
    consumed_7d NUMERIC,
    consumed_month NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(CASE WHEN created_at >= p_cycle_5h_start AND created_at < p_cycle_5h_reset THEN cost ELSE 0 END), 0)::NUMERIC as consumed_5h,
        COALESCE(SUM(CASE WHEN created_at >= p_cycle_7d_start AND created_at < p_cycle_7d_reset THEN cost ELSE 0 END), 0)::NUMERIC as consumed_7d,
        COALESCE(SUM(CASE WHEN created_at >= p_month_start THEN cost ELSE 0 END), 0)::NUMERIC as consumed_month
    FROM public.request_logs
    WHERE account_id = p_account_id AND created_at >= p_month_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;


-- Note on request_logs table partitioning:
-- To migrate to a partitioned table in production:
-- 1. Rename request_logs to request_logs_old: ALTER TABLE request_logs RENAME TO request_logs_old;
-- 2. Create the partitioned table:
--    CREATE TABLE request_logs (
--        id UUID NOT NULL DEFAULT uuid_generate_v4(),
--        account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
--        api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
--        provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
--        model TEXT NOT NULL,
--        endpoint TEXT NOT NULL DEFAULT '/v1/chat/completions',
--        method TEXT NOT NULL DEFAULT 'POST',
--        status_code INT,
--        latency_ms INT,
--        prompt_tokens INT,
--        completion_tokens INT,
--        total_tokens INT,
--        error_message TEXT,
--        ip_address INET,
--        user_agent TEXT,
--        cost NUMERIC NOT NULL DEFAULT 0.0,
--        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--        PRIMARY KEY (id, created_at)
--    ) PARTITION BY RANGE (created_at);
-- 3. Create monthly or weekly partitions, e.g.:
--    CREATE TABLE request_logs_y2026m06 PARTITION OF request_logs
--    FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
-- 4. Copy data from request_logs_old to request_logs.


-- ============================================
-- 2026-06-19: Add points_cost to model_mapping
-- ============================================
-- Per-call point cost (admin-editable, default 5)
-- M3 currently 1pt promotional, will join T2 (5pt) in future
-- T1=2pt (cheap), T2=5pt (mid), T3=10pt (premium), legacy=15pt
ALTER TABLE model_mapping ADD COLUMN IF NOT EXISTS points_cost INTEGER NOT NULL DEFAULT 5;
ALTER TABLE model_mapping DROP CONSTRAINT IF EXISTS model_mapping_points_cost_check;
ALTER TABLE model_mapping ADD CONSTRAINT model_mapping_points_cost_check CHECK (points_cost >= 0 AND points_cost <= 1000);
COMMENT ON COLUMN model_mapping.points_cost IS 'Per-call point cost. Admin editable. M3 currently 1pt promotional.';

-- Initial per-model points_cost values (seeded from vsllm × 2 per-call cost analysis)
UPDATE model_mapping SET points_cost = 1 WHERE alias = 'akarouter-mini';
UPDATE model_mapping SET points_cost = 2 WHERE alias IN ('akarouter-flash', 'akarouter-haiku');
UPDATE model_mapping SET points_cost = 5 WHERE alias IN ('akarouter-pro', 'akarouter-large', 'akarouter-sonnet', 'akarouter-gpt54', 'akarouter-gemini31');
UPDATE model_mapping SET points_cost = 10 WHERE alias IN ('akarouter-gpt53-codex', 'akarouter-opus', 'akarouter-gpt55');

-- ============================================
-- 2026-06-19: Point-based pricing system (free plan = 100pts/mo, 1pt models capped at 10/day)
-- ============================================
-- Add monthly_point_allowance + daily_free_requests_limit to plan_presets
ALTER TABLE plan_presets
    ADD COLUMN IF NOT EXISTS monthly_point_allowance BIGINT NOT NULL DEFAULT 0
        CHECK (monthly_point_allowance >= 0),
    ADD COLUMN IF NOT EXISTS daily_free_requests_limit BIGINT NOT NULL DEFAULT 0
        CHECK (daily_free_requests_limit >= 0);

-- Seed plan point allowances
UPDATE plan_presets SET monthly_point_allowance = 100,  daily_free_requests_limit = 10  WHERE tier = 'free';
UPDATE plan_presets SET monthly_point_allowance = 500,  daily_free_requests_limit = 0   WHERE tier = 'starter';
UPDATE plan_presets SET monthly_point_allowance = 2500, daily_free_requests_limit = 0   WHERE tier = 'pro';
UPDATE plan_presets SET monthly_point_allowance = 7500, daily_free_requests_limit = 0   WHERE tier = 'ultra';

-- Add per-account point balance + daily free counter (separate from t1/t2/t3 caps)
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS monthly_points_remaining BIGINT NOT NULL DEFAULT 0
        CHECK (monthly_points_remaining >= 0),
    ADD COLUMN IF NOT EXISTS monthly_points_limit BIGINT NOT NULL DEFAULT 0
        CHECK (monthly_points_limit >= 0),
    ADD COLUMN IF NOT EXISTS points_reset_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS daily_free_requests_remaining BIGINT NOT NULL DEFAULT 0
        CHECK (daily_free_requests_remaining >= 0),
    ADD COLUMN IF NOT EXISTS daily_free_requests_reset_at TIMESTAMPTZ;

-- 1pt models = "free models" — daily-capped for the free plan
UPDATE model_mapping SET points_cost = 1 WHERE alias IN ('akarouter-flash', 'akarouter-pro', 'akarouter-large');
UPDATE model_mapping SET points_cost = 2 WHERE alias = 'akarouter-mini';  -- M3 limited-time 2pt

-- Atomic point-charge function: rolls balances forward, checks caps, deducts
CREATE OR REPLACE FUNCTION charge_account_points(
  account_uuid UUID,
  points_to_charge BIGINT,
  charge_free BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  acc accounts%ROWTYPE;
  plan_rec plan_presets%ROWTYPE;
  now_ts TIMESTAMPTZ := now();
  new_monthly_remaining BIGINT;
  new_daily_free_remaining BIGINT;
BEGIN
  SELECT * INTO acc FROM accounts WHERE id = account_uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'account_not_found'); END IF;

  SELECT * INTO plan_rec FROM plan_presets WHERE tier = acc.tier;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found'); END IF;

  -- Roll monthly forward if expired or plan changed
  IF acc.points_reset_at IS NULL OR now_ts >= acc.points_reset_at
     OR acc.monthly_points_limit IS DISTINCT FROM plan_rec.monthly_point_allowance THEN
    acc.monthly_points_limit := plan_rec.monthly_point_allowance;
    acc.monthly_points_remaining := plan_rec.monthly_point_allowance;
    acc.points_reset_at := now_ts + INTERVAL '30 days';
  END IF;

  -- Roll daily free forward if expired
  IF acc.daily_free_requests_reset_at IS NULL OR now_ts >= acc.daily_free_requests_reset_at THEN
    acc.daily_free_requests_remaining := plan_rec.daily_free_requests_limit;
    acc.daily_free_requests_reset_at := now_ts + INTERVAL '24 hours';
  END IF;

  -- Check daily free cap if charging a 1pt model
  IF charge_free AND plan_rec.daily_free_requests_limit > 0 THEN
    IF acc.daily_free_requests_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'daily_free_cap',
        'daily_free_limit', plan_rec.daily_free_requests_limit,
        'daily_free_reset_at', acc.daily_free_requests_reset_at
      );
    END IF;
  END IF;

  -- Check monthly balance
  IF acc.monthly_points_remaining < points_to_charge THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'insufficient_points',
      'need', points_to_charge, 'have', acc.monthly_points_remaining,
      'points_reset_at', acc.points_reset_at
    );
  END IF;

  new_monthly_remaining := acc.monthly_points_remaining - points_to_charge;
  new_daily_free_remaining := acc.daily_free_requests_remaining;
  IF charge_free AND plan_rec.daily_free_requests_limit > 0 THEN
    new_daily_free_remaining := acc.daily_free_requests_remaining - 1;
  END IF;

  UPDATE accounts SET
    monthly_points_remaining = new_monthly_remaining,
    monthly_points_limit = acc.monthly_points_limit,
    points_reset_at = acc.points_reset_at,
    daily_free_requests_remaining = new_daily_free_remaining,
    daily_free_requests_reset_at = acc.daily_free_requests_reset_at,
    updated_at = now_ts
  WHERE id = account_uuid;

  RETURN jsonb_build_object(
    'ok', true, 'points_charged', points_to_charge,
    'monthly_remaining', new_monthly_remaining,
    'monthly_limit', acc.monthly_points_limit,
    'daily_free_remaining', new_daily_free_remaining,
    'free_request_charged', charge_free
  );
END;
$$;

-- Atomic refund (on upstream failure)
CREATE OR REPLACE FUNCTION refund_account_points(
  account_uuid UUID, points_to_refund BIGINT, refund_free BOOLEAN DEFAULT FALSE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE acc accounts%ROWTYPE; plan_rec plan_presets%ROWTYPE;
BEGIN
  SELECT * INTO acc FROM accounts WHERE id = account_uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO plan_rec FROM plan_presets WHERE tier = acc.tier;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE accounts SET
    monthly_points_remaining = LEAST(acc.monthly_points_remaining + points_to_refund,
                                     COALESCE(acc.monthly_points_limit, plan_rec.monthly_point_allowance)),
    daily_free_requests_remaining = CASE
      WHEN refund_free AND plan_rec.daily_free_requests_limit > 0
      THEN LEAST(acc.daily_free_requests_remaining + 1, plan_rec.daily_free_requests_limit)
      ELSE acc.daily_free_requests_remaining END,
    updated_at = now()
  WHERE id = account_uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION charge_account_points TO service_role;
GRANT EXECUTE ON FUNCTION refund_account_points TO service_role;


-- ============================================
-- 2026-06-19: point_transactions ledger (audit trail)
-- ============================================
-- Every charge_account_points / refund_account_points call inserts a row.
-- Used for /usage history UI and admin reconciliation.

CREATE TABLE IF NOT EXISTS point_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    -- Magnitude of movement. Sign direction is given by `kind`.
    points BIGINT NOT NULL CHECK (points > 0),
    kind TEXT NOT NULL CHECK (kind IN ('charge', 'refund', 'grant', 'adjustment')),

    -- Audit context
    reason TEXT,  -- human-readable: "charge: akarouter-opus", "monthly reset: pro"
    model_alias TEXT,  -- which model triggered the charge (NULL for grants/adjustments)
    request_log_id UUID,  -- optional FK to request_logs (no formal FK to keep loose coupling)

    -- Snapshot of account state after the change (for fast "balance after" display)
    balance_after BIGINT NOT NULL,

    -- Attribution
    created_by TEXT,  -- 'system' | admin email | 'webhook:whop'
    metadata JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_tx_account_created
    ON point_transactions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_tx_kind
    ON point_transactions(account_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_tx_model
    ON point_transactions(account_id, model_alias) WHERE model_alias IS NOT NULL;

COMMENT ON TABLE point_transactions IS 'Audit ledger for every point movement (charge/refund/grant). Used for usage history UI and admin reconciliation.';
COMMENT ON COLUMN point_transactions.points IS 'Magnitude of point movement. Sign is given by kind (charge/refund/grant).';
COMMENT ON COLUMN point_transactions.balance_after IS 'Account balance (monthly_points_remaining) immediately after this transaction.';

-- Re-define charge_account_points with model_alias + request_log_id + ledger writes.
-- (Old signature is preserved via default NULL parameters so existing RPC calls still work.)
CREATE OR REPLACE FUNCTION charge_account_points(
  account_uuid UUID,
  points_to_charge BIGINT,
  charge_free BOOLEAN DEFAULT FALSE,
  model_alias TEXT DEFAULT NULL,
  request_log_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  acc accounts%ROWTYPE;
  plan_rec plan_presets%ROWTYPE;
  now_ts TIMESTAMPTZ := now();
  new_monthly_remaining BIGINT;
  new_daily_free_remaining BIGINT;
  reason_text TEXT;
BEGIN
  SELECT * INTO acc FROM accounts WHERE id = account_uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'account_not_found'); END IF;

  SELECT * INTO plan_rec FROM plan_presets WHERE tier = acc.tier;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found'); END IF;

  -- Roll monthly forward if expired or plan changed
  IF acc.points_reset_at IS NULL OR now_ts >= acc.points_reset_at
     OR acc.monthly_points_limit IS DISTINCT FROM plan_rec.monthly_point_allowance THEN
    acc.monthly_points_limit := plan_rec.monthly_point_allowance;
    acc.monthly_points_remaining := plan_rec.monthly_point_allowance;
    acc.points_reset_at := now_ts + INTERVAL '30 days';
    -- Log the reset as a grant
    INSERT INTO point_transactions (account_id, points, kind, reason, balance_after, created_by)
    VALUES (account_uuid, plan_rec.monthly_point_allowance, 'grant',
            'monthly reset: ' || plan_rec.tier, plan_rec.monthly_point_allowance, 'system');
  END IF;

  -- Roll daily free forward if expired
  IF acc.daily_free_requests_reset_at IS NULL OR now_ts >= acc.daily_free_requests_reset_at THEN
    acc.daily_free_requests_remaining := plan_rec.daily_free_requests_limit;
    acc.daily_free_requests_reset_at := now_ts + INTERVAL '24 hours';
  END IF;

  -- Check daily free cap if charging a 1pt model
  IF charge_free AND plan_rec.daily_free_requests_limit > 0 THEN
    IF acc.daily_free_requests_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'daily_free_cap',
        'daily_free_limit', plan_rec.daily_free_requests_limit,
        'daily_free_reset_at', acc.daily_free_requests_reset_at
      );
    END IF;
  END IF;

  -- Check monthly balance
  IF acc.monthly_points_remaining < points_to_charge THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'insufficient_points',
      'need', points_to_charge, 'have', acc.monthly_points_remaining,
      'points_reset_at', acc.points_reset_at
    );
  END IF;

  new_monthly_remaining := acc.monthly_points_remaining - points_to_charge;
  new_daily_free_remaining := acc.daily_free_requests_remaining;
  IF charge_free AND plan_rec.daily_free_requests_limit > 0 THEN
    new_daily_free_remaining := acc.daily_free_requests_remaining - 1;
  END IF;

  UPDATE accounts SET
    monthly_points_remaining = new_monthly_remaining,
    monthly_points_limit = acc.monthly_points_limit,
    points_reset_at = acc.points_reset_at,
    daily_free_requests_remaining = new_daily_free_remaining,
    daily_free_requests_reset_at = acc.daily_free_requests_reset_at,
    updated_at = now_ts
  WHERE id = account_uuid;

  -- Write ledger row
  reason_text := CASE
    WHEN model_alias IS NOT NULL THEN 'charge: ' || model_alias
    ELSE 'charge'
  END;
  INSERT INTO point_transactions (
    account_id, points, kind, reason, model_alias, request_log_id,
    balance_after, created_by, metadata
  ) VALUES (
    account_uuid, points_to_charge, 'charge', reason_text, model_alias, request_log_id,
    new_monthly_remaining, 'system',
    jsonb_build_object('charge_free', charge_free, 'free_remaining', new_daily_free_remaining)
  );

  RETURN jsonb_build_object(
    'ok', true, 'points_charged', points_to_charge,
    'monthly_remaining', new_monthly_remaining,
    'monthly_limit', acc.monthly_points_limit,
    'daily_free_remaining', new_daily_free_remaining,
    'free_request_charged', charge_free
  );
END;
$$;

-- Re-define refund_account_points with model_alias + ledger writes.
CREATE OR REPLACE FUNCTION refund_account_points(
  account_uuid UUID, points_to_refund BIGINT, refund_free BOOLEAN DEFAULT FALSE,
  model_alias TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE acc accounts%ROWTYPE; plan_rec plan_presets%ROWTYPE; new_balance BIGINT;
BEGIN
  SELECT * INTO acc FROM accounts WHERE id = account_uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO plan_rec FROM plan_presets WHERE tier = acc.tier;
  IF NOT FOUND THEN RETURN; END IF;
  new_balance := LEAST(acc.monthly_points_remaining + points_to_refund,
                       COALESCE(acc.monthly_points_limit, plan_rec.monthly_point_allowance));
  UPDATE accounts SET
    monthly_points_remaining = new_balance,
    daily_free_requests_remaining = CASE
      WHEN refund_free AND plan_rec.daily_free_requests_limit > 0
      THEN LEAST(acc.daily_free_requests_remaining + 1, plan_rec.daily_free_requests_limit)
      ELSE acc.daily_free_requests_remaining END,
    updated_at = now()
  WHERE id = account_uuid;

  -- Write ledger row
  INSERT INTO point_transactions (
    account_id, points, kind, reason, model_alias,
    balance_after, created_by, metadata
  ) VALUES (
    account_uuid, points_to_refund, 'refund',
    CASE WHEN model_alias IS NOT NULL THEN 'refund: ' || model_alias ELSE 'refund' END,
    model_alias, new_balance, 'system',
    jsonb_build_object('refund_free', refund_free)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION charge_account_points TO service_role;
GRANT EXECUTE ON FUNCTION refund_account_points TO service_role;
