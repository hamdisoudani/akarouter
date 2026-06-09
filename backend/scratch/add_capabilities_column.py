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
        
        # 1. Add capabilities column if not exists
        print("Adding 'capabilities' column to 'model_mapping' table...")
        cur.execute("""
            ALTER TABLE model_mapping 
            ADD COLUMN IF NOT EXISTS capabilities TEXT[] DEFAULT ARRAY['text'];
        """)
        conn.commit()
        print("Column added successfully!")
        
        # 2. Update existing rows with their capabilities
        print("Updating capabilities for 'akarouter-pro'...")
        cur.execute("""
            UPDATE model_mapping 
            SET capabilities = ARRAY['text', 'image', 'video']
            WHERE alias = 'akarouter-pro';
        """)
        
        print("Updating capabilities for 'akarouter-flash'...")
        cur.execute("""
            UPDATE model_mapping 
            SET capabilities = ARRAY['text']
            WHERE alias = 'akarouter-flash';
        """)
        conn.commit()
        print("Rows updated successfully!")
        
        # 3. Query rows to verify
        cur.execute("SELECT alias, display_name, capabilities FROM model_mapping;")
        rows = cur.fetchall()
        print("\nCurrent rows in 'model_mapping':")
        for row in rows:
            print(f"  Alias: {row[0]} | Display Name: {row[1]} | Capabilities: {row[2]}")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Migration failed: {e}")

if __name__ == "__main__":
    run_migration()
