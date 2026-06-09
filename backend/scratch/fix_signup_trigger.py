import os
import sys
import psycopg2

# Adjust path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings

db_url = settings.supabase_db_url

SQL_TRIGGER_UPDATE = """
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    free_monthly_limit DOUBLE PRECISION;
    free_rpm_limit BIGINT;
    free_tokens_5h_limit DOUBLE PRECISION;
    free_tokens_7d_limit DOUBLE PRECISION;
    req_act TEXT;
    init_status TEXT := 'active';
BEGIN
    -- Query the current FREE plan preset details
    SELECT monthly_limit, rpm_limit, tokens_5h_limit, tokens_7d_limit
    INTO free_monthly_limit, free_rpm_limit, free_tokens_5h_limit, free_tokens_7d_limit
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
        
        print("Updating handle_new_user() trigger function in database...")
        cur.execute(SQL_TRIGGER_UPDATE)
        
        conn.commit()
        cur.close()
        conn.close()
        print("Trigger function updated successfully with merged activation & free plan inheritance logic!")
    except Exception as e:
        print(f"Failed to update trigger function: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_migration()
