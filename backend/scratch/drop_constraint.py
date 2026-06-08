import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("AKAROUTER_SUPABASE_DB_URL")

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    # Query constraints on accounts table
    cur.execute("""
        SELECT conname, pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE conrelid = 'accounts'::regclass;
    """)
    print("Constraints on 'accounts' table:")
    constraints = cur.fetchall()
    for con in constraints:
        print(f"Name: {con[0]} | Def: {con[1]}")
        
    # Find the check constraint for tier
    tier_con = [con[0] for con in constraints if "tier" in con[1] and "CHECK" in con[1]]
    if tier_con:
        con_name = tier_con[0]
        print(f"\nDropping constraint: {con_name}")
        cur.execute(f"ALTER TABLE accounts DROP CONSTRAINT {con_name};")
        conn.commit()
        print("Constraint dropped successfully!")
    else:
        print("\nNo check constraint found on 'tier'.")
        
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
