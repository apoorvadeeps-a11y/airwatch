import os
import asyncio
from dotenv import load_dotenv
import httpx

load_dotenv()

GEMINI_KEYS = [k.strip() for k in os.getenv("GEMINI_API_KEYS", "").split(",") if k.strip()]
GEMINI_MODELS = [
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
]

async def test_gemini():
    payload = {"contents": [{"parts": [{"text": "Hello, how are you?"}]}]}
    
    key = GEMINI_KEYS[0]
    for model in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(url, json=payload, timeout=10)
                print(f"[{model}] Status: {res.status_code}")
                if res.status_code != 200:
                    print(res.text[:100])
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_gemini())
