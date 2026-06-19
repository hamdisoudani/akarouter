"""
Migration: drop t1/t2/t3 from plan_presets (2026-06-19).

Reason: t1/t2/t3 call caps were the old request-based pricing model.
Replaced by point-based pricing. The columns are no longer enforced
and are not on the accounts table (which the backend SELECTs from).
"""
import os, sys, psycopg2
from dotenv import load_dotenv
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

MIGRATION_SQL = """
ALTER TABLE plan_presets
    DROP COLUMN IF EXISTS t1_requests_limit,
    DROP COLUMN IF EXISTS t2_requests_limit,
    DROP COLUMN IF EXISTS t3_requests_limit;
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
        print("Migration applied: dropped t1/t2/t3 from plan_presets.")
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {e}")
        sys.exit(1)
    finally:
        cur.close(); conn.close()

    # Verify
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("""SELECT column_name FROM information_schema.columns
        WHERE table_name='plan_presets' AND column_name LIKE 't%_requests%';""")
    rows = cur.fetchall()
    if rows:
        print("WARNING: still have:", [r[0] for r in rows])
    else:
        print("OK: no t1/t2/t3 columns on plan_presets.")
    cur.close(); conn.close()


if __name__ == "__main__":
    run()
