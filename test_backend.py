import httpx
import asyncio
import time

async def test_report():
    print("Testing backend /report route...")
    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(
                "https://airwatch-yb3c.onrender.com/report", 
                data={'text':'smoke', 'lat': 19.268, 'lng': 72.967, 'location': 'Test'}
            )
            print(f"Status: {res.status_code}")
            print(f"Response: {res.text[:200]}")
    except Exception as e:
        print(f"Error: {e}")
    print(f"Time taken: {time.time() - start:.2f}s")

if __name__ == "__main__":
    asyncio.run(test_report())
