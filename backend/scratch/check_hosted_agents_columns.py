import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name='hosted_agents' 
        ORDER BY ordinal_position;
    """)
    columns = cur.fetchall()
    print("Columns in hosted_agents table:")
    for col in columns:
        print(f" - {col[0]}: {col[1]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
