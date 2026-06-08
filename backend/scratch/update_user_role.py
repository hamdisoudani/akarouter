import os
from dotenv import load_dotenv
from supabase import create_client

# Load environment variables
load_dotenv()

supabase_url = os.environ.get("AKAROUTER_SUPABASE_URL")
service_role_key = os.environ.get("AKAROUTER_SUPABASE_SERVICE_ROLE_KEY")

if not supabase_url or not service_role_key:
    print("Error: Supabase environment variables not found.")
    exit(1)

supabase = create_client(supabase_url, service_role_key)

email_to_update = "hamdisoudani.freelancer@gmail.com"

print(f"Fetching account with email: {email_to_update}")
res = supabase.table("accounts").select("*").eq("email", email_to_update).execute()

if not res.data:
    print(f"No account found in accounts table with email: {email_to_update}")
    # Let's list some accounts to see what's in there
    all_res = supabase.table("accounts").select("*").limit(5).execute()
    print("Existing accounts sample:")
    print(all_res.data)
else:
    account = res.data[0]
    print("Current Account data:")
    print(account)
    
    # Let's verify if 'role' column is present
    if "role" not in account:
        print("Warning: 'role' column is not present in the accounts table. Checking other tables/columns...")
    
    # Try updating the role to admin
    print("Updating role to 'admin'...")
    try:
        update_res = supabase.table("accounts").update({"role": "admin"}).eq("email", email_to_update).execute()
        print("Success! Updated data:")
        print(update_res.data)
    except Exception as e:
        print(f"Failed to update role: {e}")
