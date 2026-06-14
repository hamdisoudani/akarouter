import sys
try:
    from app.core.daytona import get_daytona_client
    from app.api.hosted_agents import router
    print("Backend modules imported successfully!")
except Exception as e:
    print(f"Import error: {e}", file=sys.stderr)
    sys.exit(1)
