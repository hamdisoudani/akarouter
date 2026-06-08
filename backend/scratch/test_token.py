import httpx

token = (
    "eyJhbGciOiJFUzI1NiIsImtpZCI6ImIwYmIyY2Y0LTc5ZGQtNDk2NS1hMDgwLTkxZTE1NTY2NWEzOSIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJodHRwczovL2ZsZW91cXJnbHRrb2R1bXJneGx0LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIwOTY3MTQ"
    "xMC1iYjI1LTRhNTctYjExMS1iM2VkMjY5NGJlM2MiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzgwODcxOTYzLC"
    "JpYXQiOjE3ODA4NjgzNjMsImVtYWlsIjoiaGFtZGlzb3VkYW5pLmZyZWVsYW5jZXJAZ21haWwuY29tIiwicGhvbmUiOiIiLC"
    "JhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJnb29nbGUiLCJwcm92aWRlcnMiOlsiZ29vZ2xlIl19LCJ1c2VyX21ldGFkYX"
    "RhIjp7ImF2YXRhcl91cmwiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NMQ0tWa0dnTklDZ"
    "C1LeVM4eEJIVjNieWsxMmd0VWFxT05BSklnNllsU3BzQ184Wmc9czk2LWMiLCJlbWFpbCI6ImhhbWRpc291ZGFuaS5mcmVlb"
    "GFuY2VyQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmdWxsX25hbWUiOiJIYW1kaSBTb3VkYW5pIiwiaXNz"
    "IjoiaHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29tIiwibmFtZSI6IkhhbWRpIFNvdWRhbmkiLCJwaG9uZV92ZXJpZmllZCI"
    "fZmFsc2UsInBpY3R1cmUiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NMQ0tWa0dnTklCZC"
    "1LeVM4eEJIVjNieWsxMmd0VWFxT05BSklnNllsU3BzQ184Wmc9czk2LWMiLCJwcm92aWRlcl9idCI6IjEwMTUzMDQ5OTM0M"
    "zA5ODA1NzY0MCIsInN1YiI6IjEwMTUzMDQ5OTM0MzA5ODA1NzY0MCJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6"
    "ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6Im9hdXRoIiwidGltZXN0YW1wIjoxNzgwODY4MzYzfV0sInNlc3Npb25faWQiOiJ"
    "iZTdkODVhMS0wOWYyLTRhYjAtYTcwNy00NjIxYTFjNGVjZTciLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ"
    ".RafLEHlxOMXbK5ZlekjsljCt6f5FQ5xKMJEXPPL12k6-bjOXG-AZixpAfjIYFRbc9K2dWOiTJjDv6GyukwxDSw"
)

headers = {"Authorization": f"Bearer {token}"}
resp = httpx.get("http://127.0.0.1:8000/user/me", headers=headers)
print("Status:", resp.status_code)
print("Response:", resp.json())
