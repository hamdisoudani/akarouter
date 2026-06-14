import sys
import os
import json

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

def inspect_field():
    try:
        from daytona import CreateSandboxFromImageParams
        
        # Print the Pydantic field info
        field = CreateSandboxFromImageParams.model_fields.get("auto_stop_interval")
        if field:
            print("Field details:")
            print(f" - default: {field.default}")
            print(f" - annotation: {field.annotation}")
            print(f" - description: {field.description if hasattr(field, 'description') else None}")
            print(f" - json_schema_extra: {field.json_schema_extra}")
            
        # Or print the whole JSON schema for the class
        schema = CreateSandboxFromImageParams.model_json_schema()
        properties = schema.get("properties", {})
        auto_stop = properties.get("auto_stop_interval", {})
        print("\nJSON Schema for auto_stop_interval:")
        print(json.dumps(auto_stop, indent=2))
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_field()
