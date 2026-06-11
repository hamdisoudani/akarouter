import os
import sys
import psycopg2

# Adjust path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings

db_url = settings.supabase_db_url

SQL_MIGRATION = """
-- 1. Add columns to plan_presets if they don't exist
ALTER TABLE plan_presets 
ADD COLUMN IF NOT EXISTS openclaw_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS max_agents INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS agent_cpu INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS agent_ram INT NOT NULL DEFAULT 1;

-- 2. Add columns to accounts if they don't exist
ALTER TABLE accounts 
ADD COLUMN IF NOT EXISTS openclaw_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS max_agents INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS agent_cpu INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS agent_ram INT NOT NULL DEFAULT 1;

-- 3. Set preset values for standard tiers
INSERT INTO plan_presets (tier, monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit, openclaw_enabled, max_agents, agent_cpu, agent_ram)
VALUES 
    ('free', 1000, 60, 1.0, 5.0, FALSE, 0, 1, 1),
    ('pro', 10000, 300, 10.0, 50.0, TRUE, 1, 1, 2),
    ('enterprise', 999999999, 3000, 100.0, 500.0, TRUE, 5, 2, 4)
ON CONFLICT (tier) DO UPDATE SET
    openclaw_enabled = EXCLUDED.openclaw_enabled,
    max_agents = EXCLUDED.max_agents,
    agent_cpu = EXCLUDED.agent_cpu,
    agent_ram = EXCLUDED.agent_ram;

-- 4. Sync existing user accounts to their tier defaults if they have default tier values
UPDATE accounts SET 
    openclaw_enabled = FALSE,
    max_agents = 0,
    agent_cpu = 1,
    agent_ram = 1
WHERE tier = 'free';

UPDATE accounts SET 
    openclaw_enabled = TRUE,
    max_agents = 1,
    agent_cpu = 1,
    agent_ram = 2
WHERE tier = 'pro';

UPDATE accounts SET 
    openclaw_enabled = TRUE,
    max_agents = 5,
    agent_cpu = 2,
    agent_ram = 4
WHERE tier = 'enterprise';

-- 5. Re-define handle_new_user() trigger function to copy new limits
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    free_monthly_limit DOUBLE PRECISION;
    free_rpm_limit BIGINT;
    free_tokens_5h_limit DOUBLE PRECISION;
    free_tokens_7d_limit DOUBLE PRECISION;
    free_openclaw_enabled BOOLEAN;
    free_max_agents INT;
    free_agent_cpu INT;
    free_agent_ram INT;
    req_act TEXT;
    init_status TEXT := 'active';
BEGIN
    -- Query the current FREE plan preset details
    SELECT monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit, openclaw_enabled, max_agents, agent_cpu, agent_ram
    INTO free_monthly_limit, free_rpm_limit, free_tokens_5h_limit, free_tokens_7d_limit, free_openclaw_enabled, free_max_agents, free_agent_cpu, free_agent_ram
    FROM public.plan_presets
    WHERE tier = 'free';

    -- Safe check if system_settings table exists and require_activation setting is active
    BEGIN
        SELECT value INTO req_act FROM public.system_settings WHERE key = 'require_activation';
    EXCEPTION WHEN OTHERS THEN
        req_act := 'false';
    END;
    
    IF req_act = 'true' THEN
        init_status := 'pending';
    END IF;

    -- Insert account inheriting the FREE plan details and status
    INSERT INTO public.accounts (
        auth_user_id, 
        email, 
        display_name, 
        tier,
        monthly_limit,
        rpm_limit,
        tokens_5h_limit,
        tokens_7d_limit,
        openclaw_enabled,
        max_agents,
        agent_cpu,
        agent_ram,
        status
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
        'free',
        COALESCE(free_monthly_limit, 10.0),
        COALESCE(free_rpm_limit, 60),
        COALESCE(free_tokens_5h_limit, 1.0),
        COALESCE(free_tokens_7d_limit, 5.0),
        COALESCE(free_openclaw_enabled, FALSE),
        COALESCE(free_max_agents, 0),
        COALESCE(free_agent_cpu, 1),
        COALESCE(free_agent_ram, 1),
        init_status
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
"""

def run_migration():
    if not db_url:
        print("Error: supabase_db_url is not configured in settings.")
        sys.exit(1)
        
    try:
        print("Connecting to database...")
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        print("Running SQL migration...")
        cur.execute(SQL_MIGRATION)
        
        conn.commit()
        cur.close()
        conn.close()
        print("Database migration completed successfully!")
    except Exception as e:
        print(f"Failed to execute migration: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_migration()
