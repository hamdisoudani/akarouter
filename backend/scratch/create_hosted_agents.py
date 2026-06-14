import os
import psycopg2
from dotenv import load_dotenv

# Load env file
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path)

db_url = os.getenv("AKAROUTER_SUPABASE_DB_URL")

sql = """
CREATE TABLE IF NOT EXISTS hosted_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    sandbox_id TEXT,                -- Daytona sandbox ID
    status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (status IN ('provisioning', 'installing', 'running', 'stopped', 'failed', 'destroying')),

    -- Auto-generated dedicated API key for this agent
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    api_key_raw_encrypted TEXT,     -- AES-encrypted raw akar_ key
    model_name TEXT NOT NULL DEFAULT 'akarouter-pro',

    -- Channel configs (encrypted at rest)
    telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    telegram_bot_token TEXT,
    telegram_allow_from TEXT,       -- Comma-separated Telegram user IDs
    discord_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    discord_bot_token TEXT,
    discord_guilds JSONB,           -- Structured guild/channel config

    -- Metadata
    last_health_check TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hosted_agents_account ON hosted_agents(account_id);
CREATE INDEX IF NOT EXISTS idx_hosted_agents_status ON hosted_agents(status);

-- Enable RLS
ALTER TABLE hosted_agents ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist before creating
DROP POLICY IF EXISTS "Users can read own agents" ON hosted_agents;
DROP POLICY IF EXISTS "Service role full access" ON hosted_agents;

-- Recreate policies
CREATE POLICY "Users can read own agents" ON hosted_agents
    FOR SELECT USING (account_id IN (SELECT id FROM accounts WHERE auth_user_id = auth.uid()));
CREATE POLICY "Service role full access" ON hosted_agents
    FOR ALL USING (auth.role() = 'service_role');
"""

print(f"Connecting to database using: {db_url}")
try:
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
        print("Successfully created/updated 'hosted_agents' table and policies.")
    conn.close()
except Exception as e:
    print(f"Error executing script: {e}")
