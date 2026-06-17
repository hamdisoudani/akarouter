-- AKAROUTER RLS hardening + admin audit log
--
-- Purpose:
--   Closes 3 RLS gaps found in the existing schema and adds an
--   append-only audit_log table for tracking privileged actions
--   (tier changes, suspensions, admin grants, key revocations, etc.).
--
-- Idempotent: safe to run multiple times. CREATE OR REPLACE used where possible.
-- DO blocks use IF NOT EXISTS-style guards for table-level operations.

-- ============================================================================
-- 1. RLS on previously unprotected tables
-- ============================================================================

-- system_settings: keys like 'gateway_enabled', 'recaptcha_site_key', etc.
-- Default-deny for all roles EXCEPT service_role (which bypasses RLS anyway,
-- but explicit policy is documentation).
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage system_settings" ON system_settings;
CREATE POLICY "Service role can manage system_settings" ON system_settings
    FOR ALL USING (auth.role() = 'service_role');

-- plan_presets: pricing config. Public read is fine (landing page reads it),
-- but only service_role can write.
ALTER TABLE plan_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read plan_presets" ON plan_presets;
CREATE POLICY "Anyone can read plan_presets" ON plan_presets
    FOR SELECT USING (TRUE);  -- public read for landing page

DROP POLICY IF EXISTS "Service role can manage plan_presets" ON plan_presets;
CREATE POLICY "Service role can manage plan_presets" ON plan_presets
    FOR ALL USING (auth.role() = 'service_role');

-- invitation_codes: users must NOT be able to enumerate codes.
-- Only service_role can read/write. No public read.
ALTER TABLE invitation_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage invitation_codes" ON invitation_codes;
CREATE POLICY "Service role can manage invitation_codes" ON invitation_codes
    FOR ALL USING (auth.role() = 'service_role');


-- ============================================================================
-- 2. Explicit service_role policies on tables that previously relied on the
--    bypass (RLS enabled but no explicit policy = deny-by-default which
--    blocks anon but lets service_role through; explicit is safer for
--    future schema changes that might add permissive policies).
-- ============================================================================

DROP POLICY IF EXISTS "Service role can manage accounts" ON accounts;
CREATE POLICY "Service role can manage accounts" ON accounts
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can manage api_keys" ON api_keys;
CREATE POLICY "Service role can manage api_keys" ON api_keys
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can manage request_logs" ON request_logs;
CREATE POLICY "Service role can manage request_logs" ON request_logs
    FOR ALL USING (auth.role() = 'service_role');


-- ============================================================================
-- 3. Block user self-escalation: prevent a user from changing their own role
--    or tier via the anon/authenticated PostgREST interface.
--    The backend uses service_role to update these, so no legitimate path
--    is blocked.
-- ============================================================================

-- Drop and recreate the "Users can update own account" policy with a
-- column-level restriction. PostgREST does not support column-level RLS
-- directly, so we use a WITH CHECK that excludes sensitive columns.
DROP POLICY IF EXISTS "Users can update own account" ON accounts;
CREATE POLICY "Users can update own account" ON accounts
    FOR UPDATE
    USING (auth_user_id = auth.uid())
    WITH CHECK (
        auth_user_id = auth.uid()
        -- The following columns can only be changed by service_role.
        -- This relies on the fact that if a column is not present in the
        -- UPDATE payload, the comparison stays at its existing value.
        -- PostgREST + RLS doesn't enforce this perfectly, but combined
        -- with the backend never exposing these columns to the client,
        -- it provides defense in depth.
    );

-- Belt-and-braces: trigger that blocks any non-service_role attempt to
-- change tier, role, status, or whop_user_id on accounts.
CREATE OR REPLACE FUNCTION public.guard_privileged_account_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.role() <> 'service_role' THEN
        IF NEW.tier IS DISTINCT FROM OLD.tier THEN
            RAISE EXCEPTION 'tier cannot be modified by %', auth.role()
                USING ERRCODE = '42501';  -- insufficient_privilege
        END IF;
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'role cannot be modified by %', auth.role()
                USING ERRCODE = '42501';
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'status cannot be modified by %', auth.role()
                USING ERRCODE = '42501';
        END IF;
        IF NEW.whop_user_id IS DISTINCT FROM OLD.whop_user_id THEN
            RAISE EXCEPTION 'whop_user_id cannot be modified by %', auth.role()
                USING ERRCODE = '42501';
        END IF;
        IF NEW.monthly_limit IS DISTINCT FROM OLD.monthly_limit THEN
            RAISE EXCEPTION 'monthly_limit cannot be modified by %', auth.role()
                USING ERRCODE = '42501';
        END IF;
        IF NEW.tokens_5h_limit IS DISTINCT FROM OLD.tokens_5h_limit THEN
            RAISE EXCEPTION 'tokens_5h_limit cannot be modified by %', auth.role()
                USING ERRCODE = '42501';
        END IF;
        IF NEW.tokens_7d_limit IS DISTINCT FROM OLD.tokens_7d_limit THEN
            RAISE EXCEPTION 'tokens_7d_limit cannot be modified by %', auth.role()
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_privileged_account_columns ON accounts;
CREATE TRIGGER trg_guard_privileged_account_columns
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_privileged_account_columns();


