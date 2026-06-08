import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    # 1. Create table plan_presets
    cur.execute("""
        CREATE TABLE IF NOT EXISTS plan_presets (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tier TEXT UNIQUE NOT NULL,
            monthly_limit BIGINT NOT NULL DEFAULT 1000,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)
    print("Table 'plan_presets' verified/created.")
    
    # 2. Insert initial data if table is empty
    cur.execute("SELECT COUNT(*) FROM plan_presets;")
    count = cur.fetchone()[0]
    if count == 0:
        cur.execute("""
            INSERT INTO plan_presets (tier, monthly_limit) VALUES 
            ('free', 1000),
            ('pro', 10000),
            ('enterprise', 999999999);
        """)
        print("Initial plan presets inserted (free, pro, enterprise).")
        
    # 3. Enable RLS and setup policies
    cur.execute("ALTER TABLE plan_presets ENABLE ROW LEVEL SECURITY;")
    
    # Drop existing policies if they exist (to avoid duplicates)
    cur.execute("DROP POLICY IF EXISTS \"Users can read plan presets\" ON plan_presets;")
    cur.execute("DROP POLICY IF EXISTS \"Service role can manage plan presets\" ON plan_presets;")
    
    cur.execute("""
        CREATE POLICY "Users can read plan presets" ON plan_presets
            FOR SELECT USING (true);
    """)
    cur.execute("""
        CREATE POLICY "Service role can manage plan presets" ON plan_presets
            FOR ALL USING (auth.role() = 'service_role');
    """)
    print("RLS and policies configured.")
    
    conn.commit()
    cur.close()
    conn.close()
    print("Migration completed successfully!")
except Exception as e:
    print(f"Migration error: {e}")
