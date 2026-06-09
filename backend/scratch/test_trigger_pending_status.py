import os
import sys
import uuid
import psycopg2

# Adjust path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings

db_url = settings.supabase_db_url

def run_test():
    if not db_url:
        print("Error: supabase_db_url is not configured.")
        sys.exit(1)
        
    try:
        print("Connecting to database...")
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        # Helper to get setting
        def get_setting():
            cur.execute("SELECT value FROM public.system_settings WHERE key = 'require_activation';")
            row = cur.fetchone()
            return row[0] if row else None

        # Helper to set setting
        def set_setting(val):
            cur.execute("INSERT INTO public.system_settings (key, value) VALUES ('require_activation', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;", (val,))
            conn.commit()

        # Save original setting
        original_setting = get_setting()
        print(f"Original require_activation setting: {original_setting}")
        
        # Test Case 1: require_activation = 'true'
        print("\n--- TEST CASE 1: require_activation = 'true' ---")
        set_setting('true')
        print("Set require_activation = 'true'")
        
        # Generate random IDs
        user_id_1 = str(uuid.uuid4())
        email_1 = f"test_trigger_{user_id_1[:8]}@akarouter.test"
        
        print(f"Inserting mock user 1: ID={user_id_1}, Email={email_1}")
        # Insert into auth.users (minimum fields for trigger to work)
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, %s);",
            (user_id_1, email_1, '{}')
        )
        conn.commit()
        
        # Verify account created and status
        cur.execute("SELECT status, tier, monthly_limit, rpm_limit FROM public.accounts WHERE auth_user_id = %s;", (user_id_1,))
        row = cur.fetchone()
        if not row:
            print("ERROR: Account row was NOT created by trigger!")
        else:
            status, tier, monthly_limit, rpm_limit = row
            print(f"Account created successfully! Status={status}, Tier={tier}, Monthly Limit={monthly_limit}, RPM Limit={rpm_limit}")
            assert status == 'pending', f"Expected status 'pending', got '{status}'"
            print("SUCCESS: Account status is pending.")
            
        # Test Case 2: require_activation = 'false'
        print("\n--- TEST CASE 2: require_activation = 'false' ---")
        set_setting('false')
        print("Set require_activation = 'false'")
        
        user_id_2 = str(uuid.uuid4())
        email_2 = f"test_trigger_{user_id_2[:8]}@akarouter.test"
        
        print(f"Inserting mock user 2: ID={user_id_2}, Email={email_2}")
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, %s);",
            (user_id_2, email_2, '{}')
        )
        conn.commit()
        
        cur.execute("SELECT status, tier, monthly_limit, rpm_limit FROM public.accounts WHERE auth_user_id = %s;", (user_id_2,))
        row = cur.fetchone()
        if not row:
            print("ERROR: Account row was NOT created by trigger!")
        else:
            status, tier, monthly_limit, rpm_limit = row
            print(f"Account created successfully! Status={status}, Tier={tier}, Monthly Limit={monthly_limit}, RPM Limit={rpm_limit}")
            assert status == 'active', f"Expected status 'active', got '{status}'"
            print("SUCCESS: Account status is active.")
            
        # Clean up
        print("\nCleaning up mock users...")
        cur.execute("DELETE FROM auth.users WHERE id IN (%s, %s);", (user_id_1, user_id_2))
        conn.commit()
        print("Cleanup successful.")
        
        # Restore setting
        if original_setting is not None:
            set_setting(original_setting)
            print(f"Restored original require_activation setting: {original_setting}")
            
        cur.close()
        conn.close()
        print("\n--- ALL TESTS PASSED SUCCESSFULLY! ---")
        
    except Exception as e:
        print(f"\n[ERROR] Test failed: {e}")
        # Try to restore setting and clean up if possible
        try:
            conn = psycopg2.connect(db_url)
            cur = conn.cursor()
            cur.execute("DELETE FROM auth.users WHERE email LIKE 'test_trigger_%@akarouter.test';")
            if 'original_setting' in locals() and original_setting is not None:
                cur.execute("INSERT INTO public.system_settings (key, value) VALUES ('require_activation', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;", (original_setting,))
            conn.commit()
            cur.close()
            conn.close()
            print("Restored db state after failure.")
        except Exception as cleanup_err:
            print(f"Cleanup during error failed: {cleanup_err}")
        sys.exit(1)

if __name__ == "__main__":
    run_test()
