import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

sql = """
CREATE TABLE IF NOT EXISTS daytona_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_label TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    api_url TEXT NOT NULL DEFAULT 'https://app.daytona.io',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_key_label UNIQUE (key_label)
);

-- Enable RLS
ALTER TABLE daytona_keys ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist
DROP POLICY IF EXISTS "Service role full access" ON daytona_keys;

-- Recreate policy
CREATE POLICY "Service role full access" ON daytona_keys
    FOR ALL USING (auth.role() = 'service_role');

-- Alter hosted_agents to add telemetry and key references
ALTER TABLE hosted_agents ADD COLUMN IF NOT EXISTS daytona_key_id UUID REFERENCES daytona_keys(id) ON DELETE SET NULL;
ALTER TABLE hosted_agents ADD COLUMN IF NOT EXISTS progress_step INT NOT NULL DEFAULT 0;
ALTER TABLE hosted_agents ADD COLUMN IF NOT EXISTS progress_message TEXT NOT NULL DEFAULT 'Initializing deployment pipeline...';
"""

print(f"Connecting to database using: {db_url}")
try:
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
        print("Successfully created/updated 'daytona_keys' and modified 'hosted_agents'.")
    conn.close()
except Exception as e:
    print(f"Error executing migration: {e}")
