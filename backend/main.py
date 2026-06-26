from google import genai
from google.genai import types
from PIL import Image
import io, base64, json
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import httpx, os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("VITE_SUPABASE_ANON_KEY")
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

client_genai = genai.Client(api_key=GEMINI_KEY)


@app.get("/")
def read_root():
    return {"status": "online", "message": "AirWatch API is running. Visit /docs for API info."}


@app.get("/health")
def health():
    return {"status": "ok", "service": "airwatch-backend"}


@app.get("/nearest-station")
async def nearest_station(lat: float, lng: float):
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/nearest_aqi_station",
            headers=HEADERS,
            json={"user_lat": lat, "user_lng": lng}
        )
    data = res.json()
    return data[0] if data else {"error": "No station found"}


@app.post("/report")
async def submit_report(
    text: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    location: str = Form("Unknown location"),
    photo: UploadFile = File(None),
):
    async with httpx.AsyncClient() as client:
        station_res = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/nearest_aqi_station",
            headers=HEADERS,
            json={"user_lat": lat, "user_lng": lng}
        )
    stations = station_res.json()
    station = stations[0] if stations else None

    station_context = (
        f"Nearest government station: {station['station_name']} "
        f"({station['city']}, {station['state']}) — "
        f"AQI {station['aqi']}, dominant pollutant: {station['dominant_pollutant']}, "
        f"distance: {round(station['distance_km'], 1)}km away."
        if station else "No nearby government station data available."
    )

    if DEV_MODE:
        analysis = {
            "severity": 3,
            "pollutant_type": "PM2.5",
            "visual_indicators": "DEV MODE - no real analysis",
            "government_consistency": "Consistent",
            "advisory": "Air quality is moderate. Sensitive groups should limit outdoor activity.",
            "summary": f"User reported pollution near {location}. Nearest government station {station['station_name'] if station else 'unknown'} shows AQI {station['aqi'] if station else 'N/A'}."
        }
    else:
        prompt = f"""You are an air quality analyst for an Indian neighbourhood monitoring app.

USER REPORT:
Location: {location} (lat: {lat}, lng: {lng})
Description: {text}

GOVERNMENT DATA:
{station_context}

{"A photo has been provided. Analyze visible pollution indicators." if photo else "No photo provided."}

Based on all available information, respond in this exact JSON format:
{{
  "severity": <integer 1-5>,
  "pollutant_type": "<PM2.5|PM10|NO2|SO2|CO|Ozone|Mixed|Unknown>",
  "visual_indicators": "<what you see in photo, or 'No photo' if none>",
  "government_consistency": "<Consistent|Higher than official|Lower than official|No data>",
  "advisory": "<one sentence plain English advice for residents>",
  "summary": "<2 sentence analysis fusing photo + user report + government data>"
}}
Respond with JSON only. No markdown, no explanation."""

        try:
            if photo:
                photo_bytes = await photo.read()
                image_part = types.Part.from_bytes(data=photo_bytes, mime_type=photo.content_type)
                response = client_genai.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=[prompt, image_part]
                )
            else:
                response = client_genai.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt
                )
            try:
                raw = response.text.strip()
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                analysis = json.loads(raw.strip())
            except Exception as e:
                print("Gemini parse failed:", e)
                analysis = {"raw": response.text, "severity": 3}
        except Exception as e:
            print("Gemini call failed:", e)
            analysis = {"severity": 3, "error": str(e), "advisory": "Analysis unavailable."}

    severity = analysis.get("severity", 3)

    async with httpx.AsyncClient() as client:
        await client.post(
            f"{SUPABASE_URL}/rest/v1/reports",
            headers={**HEADERS, "Prefer": "return=representation"},
            json={
                "text": text,
                "location": location,
                "lat": lat,
                "lng": lng,
                "photo_url": None,
                "gemini_analysis": json.dumps(analysis),
                "severity": severity,
            }
        )

    return {
        "success": True,
        "analysis": analysis,
        "station": station,
    }
@app.get("/stations")
async def get_stations():
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{SUPABASE_URL}/rest/v1/aqi_stations?select=station_name,city,state,lat,lng,aqi,dominant_pollutant&lat=not.is.null&limit=500",
            headers=HEADERS
        )
    return res.json()


@app.get("/reports/nearby")
async def get_nearby_reports(lat: float, lng: float, radius_km: float = 10):
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{SUPABASE_URL}/rest/v1/reports?select=*&order=timestamp.desc&limit=50",
            headers=HEADERS
        )
    all_reports = res.json()
    import math
    def dist(la, lo):
        return math.sqrt((la - lat)**2 + (lo - lng)**2) * 111
    nearby = [r for r in all_reports if r.get("lat") and r.get("lng") and dist(r["lat"], r["lng"]) <= radius_km]
    return nearby