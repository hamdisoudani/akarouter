import os
import sys
import psycopg2
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

def run_migration():
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        # 1. Drop dependent view
        print("Dropping view 'monthly_usage' temporarily...")
        cur.execute("DROP VIEW IF EXISTS monthly_usage;")
        
        # 2. Alter plan_presets.monthly_limit to DOUBLE PRECISION
        print("Altering plan_presets.monthly_limit to DOUBLE PRECISION...")
        cur.execute("ALTER TABLE plan_presets ALTER COLUMN monthly_limit TYPE DOUBLE PRECISION;")
        
        # 3. Alter accounts.monthly_limit to DOUBLE PRECISION
        print("Altering accounts.monthly_limit to DOUBLE PRECISION...")
        cur.execute("ALTER TABLE accounts ALTER COLUMN monthly_limit TYPE DOUBLE PRECISION;")
        conn.commit()
        print("Column types altered successfully!")
        
        # 3. Update defaults in plan_presets to USD values
        print("Updating defaults in plan_presets...")
        cur.execute("""
            UPDATE plan_presets 
            SET monthly_limit = CASE 
                WHEN tier = 'free' THEN 10.0
                WHEN tier = 'pro' THEN 100.0
                WHEN tier = 'enterprise' THEN 10000.0
                ELSE 10.0
            END;
        """)
        
        # 4. Update existing accounts monthly_limit to USD values
        print("Updating existing accounts limits...")
        cur.execute("""
            UPDATE accounts 
            SET monthly_limit = CASE 
                WHEN tier = 'free' THEN 10.0
                WHEN tier = 'pro' THEN 100.0
                WHEN tier = 'enterprise' THEN 10000.0
                ELSE 10.0
            END;
        """)
        
        # 5. Re-create dependent view
        print("Re-creating view 'monthly_usage'...")
        cur.execute("""
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
        """)
        conn.commit()
        print("Database monthly limits updated to USD budgets successfully!")
        
        # Verify
        cur.execute("SELECT tier, monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit FROM plan_presets;")
        rows = cur.fetchall()
        print("\nUpdated plan presets:")
        for r in rows:
            print(f"  Tier: {r[0]} | Monthly Limit (USD): ${r[1]} | RPM Limit: {r[2]} | 5h Limit: ${r[3]} | 7d Limit: ${r[4]}")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Migration failed: {e}")

if __name__ == "__main__":
    run_migration()
