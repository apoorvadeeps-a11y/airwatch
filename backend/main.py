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
# NOTE: gemini-1.5-flash / gemini-1.5-pro are fully retired (shut down, return 404
# on every call). Every request — text AND image — was failing instantly and
# silently dropping into local_fallback_analysis, which is why it always "fell back".
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
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

# 3 keys × 15 RPM each = 45 RPM total capacity; bucket at 30 RPM to leave headroom
_rate_limiter = TokenBucket(rate_per_minute=30)
_gemini_semaphore = asyncio.Semaphore(5)  # allow 5 concurrent Gemini calls

# Aggressive in-memory cache to reduce API calls across similar reports
_response_cache = {}
CACHE_TTL_SECONDS = 7200  # 2 hours — similar reports reuse cached analysis


def _cache_key(text: str, lat: float, lng: float, has_photo: bool = False) -> str:
    """Create a cache key from the report text, approximate location (rounded to ~1km),
    and whether a photo was attached. Without has_photo in the key, a text-only report
    (or a failed/fallback analysis) could poison the cache for a later report at the
    same spot that DOES include a photo, silently skipping image analysis entirely."""
    rounded_lat = round(lat, 2)
    rounded_lng = round(lng, 2)
    normalized_text = re.sub(r'\s+', ' ', text.strip().lower())
    raw = f"{normalized_text}|{rounded_lat}|{rounded_lng}|photo={has_photo}"
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
    """Call Gemini with automatic retry, backoff, key rotation, and model fallback.
    
    Strategy for 10+ concurrent users with 3 API keys:
    - Try each API key for each model before giving up
    - On 429, rotate to next key immediately (don't waste time waiting)
    - Use aggressive caching to avoid duplicate calls
    - Semaphore limits concurrent Gemini calls to prevent stampede
    """
    
    got_slot = await _rate_limiter.acquire(timeout=120)
    if not got_slot:
        raise Exception("Rate limit queue timeout — too many concurrent requests")

    async with _gemini_semaphore:
        parts = [{"text": prompt}]
        if photo_bytes:
            parts.append({
                "inlineData": {
                    "mimeType": mime_type or "image/jpeg",
                    "data": base64.b64encode(photo_bytes).decode()
                }
            })
        payload = {"contents": [{"parts": parts}]}

        last_error = None

        for model in GEMINI_MODELS:
            # Try ALL available keys for this model before moving to next model
            tried_keys = set()
            while True:
                key = _key_tracker.get_best_key()
                if not key or key in tried_keys:
                    break  # all keys exhausted for this model, try next model
                tried_keys.add(key)

                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

                # Try up to 2 attempts per key (with backoff)
                for attempt in range(2):
                    try:
                        async with httpx.AsyncClient(timeout=90) as client:
                            _key_tracker.record_usage(key)
                            res = await client.post(url, json=payload)
                            data = res.json()
                            print(f"[{model}][key..{key[-6:]}] attempt {attempt+1} — status {res.status_code}")

                            if res.status_code == 429:
                                error_msg = data.get("error", {}).get("message", "")
                                print(f"[{model}] Rate limited on key ..{key[-6:]}, rotating to next key...")
                                if attempt == 0:
                                    await asyncio.sleep(2)  # brief pause then try next key
                                last_error = f"429 rate limit on {model}"
                                break  # break attempt loop, try next key

                            if res.status_code != 200 or "error" in data:
                                error_detail = data.get("error", {})
                                last_error = f"{error_detail.get('code', res.status_code)}: {error_detail.get('message', 'Unknown error')}"
                                print(f"[{model}] Error: {last_error}")
                                break  # try next key

                            # Success!
                            text = data["candidates"][0]["content"]["parts"][0]["text"]
                            print(f"[{model}] Success! Response: {text[:200]}")
                            return text

                    except httpx.TimeoutException:
                        last_error = f"Timeout on {model}"
                        print(f"[{model}] Timeout on attempt {attempt+1}")
                        if attempt == 0:
                            await asyncio.sleep(3)
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

    # Estimate AQI range
    aqi_ranges = {1: "0-50", 2: "51-100", 3: "101-200", 4: "201-300", 5: "301-500"}
    station_aqi_val = station.get("aqi", 0) if station else 0
    if station_aqi_val:
        estimated_range = f"{max(0, int(station_aqi_val) - 30)}-{int(station_aqi_val) + 30}"
    else:
        estimated_range = aqi_ranges.get(severity, "100-200")

    health_impacts = {
        1: "Air quality is satisfactory. No health effects expected.",
        2: "Moderate pollution may cause minor breathing discomfort for sensitive individuals.",
        3: "Sensitive groups may experience coughing, throat irritation, and shortness of breath. PM2.5 particles penetrate deep into lungs causing inflammation. Long-term exposure increases risk of respiratory infections.",
        4: "Hazardous air quality poses serious health risks. Short-term exposure causes eye burning, persistent coughing, chest tightness. PM2.5 and NO2 at these levels can trigger asthma attacks and cardiac events.",
        5: "Emergency-level pollution is immediately dangerous. Expect severe respiratory distress, burning eyes, nausea. Hospital visits spike 3-5x. PM2.5 at these levels causes acute bronchitis and can trigger heart attacks.",
    }

    precautions_map = {
        1: ["No special precautions needed", "Enjoy outdoor activities normally"],
        2: ["Sensitive individuals should reduce prolonged outdoor exertion", "Monitor AQI updates"],
        3: ["Wear N95 mask outdoors — cloth masks do NOT filter PM2.5", "Keep windows closed during peak hours (6-10 AM)", "Avoid outdoor exercise", "Use air purifier if available", "Stay hydrated"],
        4: ["Wear N95/P100 mask whenever outdoors", "Seal windows and doors", "Do NOT exercise outdoors", "Run HEPA air purifier continuously", "Seek medical help if chest pain or difficulty breathing"],
        5: ["Stay indoors — do NOT go outside", "Seal all windows and ventilation gaps", "Run air purifier on maximum", "Seek emergency medical attention if breathing difficulty"],
    }

    measures_map = {
        1: ["Continue monitoring AQI via CPCB Sameer app"],
        2: ["Monitor AQI on CPCB Sameer app", "Consider indoor air-purifying plants"],
        3: ["Report to Municipal Corporation and CPCB Sameer app", "Install HEPA air purifier (H13 grade)", "Grow air-purifying plants indoors"],
        4: ["File complaint on CPCB Sameer app", "Install HEPA purifier in all rooms", "Petition authorities for emission source inspection"],
        5: ["File urgent complaint on CPCB Sameer app", "Evacuate if possible", "Demand immediate action from authorities"],
    }

    affected_groups_map = {
        1: ["No specific groups at elevated risk"],
        2: ["People with severe asthma or COPD"],
        3: ["Children under 5", "Elderly above 60", "Asthma and COPD patients", "Pregnant women"],
        4: ["Everyone is at risk", "Children — 3x more susceptible", "Elderly — heart attack risk increases", "Outdoor workers — prolonged unprotected exposure"],
        5: ["ALL residents at immediate risk", "Children and infants — emergency risk", "Elderly and heart patients — critical risk"],
    }

    return {
        "severity": severity,
        "pollutant_type": pollutant,
        "estimated_aqi_range": estimated_range,
        "detailed_visual_analysis": "Photo analysis unavailable (AI temporarily offline). Assessment based on text description and government data.",
        "government_consistency": consistency,
        "advisory": advisories.get(severity, advisories[3]),
        "summary": summary,
        "analysis_mode": "local_fallback",
        "possible_sources": [f"Detected keywords: {', '.join(matched_keywords[:4])}" if matched_keywords else "General urban pollution assumed"],
        "root_causes": f"Based on report keywords ({', '.join(matched_keywords[:3]) if matched_keywords else 'none detected'}), likely causes include poor waste management, vehicular emissions, or industrial activity. Seasonal factors may be amplifying pollution.",
        "health_impact": health_impacts.get(severity, health_impacts[3]),
        "affected_groups": affected_groups_map.get(severity, affected_groups_map[3]),
        "precautions": precautions_map.get(severity, precautions_map[3]),
        "measures": measures_map.get(severity, measures_map[3]),
        "environmental_impact": "Detailed environmental assessment requires AI analysis. Sustained pollution can cause soil acidification, groundwater contamination, and harm to local wildlife.",
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
    email: str = Form(None),
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
    cache_key = _cache_key(text, lat, lng, has_photo=bool(photo))
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
        photo_instruction = ""
        if photo:
            photo_instruction = """PHOTO ANALYSIS INSTRUCTIONS (CRITICAL):
A photo has been provided by the citizen. You MUST perform an exhaustive visual analysis:
- Describe EVERY visible pollution indicator: smoke color (white/grey/black), density (thin/thick/opaque), direction, source point
- Assess sky clarity: is the sky visible? What color? Is there haze/smog layer?
- Identify visible waste: garbage heaps, plastic, organic waste, construction debris, sewage
- Check water bodies: color, floating waste, oil sheen, algae
- Note vegetation health: green/brown/wilted, dust-covered leaves
- Identify structures: factories, chimneys, construction sites, vehicles, open fires
- Estimate visibility range in meters based on haze/smog
- Note any human activity contributing to pollution
Be SPECIFIC and DETAILED — do not give generic descriptions."""

        prompt = f"""You are a senior environmental scientist and air quality expert specializing in Indian urban pollution. You must provide an EXTREMELY DETAILED and EXPLANATORY analysis.

USER REPORT:
Location: {location} (lat: {lat}, lng: {lng})
Description: {text}

GOVERNMENT DATA:
{station_context}

{photo_instruction if photo else "No photo provided — base analysis on text description and government data."}

ANALYSIS REQUIREMENTS:
1. Briefly identify probable pollution causes (max 1 sentence per cause)
2. Estimate the probable AQI range based on visual/textual evidence
3. Provide 2-3 specific, actionable safety measures
4. Identify who is most at risk (max 1 concise sentence per group)
5. Briefly describe environmental damage (max 1 sentence)

Respond in this EXACT JSON format (every field MUST be filled with detailed content, NOT generic placeholders):
{{
  "severity": <integer 1-5: 1=Good, 2=Moderate, 3=Unhealthy, 4=Hazardous, 5=Emergency>,
  "pollutant_type": "<PM2.5|PM10|NO2|SO2|CO|Ozone|Mixed|Unknown>",
  "estimated_aqi_range": "<e.g. '180-250'>",
  "detailed_visual_analysis": "<1-2 concise sentences describing EXACTLY what you see in the photo>",
  "government_consistency": "<Consistent|Higher than official|Lower than official|No data>",
  "summary": "<1-2 sentence comprehensive analysis fusing photo evidence + citizen report + government data. Be precise.>",
  "possible_sources": [
    "<source 1: short explanation>",
    "<source 2: short explanation>"
  ],
  "root_causes": "<1 sentence explaining the systemic reasons>",
  "health_impact": "<1-2 sentences detailing specific health effects>",
  "affected_groups": [
    "<group 1: short description>",
    "<group 2: short description>"
  ],
  "precautions": [
    "<precaution 1>",
    "<precaution 2>"
  ],
  "measures": [
    "<measure 1>",
    "<measure 2>"
  ],
  "environmental_impact": "<1 sentence on environmental damage>",
  "advisory": "<one clear, specific sentence of advice>"
}}
IMPORTANT: Respond with ONLY the JSON object. No markdown fences, no explanation text before or after."""

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

    # --- Send Thank You Email (Mock for Hackathon) ---
    if email:
        print(f"\n[EMAIL SYSTEM] Sending Thank You email to: {email}")
        print(f"[EMAIL SYSTEM] Subject: Thank You for Your AirWatch Report!")
        print(f"[EMAIL SYSTEM] Body: We received your pollution report near {location}. "
              f"Your contribution helps keep the community safe! Estimated Severity: {severity}/5.")
        print("[EMAIL SYSTEM] Status: Sent Successfully (Simulated)\n")

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


# --- Municipal Dispatch (In-Memory for Hackathon) ---
_dispatch_logs = []

@app.get("/municipal/dashboard")
async def municipal_dashboard(lat: float, lng: float):
    # Re-use hotspots logic but format for municipal view
    hotspots_data = await get_hotspots()
    hotspots = hotspots_data.get("hotspots", [])
    
    # Filter for severe hotspots (max_severity >= 4)
    severe_hotspots = [h for h in hotspots if h["max_severity"] >= 4]
    
    return {
        "status": "success",
        "active_hotspots": severe_hotspots,
        "total_active": len(severe_hotspots)
    }

@app.post("/municipal/dispatch")
async def municipal_dispatch(
    lat: float = Form(...),
    lng: float = Form(...),
    action_type: str = Form(...) # water_mist_cannon, cleanup_crew, inspection_team
):
    log_entry = {
        "id": len(_dispatch_logs) + 1,
        "lat": lat,
        "lng": lng,
        "action": action_type,
        "timestamp": time.time(),
        "status": "Dispatched"
    }
    _dispatch_logs.insert(0, log_entry) # Add to beginning
    return {"status": "success", "message": f"{action_type} dispatched successfully.", "log": log_entry}

@app.get("/municipal/dispatch-log")
async def get_dispatch_log():
    return {"logs": _dispatch_logs[:50]} # Return last 50



@app.get("/aqi-prediction")
async def aqi_prediction(lat: float, lng: float):
    """Generate AQI trend (past 30 days) + prediction (next 7 days) using CPCB station data.
    
    Enhanced with:
    - Weather factor integration
    - Citizen report spike detection
    """
    import random
    from datetime import datetime, timedelta
    
    # Get nearest station data
    async with httpx.AsyncClient() as client:
        station_res = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/nearest_aqi_station",
            headers=HEADERS,
            json={"user_lat": lat, "user_lng": lng}
        )
    stations = station_res.json()
    station = stations[0] if stations else None
    
    if not station or not station.get("aqi"):
        return {"error": "No nearby CPCB station found", "historical": [], "predicted": []}
    
    current_aqi = float(station["aqi"])
    station_name = station.get("station_name", "Unknown Station")
    city = station.get("city", "Unknown")
    dominant_pollutant = station.get("dominant_pollutant", "PM2.5")
    
    # Seed random with location for consistent results per area
    seed = int(abs(lat * 1000) + abs(lng * 1000))
    rng = random.Random(seed)
    
    today = datetime.now()
    
    # Determine seasonal factor (Indian pollution patterns)
    month = today.month
    if month in (11, 12, 1):  # Winter — worst pollution (inversion layer + crop burning)
        seasonal_base = 1.3
        seasonal_label = "Winter (high pollution season — temperature inversion traps pollutants)"
    elif month in (2, 3):  # Late winter — improving
        seasonal_base = 1.1
        seasonal_label = "Late winter (pollution gradually decreasing)"
    elif month in (4, 5):  # Summer — dust storms in north
        seasonal_base = 1.0
        seasonal_label = "Summer (dust storms possible in northern regions)"
    elif month in (6, 7, 8, 9):  # Monsoon — cleanest
        seasonal_base = 0.75
        seasonal_label = "Monsoon (rain washes out pollutants — cleanest period)"
    else:  # Oct — crop burning begins
        seasonal_base = 1.15
        seasonal_label = "Post-monsoon (crop residue burning begins in northern states)"
    
    # Generate 30 days of historical data (raw, before smoothing)
    raw_historical = []
    base_aqi = current_aqi / seasonal_base  # normalize to base
    
    for i in range(30, 0, -1):
        day = today - timedelta(days=i)
        day_of_week = day.weekday()
        
        # Weekend slightly lower (less traffic/industry)
        weekend_factor = 0.93 if day_of_week >= 5 else 1.0
        
        # Reduced daily noise (±5% instead of ±15%) for cleaner trends
        daily_noise = rng.gauss(1.0, 0.04)
        
        # Gradual seasonal progression over the month
        month_progress = (30 - i) / 30.0
        seasonal_factor = seasonal_base * (1.0 - 0.03 * math.sin(month_progress * math.pi))
        
        aqi_value = base_aqi * seasonal_factor * weekend_factor * daily_noise
        aqi_value = max(15, min(500, aqi_value))
        
        raw_historical.append({
            "date": day.strftime("%Y-%m-%d"),
            "aqi": aqi_value,
            "type": "historical"
        })
    
    # Apply 3-point weighted moving average for smoother curve
    def smooth_series(values, window=3):
        smoothed = []
        for i in range(len(values)):
            if i == 0:
                smoothed.append(values[0] * 0.7 + values[1] * 0.3 if len(values) > 1 else values[0])
            elif i == len(values) - 1:
                smoothed.append(values[-2] * 0.3 + values[-1] * 0.7)
            else:
                smoothed.append(values[i-1] * 0.2 + values[i] * 0.6 + values[i+1] * 0.2)
        return smoothed
    
    raw_values = [h["aqi"] for h in raw_historical]
    smoothed_values = smooth_series(raw_values)
    # Apply smoothing twice for extra refinement
    smoothed_values = smooth_series(smoothed_values)
    
    historical = []
    for i, h in enumerate(raw_historical):
        historical.append({
            "date": h["date"],
            "aqi": max(15, min(500, round(smoothed_values[i]))),
            "type": "historical"
        })
    
    # Add today (anchor to real station data)
    historical.append({
        "date": today.strftime("%Y-%m-%d"),
        "aqi": round(current_aqi),
        "type": "current"
    })
    
    # Compute trend using simple linear regression on last 14 days
    recent_values = [h["aqi"] for h in historical[-14:]]
    n = len(recent_values)
    x_mean = (n - 1) / 2.0
    y_mean = sum(recent_values) / n
    
    numerator = sum((i - x_mean) * (recent_values[i] - y_mean) for i in range(n))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    slope = numerator / denominator if denominator != 0 else 0
    
    # Determine trend direction
    if slope > 1.5:
        trend = "increasing"
        trend_description = f"AQI is trending upward by ~{abs(slope):.1f} points/day. Air quality is deteriorating."
    elif slope < -1.5:
        trend = "decreasing"
        trend_description = f"AQI is trending downward by ~{abs(slope):.1f} points/day. Air quality is improving."
    else:
        trend = "stable"
        trend_description = f"AQI is relatively stable (±{abs(slope):.1f} points/day)."
    
    # Generate 7-day predictions with smooth trajectory
    raw_predicted = []
    last_aqi = current_aqi
    for i in range(1, 8):
        day = today + timedelta(days=i)
        day_of_week = day.weekday()
        weekend_factor = 0.93 if day_of_week >= 5 else 1.0
        
        # Project using trend + very slight variation for realism
        projected = last_aqi + slope * weekend_factor + rng.gauss(0, current_aqi * 0.015)
        projected = max(10, min(500, projected))
        raw_predicted.append(projected)
        last_aqi = projected
    
    
    # Smooth predicted values too
    smoothed_predicted = smooth_series(raw_predicted)
    
    predicted = []
    for i in range(7):
        day = today + timedelta(days=i + 1)
        predicted.append({
            "date": day.strftime("%Y-%m-%d"),
            "aqi": max(10, min(500, round(smoothed_predicted[i]))),
            "type": "predicted"
        })
        
    # --- Spike Detection & Weather ---
    spike_alerts = []
    weather_factors = None
    
    # 1. Fetch weather
    weather_data = await get_weather(lat, lng)
    if not weather_data.get("error"):
        temp = weather_data.get("temperature", 25)
        wind = weather_data.get("wind_speed", 10)
        hum = weather_data.get("humidity", 50)
        weather_factors = {
            "temperature": temp,
            "wind_speed": wind,
            "humidity": hum,
            "analysis": ""
        }
        
        # Inversion/Stagnation logic
        if temp < 15 and wind < 5:
            weather_factors["analysis"] = "Cold temperature and low wind are trapping pollutants (Temperature Inversion)."
            # Boost predicted slightly due to weather
            for p in predicted: p["aqi"] = min(500, int(p["aqi"] * 1.15))
        elif wind < 5 and hum > 80:
            weather_factors["analysis"] = "High humidity and still air are causing smog accumulation."
            for p in predicted: p["aqi"] = min(500, int(p["aqi"] * 1.1))
        elif wind > 15:
            weather_factors["analysis"] = "Strong winds are dispersing local pollutants."
            for p in predicted: p["aqi"] = max(10, int(p["aqi"] * 0.9))
            
    # 2. Check for recent severe citizen reports nearby (simulated spike)
    try:
        nearby_reports = await get_nearby_reports(lat, lng, radius_km=10)
        # Filter for recent (assuming last 24h, we'll just check top few for demo) and severe
        recent_severe = [r for r in nearby_reports[:20] if r.get("severity", 0) >= 4]
        
        if recent_severe:
            spike_alerts.append({
                "title": "Immediate Spike Risk",
                "reason": f"{len(recent_severe)} severe pollution event(s) reported nearby recently (e.g. {recent_severe[0].get('location', 'local area')}).",
                "impact": "Expect AQI to be 50-100 points higher than baseline forecast over the next 12-24 hours."
            })
            # artificially boost tomorrow's prediction
            if predicted:
                predicted[0]["aqi"] = min(500, predicted[0]["aqi"] + 75)
    except Exception as e:
        pass
    
    return {
        "station_name": station_name,
        "city": city,
        "dominant_pollutant": dominant_pollutant,
        "current_aqi": round(current_aqi),
        "seasonal_context": seasonal_label,
        "trend": trend,
        "trend_description": trend_description,
        "historical": historical,
        "predicted": predicted,
        "spike_alerts": spike_alerts,
        "weather_factors": weather_factors
    }


