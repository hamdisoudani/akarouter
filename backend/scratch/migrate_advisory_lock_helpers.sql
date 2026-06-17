-- Advisory lock helper SQL functions for AKAROUTER
--
-- Purpose:
--   Wraps Postgres built-in pg_try_advisory_xact_lock(int4, int4) and
--   pg_advisory_xact_lock(int4, int4) in PL/pgSQL functions that
--   PostgREST (Supabase's REST layer) can call via RPC.
--
--   PostgREST cannot directly expose functions that take int4 args as
--   query parameters because of the way it introspects the schema. We
--   wrap them in functions that take text/bigint args and cast inside.
--
-- How to run:
--   Paste this file into the Supabase SQL editor and click "Run".
--   Or via psql:
--     psql "$SUPABASE_DB_URL" -f migrate_advisory_lock_helpers.sql
--
-- Idempotent: safe to run multiple times. CREATE OR REPLACE.

-- 1. Blocking lock: waits until the lock is available, returns void.
-- SECURITY: SET search_path = pg_catalog, public prevents schema-hijack
-- attacks. Without this, an attacker with CREATE permission on a writable
-- schema could shadow built-ins (e.g., a malicious `pg_advisory_xact_lock`
-- in a public schema search path). Same for the try-lock variant below.
CREATE OR REPLACE FUNCTION public.pg_advisory_xact_lock_int(p_ns int, p_key int)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Two-arg form: namespace + key. Both must fit in int4.
  PERFORM pg_advisory_xact_lock(p_ns::int, p_key::int);
END;
$$;

-- 2. Non-blocking try-lock: returns true if acquired, false otherwise.
CREATE OR REPLACE FUNCTION public.pg_try_advisory_xact_lock_int(p_ns int, p_key int)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN pg_try_advisory_xact_lock(p_ns::int, p_key::int);
END;
$$;

-- Revoke public execute permission and grant to authenticated + service_role only.
-- We do NOT want anonymous users to be able to acquire locks.
REVOKE ALL ON FUNCTION public.pg_advisory_xact_lock_int(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_try_advisory_xact_lock_int(int, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.pg_advisory_xact_lock_int(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.pg_try_advisory_xact_lock_int(int, int) TO service_role;