import base64, json, os, re, io, hashlib, time, asyncio
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import httpx
import math
from PIL import Image

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")
GEMINI_KEYS = [k.strip() for k in os.getenv("GEMINI_API_KEYS", os.getenv("GEMINI_API_KEY", "")).split(",") if k.strip()]
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

# --- Rate-limit & caching helpers ---

# Models to try in order (best free-tier limits first)
GEMINI_MODELS = [
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-8b",
]

class KeyUsageTracker:
    """Track per-key RPM and RPD to avoid hitting limits."""
    def __init__(self, keys, rpm_limit=10, rpd_limit=1400):
        self.keys = keys
        self.rpm_limit = rpm_limit
        self.rpd_limit = rpd_limit
        self.minute_usage = {k: [] for k in keys}  # timestamps of requests
        self.day_usage = {k: [] for k in keys}
    
    def get_best_key(self) -> str | None:
        """Return the key with the most remaining quota, or None if all exhausted."""
        now = time.time()
        best_key, best_remaining = None, -1
        for key in self.keys:
            # Prune old timestamps
            self.minute_usage[key] = [t for t in self.minute_usage[key] if now - t < 60]
            self.day_usage[key] = [t for t in self.day_usage[key] if now - t < 86400]
            rpm_remaining = self.rpm_limit - len(self.minute_usage[key])
            rpd_remaining = self.rpd_limit - len(self.day_usage[key])
            remaining = min(rpm_remaining, rpd_remaining)
            if remaining > best_remaining:
                best_key, best_remaining = key, remaining
        return best_key if best_remaining > 0 else None
    
    def record_usage(self, key):
        now = time.time()
        self.minute_usage[key].append(now)
        self.day_usage[key].append(now)

_key_tracker = KeyUsageTracker(GEMINI_KEYS)

class TokenBucket:
    def __init__(self, rate_per_minute):
        self.rate = rate_per_minute / 60.0  # tokens per second
        self.tokens = rate_per_minute
        self.max_tokens = rate_per_minute
        self.last_refill = time.monotonic()
        self._lock = None
    
    async def acquire(self, timeout=120):
        if self._lock is None:
            self._lock = asyncio.Lock()
        deadline = time.monotonic() + timeout
        while True:
            async with self._lock:
                now = time.monotonic()
                self.tokens = min(self.max_tokens, self.tokens + (now - self.last_refill) * self.rate)
                self.last_refill = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return True
            if time.monotonic() > deadline:
                return False  # timed out -> use local fallback
            await asyncio.sleep(1.0)

_rate_limiter = TokenBucket(rate_per_minute=8)  # conservative for free tier
_gemini_semaphore = asyncio.Semaphore(3)

# Simple in-memory cache: hash(prompt_key) -> {response, timestamp}
_response_cache = {}
CACHE_TTL_SECONDS = 3600  # 1 hour


def _cache_key(text: str, lat: float, lng: float) -> str:
    """Create a cache key from the report text and approximate location (rounded to ~1km)."""
    rounded_lat = round(lat, 2)
    rounded_lng = round(lng, 2)
    normalized_text = re.sub(r'\s+', ' ', text.strip().lower())
    raw = f"{normalized_text}|{rounded_lat}|{rounded_lng}"
    return hashlib.md5(raw.encode()).hexdigest()


def _get_cached(key: str):
    entry = _response_cache.get(key)
    if entry and (time.time() - entry["ts"]) < CACHE_TTL_SECONDS:
        print(f"Cache HIT for key {key[:8]}...")
        return entry["data"]
    return None


def _set_cached(key: str, data: dict):
    # Keep cache bounded (max 200 entries)
    if len(_response_cache) > 200:
        oldest_key = min(_response_cache, key=lambda k: _response_cache[k]["ts"])
        del _response_cache[oldest_key]
    _response_cache[key] = {"data": data, "ts": time.time()}


# --- Image compression ---

