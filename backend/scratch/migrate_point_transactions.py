"""
Migration: add point_transactions ledger table.

Every charge_account_points() / refund_account_points() call inserts a row
here so we have a full audit trail of point movements.

Idempotent — safe to re-run.
"""
import os
import sys
import psycopg2
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

MIGRATION_SQL = """
-- ============================================
-- 2026-06-19: point_transactions ledger
-- ============================================
-- Drop old functions (without model_alias / request_log_id) so we can re-create with new sig
DROP FUNCTION IF EXISTS charge_account_points(UUID, BIGINT, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS refund_account_points(UUID, BIGINT, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS charge_account_points CASCADE;
DROP FUNCTION IF EXISTS refund_account_points CASCADE;
-- Audit trail for every point movement.
-- Inserts happen inside charge_account_points / refund_account_points.

CREATE TABLE IF NOT EXISTS point_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    -- delta is positive (charge → e.g. -5 stored as 5 with kind='charge')
    -- Always store the magnitude. Use kind to indicate sign direction.
    points BIGINT NOT NULL CHECK (points > 0),
    kind TEXT NOT NULL CHECK (kind IN ('charge', 'refund', 'grant', 'adjustment')),

    -- Audit context
    reason TEXT,  -- human-readable: "model call", "monthly reset", "manual admin grant"
    model_alias TEXT,  -- which model triggered the charge (NULL for grants/adjustments)
    request_log_id UUID,  -- optional FK to request_logs (no formal FK to keep loose coupling)

    -- Snapshot of account state after the change (for fast "balance after" display)
    balance_after BIGINT NOT NULL,

    -- Admin / system attribution
    created_by TEXT,  -- 'system' | admin email | 'webhook:whop' | etc.
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
COMMENT ON COLUMN point_transactions.points IS 'Magnitude of point movement. Sign is given by kind (charge/refund).';
COMMENT ON COLUMN point_transactions.balance_after IS 'Account balance (monthly_points_remaining) immediately after this transaction.';

-- ============================================
-- Patch charge_account_points to write a ledger row
-- ============================================
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

-- ============================================
-- Patch refund_account_points to write a ledger row
-- ============================================
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
"""


def run():
    if not db_url:
        print("Error: AKAROUTER_SUPABASE_DB_URL not set.")
        sys.exit(1)
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    try:
        cur.execute(MIGRATION_SQL)
        conn.commit()
        print("Migration applied successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {e}")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()

    # Verify
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("""
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'point_transactions' ORDER BY ordinal_position;
    """)
    print("\npoint_transactions columns:")
    for col, typ in cur.fetchall():
        print(f"  {col}: {typ}")
    cur.execute("""
        SELECT routine_name FROM information_schema.routines
        WHERE routine_name IN ('charge_account_points', 'refund_account_points');
    """)
    print("\nFunctions present:")
    for (name,) in cur.fetchall():
        print(f"  {name}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    run()
