import asyncio
import httpx
import json

async def main():
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": 19.0,
                "longitude": 72.8,
                "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code",
                "timezone": "auto"
            }
        )
        print("Status:", res.status_code)
        print("Data:", json.dumps(res.json(), indent=2))

if __name__ == "__main__":
    asyncio.run(main())