def compress_image(photo_bytes: bytes, mime_type: str, max_size_px: int = 800, quality: int = 70) -> tuple[bytes, str]:
    """Compress image to reduce token usage. Returns (compressed_bytes, mime_type)."""
    try:
        img = Image.open(io.BytesIO(photo_bytes))

        # Convert RGBA/palette to RGB for JPEG
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        # Resize if too large (preserve aspect ratio)
        w, h = img.size
        if max(w, h) > max_size_px:
            ratio = max_size_px / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        compressed = buf.getvalue()

        original_kb = len(photo_bytes) / 1024
        compressed_kb = len(compressed) / 1024
        print(f"Image compressed: {original_kb:.0f}KB -> {compressed_kb:.0f}KB ({img.size[0]}x{img.size[1]})")

        return compressed, "image/jpeg"
    except Exception as e:
        print(f"Image compression failed ({e}), using original")
        return photo_bytes, mime_type or "image/jpeg"


# --- Gemini API with retry + model fallback ---

async def call_gemini(prompt: str, photo_bytes=None, mime_type=None):
    """Call Gemini with automatic retry, backoff, and model fallback."""
    
    got_slot = await _rate_limiter.acquire(timeout=60)
    if not got_slot:
        raise Exception("Rate limit queue timeout — too many concurrent requests")

    async with _gemini_semaphore:
        key = _key_tracker.get_best_key()
        if not key:
            raise Exception("All API keys exhausted for this period")
        
        _key_tracker.record_usage(key)

        parts = [{"text": prompt}]
        if photo_bytes:
            parts.append({
                "inline_data": {
                    "mime_type": mime_type or "image/jpeg",
                    "data": base64.b64encode(photo_bytes).decode()
                }
            })
        payload = {"contents": [{"parts": parts}]}

        last_error = None

        for model in GEMINI_MODELS:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

        # Try up to 2 attempts per model (with backoff)
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=90) as client:
                    res = await client.post(url, json=payload)
                    data = res.json()
                    print(f"[{model}] attempt {attempt+1} — status {res.status_code}")

                    if res.status_code == 429:
                        # Rate limited — extract retry delay if available
                        error_msg = data.get("error", {}).get("message", "")
                        retry_match = re.search(r'retry in (\d+\.?\d*)', error_msg, re.IGNORECASE)
                        wait_time = float(retry_match.group(1)) if retry_match else (15 * (attempt + 1))
                        # Cap wait to 45 seconds max
                        wait_time = min(wait_time, 45)
                        print(f"[{model}] Rate limited. Waiting {wait_time:.0f}s before {'retry' if attempt == 0 else 'next model'}...")

                        if attempt == 0:
                            await asyncio.sleep(wait_time)
                            continue  # retry same model
                        else:
                            last_error = f"429 rate limit on {model}"
                            break  # try next model

                    if res.status_code != 200 or "error" in data:
                        error_detail = data.get("error", {})
                        last_error = f"{error_detail.get('code', res.status_code)}: {error_detail.get('message', 'Unknown error')}"
                        print(f"[{model}] Error: {last_error}")
                        break  # try next model

                    # Success!
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    print(f"[{model}] Success! Response: {text[:200]}")
                    return text

            except httpx.TimeoutException:
                last_error = f"Timeout on {model}"
                print(f"[{model}] Timeout on attempt {attempt+1}")
                if attempt == 0:
                    await asyncio.sleep(5)
                    continue
                break
            except Exception as e:
                last_error = str(e)
                print(f"[{model}] Exception: {e}")
                break

    raise Exception(f"All Gemini models exhausted. Last error: {last_error}")


# --- Smart local fallback (no API needed) ---

