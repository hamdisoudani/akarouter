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
        
        # 1. Alter check constraint for accounts status to allow 'pending'
        print("Altering accounts status check constraint to include 'pending'...")
        cur.execute("ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_status_check;")
        cur.execute("""
            ALTER TABLE accounts 
            ADD CONSTRAINT accounts_status_check 
            CHECK (status = ANY (ARRAY['active'::text, 'pending'::text, 'suspended'::text, 'cancelled'::text]));
        """)
        conn.commit()
        
        # 2. Create invitation_codes table
        print("Creating table 'invitation_codes'...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS invitation_codes (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                code TEXT UNIQUE NOT NULL,
                max_uses INT NOT NULL DEFAULT 1,
                used_count INT NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
        conn.commit()
        
        # Enable RLS on invitation_codes
        print("Enabling RLS on 'invitation_codes'...")
        cur.execute("ALTER TABLE invitation_codes ENABLE ROW LEVEL SECURITY;")
        
        # Add basic policy for service role/admin (since backend uses service role, no public select policy is needed)
        cur.execute("DROP POLICY IF EXISTS \"Service role can manage invitation codes\" ON invitation_codes;")
        cur.execute("""
            CREATE POLICY "Service role can manage invitation codes" ON invitation_codes
            FOR ALL USING (true);
        """)
        conn.commit()
        
        # 3. Seed require_activation in system_settings if not present
        print("Seeding 'require_activation' system setting...")
        cur.execute("""
            INSERT INTO system_settings (key, value) 
            VALUES ('require_activation', 'false') 
            ON CONFLICT (key) DO NOTHING;
        """)
        conn.commit()
        
        # 4. Re-create public.handle_new_user trigger function to set status to pending if require_activation is true
        print("Re-creating handle_new_user trigger function with require_activation check...")
        cur.execute("""
            CREATE OR REPLACE FUNCTION public.handle_new_user()
            RETURNS TRIGGER AS $$
            DECLARE
                req_act TEXT;
                init_status TEXT := 'active';
            BEGIN
                -- Safe check if system_settings table exists
                BEGIN
                    SELECT value INTO req_act FROM public.system_settings WHERE key = 'require_activation';
                EXCEPTION WHEN OTHERS THEN
                    req_act := 'false';
                END;
                
                IF req_act = 'true' THEN
                    init_status := 'pending';
                END IF;

                INSERT INTO public.accounts (auth_user_id, email, display_name, tier, status)
                VALUES (
                    NEW.id,
                    NEW.email,
                    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
                    'free',
                    init_status
                );
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql SECURITY DEFINER;
        """)
        conn.commit()
        
        print("\nDatabase migration completed successfully!")
        
        # Verify
        cur.execute("SELECT name, pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE conname = 'accounts_status_check';")
        row = cur.fetchone()
        if row:
            print(f"Verified constraint: {row[0]} -> {row[1]}")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Migration failed: {e}")

if __name__ == "__main__":
    run_migration()