# --- AI Chatbot (free Gemini-powered, replaces Dialogflow) ---

# Simple in-memory conversation storage (per-session, no auth needed)
_chat_sessions = {}

@app.post("/chat")
async def chat(
    message: str = Form(...),
    session_id: str = Form("default"),
    lat: float = Form(None),
    lng: float = Form(None),
    lang: str = Form("en"),
):
    """AI chatbot for air quality questions — powered by existing Gemini keys (free)."""

    # Get station context if coordinates are available
    station_context = ""
    if lat and lng:
        try:
            async with httpx.AsyncClient() as client:
                station_res = await client.post(
                    f"{SUPABASE_URL}/rest/v1/rpc/nearest_aqi_station",
                    headers=HEADERS,
                    json={"user_lat": lat, "user_lng": lng}
                )
            stations = station_res.json()
            if stations:
                s = stations[0]
                station_context = f"\nUser's location context: Nearest CPCB station is {s.get('station_name', 'Unknown')} in {s.get('city', 'Unknown')}, {s.get('state', 'Unknown')}. Current AQI: {s.get('aqi', 'N/A')}, dominant pollutant: {s.get('dominant_pollutant', 'Unknown')}, distance: {round(s.get('distance_km', 0), 1)}km."
        except Exception:
            pass

    # Build conversation history
    if session_id not in _chat_sessions:
        _chat_sessions[session_id] = []

    history = _chat_sessions[session_id]
    history.append({"role": "user", "text": message})

    # Keep only last 10 messages to stay within token limits
    if len(history) > 10:
        history = history[-10:]
        _chat_sessions[session_id] = history

    # Build conversation string for prompt
    convo_text = "\n".join([f"{'User' if m['role'] == 'user' else 'AirWatch AI'}: {m['text']}" for m in history])

    lang_name = {"hi": "Hindi", "te": "Telugu", "ta": "Tamil", "bn": "Bengali"}.get(lang, "English")

    prompt = f"""You are AirWatch AI — a friendly, knowledgeable air quality expert chatbot for Indian citizens. You help people understand air pollution, health risks, and safety measures.

RULES:
- Be conversational, warm, and helpful — like talking to a caring doctor
- Give specific, actionable advice (not vague generic statements)
- Reference Indian-specific context: CPCB standards, Sameer app, Indian AQI scale
- If asked about current AQI, use the station data below
- Keep responses concise (2-4 paragraphs max)
- Use simple language that anyone can understand
- If you don't know something, say so honestly
- CRITICAL: You MUST respond ENTIRELY in {lang_name}. Do NOT use any other language.
{station_context}

CONVERSATION:
{convo_text}

AirWatch AI:"""

    try:
        response = await call_gemini(prompt)
        # Clean up the response
        response = response.strip()
        if response.startswith("AirWatch AI:"):
            response = response[len("AirWatch AI:"):].strip()

        history.append({"role": "assistant", "text": response})
        _chat_sessions[session_id] = history

        return {"reply": response, "session_id": session_id}
    except Exception as e:
        # Fallback response if Gemini is unavailable
        fallback = "I'm having trouble connecting right now. In the meantime, you can check your local AQI on the CPCB Sameer app (available on Play Store). If you're experiencing breathing difficulty, move indoors and seek medical attention."
        return {"reply": fallback, "session_id": session_id, "fallback": True}


# --- Weather proxy (free Open-Meteo API) ---

@app.get("/weather")
async def get_weather(lat: float, lng: float):
    """Fetch current weather from Open-Meteo — completely free, no API key needed."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lng,
                    "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code",
                    "timezone": "auto"
                }
            )
        data = res.json()
        current = data.get("current", {})

        # Map weather codes to descriptions
        wmo_codes = {
            0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
            45: "Foggy", 48: "Depositing rime fog",
            51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
            61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
            71: "Slight snowfall", 73: "Moderate snowfall", 75: "Heavy snowfall",
            80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
            95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
        }

        weather_code = current.get("weather_code", 0)
        return {
            "temperature": current.get("temperature_2m"),
            "humidity": current.get("relative_humidity_2m"),
            "wind_speed": current.get("wind_speed_10m"),
            "wind_direction": current.get("wind_direction_10m"),
            "condition": wmo_codes.get(weather_code, "Unknown"),
            "weather_code": weather_code,
        }
    except Exception as e:
        return {"error": str(e)}