import os
import sys
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from app.core.supabase import get_supabase

def run_test():
    supabase = get_supabase()
    try:
        res = supabase.table("model_mapping").select("*").limit(1).execute()
        if res.data:
            print("Row in model_mapping:")
            for k, v in res.data[0].items():
                print(f"  {k}: {type(v)} = {v}")
        else:
            print("model_mapping table is empty!")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    run_test()
