import json

def find_keys():
    with open("scratch/schema_summary.json", encoding="utf-8") as f:
        schema = json.load(f)
        
    all_keys = []
    def traverse(d, path):
        if isinstance(d, dict):
            for k, v in d.items():
                if k == 'properties' and isinstance(v, dict):
                    for pk in v.keys():
                        if 'bind' in pk.lower():
                            all_keys.append(f"{path}.{pk}")
                traverse(v, f"{path}.{k}" if k != 'properties' else path)
                
    traverse(schema, 'root')
    print("Found keys containing 'bind':")
    for key in sorted(list(set(all_keys))):
        print(key)

if __name__ == "__main__":
    find_keys()
