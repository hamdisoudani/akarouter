import os

log_path = "C:/Users/siham/.gemini/antigravity/brain/8ab03ed2-5cdb-4e26-b30d-75840b764e8a/.system_generated/tasks/task-662.log"
with open(log_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "analytics" in line:
        print(f"{i+1}: {line.strip()}")
