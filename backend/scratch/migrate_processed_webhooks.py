"""
SECURITY migration: add `processed_webhooks` table for webhook idempotency.

Background:
  Whop retries webhooks on transient failures. The previous handler relied on a
  "state-equality check" (compare current account state to desired state) to detect
  duplicate events. This was racy: a duplicate event arriving between two admin
  edits would clobber the second edit, and concurrent deliveries could both pass
  the check.

  This migration adds a unique-keyed log of processed webhook IDs. The handler
  inserts before applying side effects; duplicates are silently ignored with a
  200 response (webhook best practice — never 4xx on legitimate retry).

Run with:
  python -m backend.scratch.migrate_processed_webhooks
"""
import os
import sys

# Allow running from repo root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from supabase import create_client
from app.core.config import settings


MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS processed_webhooks (
    webhook_id      TEXT PRIMARY KEY,
    source          TEXT NOT NULL DEFAULT 'whop',
    account_id      UUID,
    event_type      TEXT,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'received'
);

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_account
    ON processed_webhooks (account_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_received_at
    ON processed_webhooks (received_at);

-- Auto-prune entries older than 30 days. Cron this weekly or run via pg_cron.
-- (Optional — uncomment if pg_cron extension is available)
-- SELECT cron.schedule('prune-processed-webhooks', '0 3 * * 0', $$
--     DELETE FROM processed_webhooks WHERE received_at < now() - interval '30 days';
-- $$);
"""


def main() -> None:
    if not settings.supabase_configured:
        print("ERROR: AKAROUTER_SUPABASE_URL / AKAROUTER_SUPABASE_SERVICE_ROLE_KEY not set.")
        sys.exit(1)

    client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    # The supabase-py client doesn't expose raw SQL directly, so we use the
    # PostgREST RPC endpoint by calling postgres.query via the service-role.
    # If that doesn't work in your version, run the SQL via the Supabase SQL editor.
    try:
        # postgrest-py doesn't expose a `query` method, but we can use the
        # underlying httpx client. Fall back to a documented RPC.
        from postgrest.exceptions import APIError
        # Use a helper RPC function (created below if missing).
        rpc_name = "apply_processed_webhooks_migration"
        try:
            client.rpc(rpc_name, {}).execute()
            print(f"OK: applied migration via RPC {rpc_name}")
            return
        except APIError as rpc_err:
            print(f"RPC {rpc_name} not available ({rpc_err}); falling back to manual SQL via SQL editor.")
    except Exception:
        pass

    print("\n=== MANUAL STEP REQUIRED ===")
    print("Copy the following SQL into the Supabase SQL editor and run it:\n")
    print(MIGRATION_SQL)
    print("=== END ===\n")


if __name__ == "__main__":
    main()