def local_fallback_analysis(text: str, location: str, station: dict = None) -> dict:
    """Keyword-based analysis when Gemini is completely unavailable."""
    text_lower = text.lower()

    # Keyword -> (severity_boost, pollutant_type)
    keywords = {
        "smoke": (2, "PM2.5"), "black smoke": (3, "PM2.5"),
        "burning": (2, "PM2.5"), "fire": (3, "PM2.5"),
        "garbage": (2, "Mixed"), "dump": (2, "Mixed"), "waste": (2, "Mixed"),
        "dust": (1, "PM10"), "construction": (1, "PM10"),
        "haze": (2, "PM2.5"), "smog": (3, "Mixed"), "fog": (1, "PM2.5"),
        "factory": (2, "SO2"), "industrial": (2, "SO2"), "chimney": (2, "SO2"),
        "vehicle": (1, "NO2"), "traffic": (1, "NO2"), "exhaust": (2, "NO2"),
        "chemical": (3, "Mixed"), "fumes": (2, "Mixed"), "smell": (1, "Mixed"),
        "difficult to breathe": (3, "PM2.5"), "breathing": (2, "PM2.5"),
        "cough": (2, "PM2.5"), "eye": (1, "Mixed"), "irritation": (1, "Mixed"),
        "visible": (1, "PM2.5"), "thick": (2, "PM2.5"),
    }

    severity_scores = []
    detected_pollutants = []
    matched_keywords = []

    for keyword, (boost, pollutant) in keywords.items():
        if keyword in text_lower:
            severity_scores.append(boost)
            detected_pollutants.append(pollutant)
            matched_keywords.append(keyword)

    # Base severity from keyword matches
    if severity_scores:
        severity = min(5, max(1, round(sum(severity_scores) / len(severity_scores)) + 1))
    else:
        severity = 2  # Default moderate if no keywords match

    # Cross-reference with government station data
    consistency = "No data"
    if station and station.get("aqi"):
        station_aqi = station["aqi"]
        if station_aqi > 200:
            severity = max(severity, 4)
            consistency = "Consistent" if severity >= 4 else "Lower than official"
        elif station_aqi > 100:
            consistency = "Consistent" if 2 <= severity <= 4 else "Higher than official"
        else:
            consistency = "Consistent" if severity <= 2 else "Higher than official"

    # Determine dominant pollutant
    if detected_pollutants:
        from collections import Counter
        pollutant = Counter(detected_pollutants).most_common(1)[0][0]
    else:
        pollutant = station.get("dominant_pollutant", "Unknown") if station else "Unknown"

    # Build advisory
    advisories = {
        1: "Air quality appears acceptable. Enjoy outdoor activities normally.",
        2: "Air quality is moderate. Unusually sensitive people should consider reducing prolonged outdoor exertion.",
        3: "Air quality is unhealthy for sensitive groups. Children, elderly, and those with respiratory conditions should limit outdoor activity.",
        4: "Air quality is hazardous. Everyone should reduce outdoor activity. Wear N95 masks if going outside.",
        5: "Emergency-level pollution detected. Stay indoors, close windows, and use air purifiers if available.",
    }

    station_info = ""
    if station:
        station_info = f" Nearest monitoring station ({station.get('station_name', 'unknown')}) reports AQI {station.get('aqi', 'N/A')} with {station.get('dominant_pollutant', 'unknown')} as dominant pollutant."

    summary = (
        f"Citizen report near {location} describes {', '.join(matched_keywords[:3]) if matched_keywords else 'general air quality concerns'}. "
        f"Estimated severity: {severity}/5 based on report keywords.{station_info}"
    )

    return {
        "severity": severity,
        "pollutant_type": pollutant,
        "visual_indicators": "Analysis based on text description (AI temporarily unavailable)",
        "government_consistency": consistency,
        "advisory": advisories.get(severity, advisories[3]),
        "summary": summary,
        "analysis_mode": "local_fallback",
        "health_impact": "Temporary fallback active. Specific health impacts are estimated based on general pollutant categories.",
        "precautions": ["Avoid prolonged outdoor exertion", "Wear a mask if sensitive"],
        "measures": ["Report to local authorities", "Monitor AQI updates"],
        "possible_sources": ["Based on general urban pollution (AI analysis unavailable)"]
    }


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


