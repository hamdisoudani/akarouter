import os
import sys
import psycopg2

# Adjust path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings

db_url = settings.supabase_db_url

try:
    print("Connecting to database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    print("Adding columns to hosted_agents...")
    cur.execute("""
        ALTER TABLE hosted_agents 
        ADD COLUMN IF NOT EXISTS agent_cpu INT NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS agent_ram INT NOT NULL DEFAULT 1;
    """)
    
    conn.commit()
    cur.close()
    conn.close()
    print("Successfully added columns to hosted_agents!")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
