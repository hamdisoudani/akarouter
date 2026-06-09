import os
import sys
import psycopg2
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

def run_update():
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        print("Updating capabilities for 'akarouter-pro' to text-only...")
        cur.execute("""
            UPDATE model_mapping 
            SET capabilities = ARRAY['text']
            WHERE alias = 'akarouter-pro';
        """)
        conn.commit()
        print("Update completed successfully!")
        
        # Verify
        cur.execute("SELECT alias, capabilities FROM model_mapping;")
        rows = cur.fetchall()
        for row in rows:
            print(f"Model: {row[0]} | Capabilities: {row[1]}")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Update failed: {e}")

if __name__ == "__main__":
    run_update()
