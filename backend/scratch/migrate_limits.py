import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

try:
    print("Connecting to database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    # 1. Add columns to plan_presets if they don't exist
    print("Checking/adding columns to 'plan_presets'...")
    cur.execute("""
        ALTER TABLE plan_presets 
        ADD COLUMN IF NOT EXISTS rpm_limit BIGINT NOT NULL DEFAULT 60,
        ADD COLUMN IF NOT EXISTS tokens_5h_limit DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        ADD COLUMN IF NOT EXISTS tokens_7d_limit DOUBLE PRECISION NOT NULL DEFAULT 5.0;
    """)
    
    # 2. Add columns to accounts if they don't exist
    print("Checking/adding columns to 'accounts'...")
    cur.execute("""
        ALTER TABLE accounts 
        ADD COLUMN IF NOT EXISTS rpm_limit BIGINT NOT NULL DEFAULT 60,
        ADD COLUMN IF NOT EXISTS tokens_5h_limit DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        ADD COLUMN IF NOT EXISTS tokens_7d_limit DOUBLE PRECISION NOT NULL DEFAULT 5.0,
        ADD COLUMN IF NOT EXISTS budget_reset_at TIMESTAMPTZ DEFAULT NULL;
    """)
    
    # 3. Add cost column to request_logs if it doesn't exist
    print("Checking/adding 'cost' column to 'request_logs'...")
    cur.execute("""
        ALTER TABLE request_logs 
        ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION NOT NULL DEFAULT 0.0;
    """)
    
    # 4. Insert or update default limits on plan_presets
    print("Updating plan presets default values...")
    cur.execute("""
        INSERT INTO plan_presets (tier, monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit)
        VALUES 
            ('free', 1000, 60, 1.0, 5.0),
            ('pro', 10000, 300, 10.0, 50.0),
            ('enterprise', 999999999, 3000, 100.0, 500.0)
        ON CONFLICT (tier) DO UPDATE SET
            monthly_limit = EXCLUDED.monthly_limit,
            rpm_limit = EXCLUDED.rpm_limit,
            tokens_5h_limit = EXCLUDED.tokens_5h_limit,
            tokens_7d_limit = EXCLUDED.tokens_7d_limit;
    """)
    
    # 5. Update limits of existing accounts to match their tier defaults
    print("Synchronizing existing accounts limits with plan defaults...")
    cur.execute("""
        UPDATE accounts SET 
            rpm_limit = 60, 
            tokens_5h_limit = 1.0, 
            tokens_7d_limit = 5.0 
        WHERE tier = 'free';
    """)
    cur.execute("""
        UPDATE accounts SET 
            rpm_limit = 300, 
            tokens_5h_limit = 10.0, 
            tokens_7d_limit = 50.0 
        WHERE tier = 'pro';
    """)
    cur.execute("""
        UPDATE accounts SET 
            rpm_limit = 3000, 
            tokens_5h_limit = 100.0, 
            tokens_7d_limit = 500.0 
        WHERE tier = 'enterprise';
    """)
    
    conn.commit()
    cur.close()
    conn.close()
    print("Migration completed successfully!")
except Exception as e:
    print(f"Migration error: {e}")
