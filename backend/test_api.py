import asyncio
import httpx

async def main():
    async with httpx.AsyncClient() as client:
        data = {
            "text": "Thick smog and burning smell",
            "lat": "19.0",
            "lng": "72.8",
            "location": "Mumbai",
            "email": "apoorvadeeps@gmail.com"
        }
        try:
            res = await client.post("http://localhost:8000/report", data=data, timeout=120)
            print("Status:", res.status_code)
            print("Response:", res.text)
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
