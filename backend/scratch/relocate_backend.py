import os
import shutil
import sys

root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
backend_dir = os.path.join(root, "backend")

print(f"Root dir: {root}")
print(f"Target backend dir: {backend_dir}")

# Create backend directory
os.makedirs(backend_dir, exist_ok=True)

# List of folders to move
folders = ["app", "supabase", "scratch"]

# List of files to move
files = [
    ".env",
    ".env.example",
    "requirements.txt",
    "pyproject.toml",
    "Dockerfile",
    "Dockerfile.app",
    "railway.toml",
    "render.yaml",
    "token.json",
    "current_token.sh",
    "refresh_and_update.py",
    "refresh_and_update.sh",
    "refresh_token.py",
    "server.py",
    "start.sh",
    "watchdog.sh",
    "generate_device_code.py",
    "nous_openai_proxy.py",
    "nous_proxy.py",
    "token_proxy.py",
    "stress_bypass.py",
    "stress_test.py",
    "stress_test2.py",
    "stress_test3.py"
]

# Move directories
for folder in folders:
    src = os.path.join(root, folder)
    dst = os.path.join(backend_dir, folder)
    if os.path.exists(src):
        # If running from scratch/, the script scratch/relocate_backend.py is inside scratch
        # shutil.move might lock or fail if scratch is active. Let's handle 'scratch' carefully.
        # We can copy files or move them.
        try:
            print(f"Moving folder: {src} -> {dst}")
            shutil.move(src, dst)
        except Exception as e:
            print(f"Failed to move folder {folder}: {e}")
            if folder == "scratch":
                # Fallback: create destination scratch and move all files except this script
                os.makedirs(dst, exist_ok=True)
                for item in os.listdir(src):
                    if item != "relocate_backend.py":
                        item_src = os.path.join(src, item)
                        item_dst = os.path.join(dst, item)
                        try:
                            shutil.move(item_src, item_dst)
                            print(f"  Moved scratch item: {item}")
                        except Exception as ex:
                            print(f"  Failed to move scratch item {item}: {ex}")

# Move files
for file in files:
    src = os.path.join(root, file)
    dst = os.path.join(backend_dir, file)
    if os.path.exists(src) and not os.path.isdir(src):
        try:
            print(f"Moving file: {src} -> {dst}")
            shutil.move(src, dst)
        except Exception as e:
            print(f"Failed to move file {file}: {e}")

# Finally, try to move this script itself to backend/scratch/relocate_backend.py
script_src = os.path.abspath(__file__)
script_dst = os.path.join(backend_dir, "scratch", "relocate_backend.py")
try:
    print(f"Moving script itself: {script_src} -> {script_dst}")
    shutil.move(script_src, script_dst)
except Exception as e:
    print(f"Could not move script itself at the end: {e}")

print("Relocation process finished.")
