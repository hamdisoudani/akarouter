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
        print("Connecting to database...")
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        # 1. Add pricing columns if they don't exist
        print("Adding pricing columns to 'model_mapping' table...")
        cur.execute("""
            ALTER TABLE model_mapping 
            ADD COLUMN IF NOT EXISTS input_cost_per_million DOUBLE PRECISION DEFAULT 0.10,
            ADD COLUMN IF NOT EXISTS output_cost_per_million DOUBLE PRECISION DEFAULT 0.30;
        """)
        conn.commit()
        print("Columns added successfully!")
        
        # 2. Update existing rows with default model-specific pricing
        print("Updating pricing for 'akarouter-pro'...")
        cur.execute("""
            UPDATE model_mapping 
            SET input_cost_per_million = 0.20,
                output_cost_per_million = 0.80
            WHERE alias = 'akarouter-pro';
        """)
        
        print("Updating pricing for 'akarouter-flash'...")
        cur.execute("""
            UPDATE model_mapping 
            SET input_cost_per_million = 0.05,
                output_cost_per_million = 0.15
            WHERE alias = 'akarouter-flash';
        """)
        
        print("Updating pricing for any other models to fallback defaults...")
        cur.execute("""
            UPDATE model_mapping 
            SET input_cost_per_million = COALESCE(input_cost_per_million, 0.10),
                output_cost_per_million = COALESCE(output_cost_per_million, 0.30)
            WHERE alias NOT IN ('akarouter-pro', 'akarouter-flash');
        """)
        
        conn.commit()
        print("Model pricing updated successfully!")
        
        # 3. Query rows to verify
        cur.execute("SELECT alias, display_name, input_cost_per_million, output_cost_per_million FROM model_mapping;")
        rows = cur.fetchall()
        print("\nCurrent rows in 'model_mapping':")
        for row in rows:
            print(f"  Alias: {row[0]} | Display Name: {row[1]} | Input Cost/1M: ${row[2]} | Output Cost/1M: ${row[3]}")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Migration failed: {e}")

if __name__ == "__main__":
    run_migration()
