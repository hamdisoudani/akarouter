import inspect
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

def inspect_daytona():
    try:
        from daytona import Daytona, CreateSandboxFromImageParams, Resources
        
        print("CreateSandboxFromImageParams signature and properties:")
        print(inspect.signature(CreateSandboxFromImageParams))
        for name, value in inspect.getmembers(CreateSandboxFromImageParams):
            if not name.startswith("__"):
                print(f" - {name}")
                
        print("\nDaytona client signature and methods:")
        for name, value in inspect.getmembers(Daytona):
            if not name.startswith("__") and not name.startswith("_"):
                print(f" - {name}: {inspect.signature(value) if callable(value) else type(value)}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_daytona()
