import os
import sys
from dotenv import load_dotenv

# Set python path to backend root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from app.core.supabase import get_supabase

def run():
    supabase = get_supabase()
    model_data = {
        "alias": "akarouter-large",
        "upstream_model": "openrouter/owl-alpha",
        "display_name": "AkaRouter Large",
        "description": "Long-context foundation model (1M tokens) optimized for agentic workloads",
        "is_active": True,
        "capabilities": ["text"],
        "input_cost_per_million": 0.10,
        "output_cost_per_million": 0.40
    }
    
    try:
        # Check if it already exists
        res = supabase.table("model_mapping").select("id").eq("alias", "akarouter-large").execute()
        if res.data:
            print("Model 'akarouter-large' already exists. Updating...")
            update_res = supabase.table("model_mapping").update(model_data).eq("alias", "akarouter-large").execute()
            print("Update result:", update_res.data)
        else:
            print("Model 'akarouter-large' does not exist. Inserting...")
            insert_res = supabase.table("model_mapping").insert(model_data).execute()
            print("Insert result:", insert_res.data)
            
        print("Success! Checked model mapping in DB.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    run()