@app.get("/hotspots")
async def get_hotspots():
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{SUPABASE_URL}/rest/v1/reports?select=*&severity=gte.3&order=timestamp.desc&limit=100",
                headers=HEADERS
            )
        reports = res.json()

        hotspots = []
        used = set()

        for i, r in enumerate(reports):
            if i in used:
                continue
            cluster = [r]
            used.add(i)

            for j, r2 in enumerate(reports):
                if j in used:
                    continue
                dlat = abs(r["lat"] - r2["lat"]) * 111
                dlng = abs(r["lng"] - r2["lng"]) * 111
                dist = (dlat**2 + dlng**2) ** 0.5

                if dist <= 1.5:
                    cluster.append(r2)
                    used.add(j)

            if len(cluster) >= 2:
                avg_lat = sum(c["lat"] for c in cluster) / len(cluster)
                avg_lng = sum(c["lng"] for c in cluster) / len(cluster)
                max_severity = max(c["severity"] for c in cluster)

                hotspots.append({
                    "lat": avg_lat,
                    "lng": avg_lng,
                    "report_count": len(cluster),
                    "max_severity": max_severity,
                    "pollution_type": cluster[0]["gemini_analysis"].split(".")[0] if cluster[0].get("gemini_analysis") else "Unknown",
                    "reports": cluster
                })

        return {"hotspots": hotspots}
    except Exception as e:
        return {"error": str(e), "hotspots": []}


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

    # --- Check cache first ---
    cache_key = _cache_key(text, lat, lng)
    cached = _get_cached(cache_key)
    if cached:
        analysis = cached
        print(f"Using cached analysis for report")
    elif DEV_MODE:
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

{"A photo has been provided. Carefully analyze all visible pollution indicators including smoke color/density, haze levels, sky clarity, visible particulate matter, industrial emissions, garbage burning, and any environmental damage." if photo else "No photo provided."}

Based on all available information, respond in this exact JSON format:
{{
  "severity": <integer 1-5>,
  "pollutant_type": "<PM2.5|PM10|NO2|SO2|CO|Ozone|Mixed|Unknown>",
  "visual_indicators": "<detailed description of what you observe in the photo, or 'No photo' if none>",
  "government_consistency": "<Consistent|Higher than official|Lower than official|No data>",
  "summary": "<2 sentence analysis fusing photo + user report + government data>",
  "possible_sources": [
    "<source 1: e.g., 'Open garbage burning within 500m'>",
    "<source 2: e.g., 'Industrial emissions from nearby factory'>"
  ],
  "health_impact": "<paragraph on health effects for this pollution level>",
  "precautions": [
    "<precaution 1: e.g., 'Wear N95 mask when outdoors'>",
    "<precaution 2: e.g., 'Keep windows closed'>",
    "<precaution 3>"
  ],
  "measures": [
    "<measure 1: e.g., 'Report to local municipal corporation'>",
    "<measure 2: e.g., 'Install HEPA air purifier indoors'>",
    "<measure 3>"
  ],
  "advisory": "<one sentence plain English advice for residents>"
}}
Respond with JSON only. No markdown, no explanation."""

        try:
            photo_bytes = None
            mime_type = None
            if photo:
                photo_bytes = await photo.read()
                mime_type = photo.content_type
                # Compress image to save tokens
                photo_bytes, mime_type = compress_image(photo_bytes, mime_type)

            raw = await call_gemini(prompt, photo_bytes, mime_type)

            # Robust JSON extraction: try multiple strategies
            cleaned = raw.strip()
            # Strip markdown code fences
            if "```" in cleaned:
                match = re.search(r'```(?:json)?\s*([\s\S]*?)```', cleaned)
                if match:
                    cleaned = match.group(1).strip()
            # Try direct parse
            try:
                analysis = json.loads(cleaned)
            except json.JSONDecodeError:
                # Try to find JSON object in the text
                json_match = re.search(r'\{[\s\S]*\}', cleaned)
                if json_match:
                    analysis = json.loads(json_match.group())
                else:
                    raise ValueError(f"Could not extract JSON from Gemini response: {cleaned[:200]}")

            # Cache the successful response
            _set_cached(cache_key, analysis)

        except Exception as e:
            print(f"Gemini call failed: {type(e).__name__}: {e}")
            print(f"Falling back to local keyword analysis...")
            # Smart local fallback instead of generic error
            analysis = local_fallback_analysis(text, location, station)

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

    def dist(la, lo):
        return math.sqrt((la - lat)**2 + (lo - lng)**2) * 111

    nearby = [r for r in all_reports if r.get("lat") and r.get("lng") and dist(r["lat"], r["lng"]) <= radius_km]
    return nearby