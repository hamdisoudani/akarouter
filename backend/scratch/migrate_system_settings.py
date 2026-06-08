import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

try:
    print("Connecting to database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    # Create system_settings table if it doesn't exist
    print("Creating 'system_settings' table...")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key VARCHAR PRIMARY KEY,
            value VARCHAR NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    
    # Insert default settings
    print("Inserting default settings...")
    cur.execute("""
        INSERT INTO system_settings (key, value)
        VALUES ('gateway_enabled', 'true')
        ON CONFLICT (key) DO NOTHING;
    """)
    
    conn.commit()
    cur.close()
    conn.close()
    print("System settings migration completed successfully!")
except Exception as e:
    print(f"Migration error: {e}")