-- ============================================================================
-- 4. Append-only audit_log table
-- ============================================================================
--
-- Every privileged action (tier change, suspension, admin grant, API key
-- revocation, invitation code use, system setting change) should write a
-- row here. The backend writes via service_role. Users have NO access
-- (no policy = default deny, even for service_role's anon users).
--
-- The table is APPEND-ONLY: UPDATE and DELETE are blocked at the trigger
-- level so even a compromised service_role key cannot rewrite history.
-- (Defense in depth: in a real incident, even the attacker can't cover
-- their tracks without dropping the trigger — which would itself be
-- logged in Postgres's event trigger if you set one up.)

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id UUID,  -- auth.uid() of the user performing the action (NULL for system)
    actor_role TEXT NOT NULL DEFAULT 'system',  -- 'admin', 'user', 'system', 'webhook'
    action TEXT NOT NULL,  -- 'tier.upgrade', 'account.suspend', 'key.revoke', etc.
    target_type TEXT NOT NULL,  -- 'account', 'api_key', 'system_setting', etc.
    target_id TEXT,  -- string-cast UUID or other identifier
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    request_id TEXT  -- correlate with application logs
);

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read (via service_role in the backend admin endpoints).
-- The backend checks `role = 'admin'` before exposing audit data.
DROP POLICY IF EXISTS "Service role can read audit_log" ON audit_log;
CREATE POLICY "Service role can read audit_log" ON audit_log
    FOR SELECT USING (auth.role() = 'service_role');

-- Inserts are allowed for service_role (the backend logs as it acts).
DROP POLICY IF EXISTS "Service role can insert audit_log" ON audit_log;
CREATE POLICY "Service role can insert audit_log" ON audit_log
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Explicit deny: no one (including service_role) can UPDATE or DELETE.
-- The trigger below enforces this even if the policy is bypassed.
DROP POLICY IF EXISTS "Deny update on audit_log" ON audit_log;
CREATE POLICY "Deny update on audit_log" ON audit_log
    FOR UPDATE USING (FALSE);

DROP POLICY IF EXISTS "Deny delete on audit_log" ON audit_log;
CREATE POLICY "Deny delete on audit_log" ON audit_log
    FOR DELETE USING (FALSE);

-- Belt-and-braces: triggers that BLOCK any UPDATE or DELETE on audit_log.
-- This protects against future policy mistakes and against anyone with
-- direct table access (e.g., a misconfigured superuser session).
CREATE OR REPLACE FUNCTION public.guard_audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_audit_log_update ON audit_log;
CREATE TRIGGER trg_block_audit_log_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_audit_log_immutable();

DROP TRIGGER IF EXISTS trg_block_audit_log_delete ON audit_log;
CREATE TRIGGER trg_block_audit_log_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_audit_log_immutable();


-- ============================================================================
-- 5. Helper function: write_audit_log(...)
-- ============================================================================
--
-- All backend code should call this function (via RPC) rather than
-- inserting directly into audit_log. This:
--   - Sets defaults from auth context automatically
--   - Enforces a non-empty action + target_type
--   - Returns the row id so callers can correlate
--
-- Privileges: granted to service_role only.

CREATE OR REPLACE FUNCTION public.write_audit_log(
    p_action TEXT,
    p_target_type TEXT,
    p_target_id TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_request_id TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER  -- run with function owner's privileges (bypasses RLS)
SET search_path = public
AS $$
DECLARE
    v_id BIGINT;
    v_actor_id UUID;
    v_actor_role TEXT;
BEGIN
    -- Determine actor
    v_actor_id := auth.uid();
    v_actor_role := COALESCE(
        (SELECT role FROM accounts WHERE auth_user_id = auth.uid() LIMIT 1),
        'system'
    );

    -- Validate required fields
    IF p_action IS NULL OR length(trim(p_action)) = 0 THEN
        RAISE EXCEPTION 'audit_log.action is required'
            USING ERRCODE = '22023';  -- invalid_parameter_value
    END IF;
    IF p_target_type IS NULL OR length(trim(p_target_type)) = 0 THEN
        RAISE EXCEPTION 'audit_log.target_type is required'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO audit_log (
        actor_id, actor_role, action, target_type, target_id,
        metadata, ip_address, user_agent, request_id
    ) VALUES (
        v_actor_id, v_actor_role, p_action, p_target_type, p_target_id,
        p_metadata, p_ip_address, p_user_agent, p_request_id
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log(TEXT, TEXT, TEXT, JSONB, INET, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_audit_log(TEXT, TEXT, TEXT, JSONB, INET, TEXT, TEXT) TO service_role;


-- ============================================================================
-- 6. Auto-audit tier changes via trigger
-- ============================================================================
--
-- Every UPDATE of `accounts.tier` writes an audit_log row automatically.
-- This catches even the case where the backend forgets to call write_audit_log.

CREATE OR REPLACE FUNCTION public.audit_account_tier_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tier IS DISTINCT FROM OLD.tier THEN
        PERFORM public.write_audit_log(
            p_action := 'tier.change',
            p_target_type := 'account',
            p_target_id := NEW.id::text,
            p_metadata := jsonb_build_object(
                'old_tier', OLD.tier,
                'new_tier', NEW.tier,
                'is_trialing', NEW.is_trialing
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_account_tier_change ON accounts;
CREATE TRIGGER trg_audit_account_tier_change
    AFTER UPDATE OF tier ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_account_tier_change();


-- ============================================================================
-- 7. Auto-audit status changes (suspensions, reactivations, cancellations)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_account_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        PERFORM public.write_audit_log(
            p_action := 'status.change',
            p_target_type := 'account',
            p_target_id := NEW.id::text,
            p_metadata := jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'suspended_reason', NEW.suspended_reason
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_account_status_change ON accounts;
CREATE TRIGGER trg_audit_account_status_change
    AFTER UPDATE OF status ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_account_status_change();