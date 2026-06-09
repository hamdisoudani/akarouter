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
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    
    -- Usage tracking
    monthly_requests BIGINT NOT NULL DEFAULT 0,
    monthly_limit BIGINT NOT NULL DEFAULT 1000,
    total_requests BIGINT NOT NULL DEFAULT 0,
    
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
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    free_monthly_limit DOUBLE PRECISION;
    free_rpm_limit BIGINT;
    free_tokens_5h_limit DOUBLE PRECISION;
    free_tokens_7d_limit DOUBLE PRECISION;
BEGIN
    -- Query the current FREE plan preset details
    SELECT monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit
    INTO free_monthly_limit, free_rpm_limit, free_tokens_5h_limit, free_tokens_7d_limit
    FROM public.plan_presets
    WHERE tier = 'free';

    -- Insert account inheriting the FREE plan details
    INSERT INTO public.accounts (
        auth_user_id, 
        email, 
        display_name, 
        tier,
        monthly_limit,
        rpm_limit,
        tokens_5h_limit,
        tokens_7d_limit
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
        'free',
        COALESCE(free_monthly_limit, 10.0),
        COALESCE(free_rpm_limit, 60),
        COALESCE(free_tokens_5h_limit, 1.0),
        COALESCE(free_tokens_7d_limit, 5.0)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Trigger: auto-create account when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_providers_updated_at
    BEFORE UPDATE ON providers
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- VIEWS for dashboard
-- ============================================

-- Usage summary per account (current month)
CREATE OR REPLACE VIEW monthly_usage AS
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
CREATE OR REPLACE VIEW provider_health AS
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
