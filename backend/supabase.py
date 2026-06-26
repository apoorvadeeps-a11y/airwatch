import httpx, os
from dotenv import load_dotenv
load_dotenv()

URL = os.getenv("VITE_SUPABASE_URL")
KEY = os.getenv("VITE_SUPABASE_ANON_KEY")

print(f"URL: {URL}")
print(f"KEY: {KEY[:20]}..." if KEY else "KEY: None")

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json"
}

r = httpx.post(
    f"{URL}/rest/v1/rpc/nearest_aqi_station",
    headers=headers,
    json={"user_lat": 19.2183, "user_lng": 72.9781}
)

print(f"Status: {r.status_code}")
print(f"Response: {r.text}")