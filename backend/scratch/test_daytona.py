from daytona import Image
import inspect

print("base:")
try:
    print(inspect.signature(Image.base))
except Exception as e:
    print(e)

print("\nfrom_dockerfile:")
try:
    print(inspect.signature(Image.from_dockerfile))
except Exception as e:
    print(e)
