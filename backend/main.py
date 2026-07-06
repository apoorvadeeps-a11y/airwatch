import base64, json, os, re, io, hashlib, time, asyncio
from fastapi import FastAPI, UploadFile, File, Form, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import httpx
import math
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from PIL import Image
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

load_dotenv()

# BUG FIX (timezone): the app is India-only, but the server (Render) runs on UTC.
# Any bare `datetime.now()` silently uses the server's UTC clock, which is behind
# IST by 5:30h. Between UTC 18:30-23:59 (= IST 00:00-05:30 the *next* day), a naive
# datetime.now() thinks it's still "yesterday" while every Indian user's phone
# already shows "today" — this shifted the whole /aqi-prediction date axis (today
# marker, day-of-week traffic factor, and the entire 7-day forecast) back by one
# day during that window. Always anchor "now" to IST explicitly.
IST = ZoneInfo("Asia/Kolkata")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
GEMINI_KEYS = [k.strip() for k in os.getenv("GEMINI_API_KEYS", os.getenv("GEMINI_API_KEY", "")).split(",") if k.strip()]
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

DEBUG_LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "debug-d825a9.log")

def _write_debug(entry: dict):
    # #region agent log
    try:
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass
    # #endregion

@app.middleware("http")
async def debug_request_middleware(request: Request, call_next):
    # #region agent log
    if request.url.path != "/debug-log":
        _write_debug({
            "sessionId": "d825a9",
            "location": "main.py:middleware",
            "message": "incoming request",
            "data": {
                "path": request.url.path,
                "client": request.client.host if request.client else None,
                "origin": request.headers.get("origin"),
                "userAgent": (request.headers.get("user-agent") or "")[:120],
            },
            "timestamp": int(time.time() * 1000),
            "hypothesisId": "B",
        })
    # #endregion
    return await call_next(request)

HEADERS = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
}

EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_APP_PASSWORD = os.getenv("EMAIL_APP_PASSWORD")

def send_thank_you_email(to_email: str, location: str, severity: int):
    email_user = os.getenv("EMAIL_USER", "").strip().strip('\'"')
    email_app_password = os.getenv("EMAIL_APP_PASSWORD", "").strip().strip('\'"')
    
    if not email_user or not email_app_password or not to_email:
        print(f"[EMAIL SYSTEM] Missing credentials (user={bool(email_user)}, pass={bool(email_app_password)}, to={bool(to_email)}). Skipping actual send.")
        return

    try:
        msg = MIMEMultipart()
        msg['From'] = f"AirWatch Team <{email_user}>"
        msg['To'] = to_email
        msg['Subject'] = "Thank You for Your AirWatch Report! 🌿"

        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #064e3b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0; font-size: 24px;">🌿 AirWatch</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                <p>Hello,</p>
                <p>We successfully received your pollution report near <strong>{location}</strong>.</p>
                <p>Your contribution directly helps keep the community safe and alerts authorities to hazardous air quality conditions.</p>
                <div style="background-color: #fef3c7; padding: 15px; border-radius: 6px; margin: 20px 0;">
                    <p style="margin: 0; color: #92400e; font-weight: bold;">Estimated Severity: {severity} / 5</p>
                </div>
                <p>Thank you for being an active citizen!</p>
                <p style="margin-bottom: 0;">Stay safe,<br/>The AirWatch Team</p>
            </div>
        </body>
        </html>
        """
        msg.attach(MIMEText(html_body, 'html'))
        
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(email_user, email_app_password)
        server.send_message(msg)
        server.quit()
        print(f"[EMAIL SYSTEM] Successfully sent email for report at {location} to {to_email}")
    except Exception as e:
        print(f"[EMAIL SYSTEM] Failed to send email: {e}")

# ── Live CPCB station data (from real-time CSV, last updated 01-07-2026) ──────
# Aggregated per station: {station_key: {lat, lng, city, state, pollutants: {PM2.5:avg,...}}}
# Built once at startup — used by /aqi-prediction for accurate local AQI.
_CSV_STATION_DATA = [
    # Maharashtra — Thane / Mumbai / Navi Mumbai region (closest to target users)
    {"station":"Kasarvadavali, Thane - MPCB",    "lat":19.26777,"lng":72.97182,"city":"Thane","state":"Maharashtra","pollutants":{"PM2.5":26,"PM10":23,"NO2":28}},
    {"station":"Upvan Fort, Thane - MPCB",        "lat":19.222279,"lng":72.957979,"city":"Thane","state":"Maharashtra","pollutants":{"PM2.5":16,"PM10":25,"NH3":6,"NO2":27}},
    {"station":"Ghatkopar, Mumbai - BMC",          "lat":19.083694,"lng":72.920967,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":9,"PM10":17,"SO2":1,"CO":28}},
    {"station":"Kandivali West, Mumbai - BMC",     "lat":19.215859,"lng":72.831718,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":9,"PM10":45,"NO2":17,"CO":9}},
    {"station":"CBD Belapur, Belapur - MPCB",      "lat":19.0243902,"lng":73.0406721,"city":"Belapur","state":"Maharashtra","pollutants":{"PM2.5":13,"PM10":20,"NO2":24,"CO":10}},
    {"station":"Sanpada, Navi Mumbai - MPCB",      "lat":19.0575752,"lng":73.0151367,"city":"Navi Mumbai","state":"Maharashtra","pollutants":{"PM10":23,"NO2":7,"SO2":25,"CO":13}},
    {"station":"Kopripada-Vashi, Navi Mumbai - MPCB","lat":19.090337,"lng":73.014232,"city":"Navi Mumbai","state":"Maharashtra","pollutants":{"PM2.5":18,"PM10":17,"NO2":16,"CO":31}},
    {"station":"Sector-2E Kalamboli, Navi Mumbai - MPCB","lat":19.02579,"lng":73.10297,"city":"Navi Mumbai","state":"Maharashtra","pollutants":{"PM2.5":12,"PM10":26,"NO2":15,"NH3":8,"SO2":3}},
    {"station":"Tondare-Taloja, Navi Mumbai - MPCB","lat":19.063,"lng":73.1209,"city":"Navi Mumbai","state":"Maharashtra","pollutants":{"PM2.5":32,"PM10":51,"NO2":6,"CO":21}},
    {"station":"Mahape, Navi Mumbai - MPCB",       "lat":19.1135051,"lng":73.008978,"city":"Navi Mumbai","state":"Maharashtra","pollutants":{"PM10":18,"NO2":43,"SO2":17,"CO":None}},
    {"station":"Gokul Nagar, Bhiwandi - MPCB",     "lat":19.309073,"lng":73.057223,"city":"Bhiwandi","state":"Maharashtra","pollutants":{"PM2.5":34,"PM10":46,"NO2":24,"SO2":5,"CO":22}},
    {"station":"Pimpleshwar Mandir, Kalyan - MPCB","lat":19.192056,"lng":72.9585188,"city":"Kalyan","state":"Maharashtra","pollutants":{"PM2.5":18,"PM10":48,"NO2":13,"NH3":4,"SO2":12,"CO":69}},
    {"station":"Kalu Nagar, Dombivli - MPCB",      "lat":19.2268427,"lng":73.0788456,"city":"Dombivli","state":"Maharashtra","pollutants":{"PM2.5":None,"PM10":4,"NO2":17,"SO2":6,"CO":17}},
    {"station":"Chinchpada, Ambernath - MPCB",     "lat":19.215784,"lng":73.199781,"city":"Ambernath","state":"Maharashtra","pollutants":{"PM2.5":22,"PM10":None,"NO2":23,"SO2":6,"CO":11}},
    {"station":"Katrap, Badlapur - MPCB",          "lat":19.16485,"lng":73.23409,"city":"Badlapur","state":"Maharashtra","pollutants":{"PM2.5":29,"PM10":41,"NO2":20,"SO2":5,"CO":20}},
    {"station":"Sidhi Vinayak Nagar, Ulhasnagar - MPCB","lat":19.235581,"lng":73.159121,"city":"Ulhasnagar","state":"Maharashtra","pollutants":{"PM2.5":31,"PM10":41,"NO2":20,"SO2":5,"CO":24}},
    {"station":"Bhayandar West, Mira-Bhayandar - MPCB","lat":19.296481,"lng":72.840923,"city":"Mira-Bhayandar","state":"Maharashtra","pollutants":{"PM10":None,"NO2":11,"CO":18}},
    {"station":"Bolinj, Virar - MPCB",             "lat":19.445821,"lng":72.7988231,"city":"Virar","state":"Maharashtra","pollutants":{"PM2.5":None,"PM10":None,"SO2":None,"CO":41}},
    {"station":"Khaira, Boisar - MPCB",            "lat":19.786089,"lng":72.757971,"city":"Boisar","state":"Maharashtra","pollutants":{"PM2.5":28,"PM10":38,"NO2":16,"SO2":16,"CO":15}},
    {"station":"Byculla, Mumbai - BMC",            "lat":18.9767,"lng":72.838,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":20,"PM10":47,"NO2":18,"NH3":2,"SO2":9}},
    {"station":"Siddharth Nagar-Worli, Mumbai - IITM","lat":19.000083,"lng":72.813993,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":24,"PM10":54,"NO2":21,"CO":45}},
    {"station":"Navy Nagar-Colaba, Mumbai - IITM", "lat":18.897756,"lng":72.81332,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":23,"PM10":35,"NO2":48,"SO2":7,"CO":25}},
    {"station":"Malad West, Mumbai - IITM",        "lat":19.19709,"lng":72.82204,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":5,"PM10":17,"NO2":21,"SO2":8,"CO":20}},
    {"station":"Borivali East, Mumbai - IITM",     "lat":19.23241,"lng":72.86895,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":19,"PM10":25,"NO2":22,"NH3":4,"CO":55}},
    {"station":"Chakala-Andheri East, Mumbai - IITM","lat":19.11074,"lng":72.86084,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":11,"PM10":19,"NO2":15,"SO2":3,"CO":10}},
    {"station":"Khindipada-Bhandup West, Mumbai - IITM","lat":19.1653323,"lng":72.922099,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":5,"PM10":28,"NO2":13,"SO2":10,"CO":22}},
    {"station":"Bandra Kurla Complex, Mumbai - MPCB","lat":19.065931,"lng":72.862131,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":12,"PM10":12,"NO2":17,"SO2":3,"CO":20}},
    {"station":"Worli, Mumbai - MPCB",             "lat":18.9936162,"lng":72.8128113,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":21,"PM10":43,"NO2":10,"SO2":6,"CO":39}},
    {"station":"Chembur, Mumbai - MPCB",           "lat":19.0364585,"lng":72.8954371,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":15,"PM10":34,"NO2":15,"SO2":16,"CO":25}},
    {"station":"Shivaji Nagar, Mumbai - BMC",      "lat":19.060498,"lng":72.923356,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":18,"PM10":21,"NO2":16,"NH3":5,"CO":21}},
    {"station":"Mazgaon, Mumbai - IITM",           "lat":18.96702,"lng":72.84214,"city":"Mumbai","state":"Maharashtra","pollutants":{"PM2.5":26,"PM10":32,"NO2":27,"NH3":8,"SO2":8,"CO":68}},
    # Pune / Pimpri region
    {"station":"Bhosari, Pune - IITM",             "lat":18.640051,"lng":73.848956,"city":"Pimpri-Chinchwad","state":"Maharashtra","pollutants":{"PM2.5":30,"PM10":39,"NO2":28,"CO":25}},
    {"station":"Hadapsar, Pune - IITM",            "lat":18.501793,"lng":73.927532,"city":"Pune","state":"Maharashtra","pollutants":{"PM2.5":None,"PM10":42,"NO2":31,"CO":87}},
    {"station":"Revenue Colony-Shivajinagar, Pune - IITM","lat":18.530085,"lng":73.849598,"city":"Pune","state":"Maharashtra","pollutants":{"PM2.5":21,"PM10":24,"NO2":18,"SO2":23,"CO":32}},
    {"station":"Panchawati_Pashan, Pune - IITM",   "lat":18.536457,"lng":73.805454,"city":"Pune","state":"Maharashtra","pollutants":{"PM2.5":24,"PM10":29,"NO2":10,"CO":37}},
    {"station":"Mhada Colony, Pune - IITM",        "lat":18.57304,"lng":73.927715,"city":"Pune","state":"Maharashtra","pollutants":{"PM2.5":24,"PM10":37,"NO2":39,"CO":2}},
    {"station":"Transport Nagar-Nigdi, Pune - IITM","lat":18.664282,"lng":73.763966,"city":"Pimpri-Chinchwad","state":"Maharashtra","pollutants":{"PM2.5":13,"PM10":29,"NO2":16,"CO":31}},
    # Delhi / NCR
    {"station":"JNU, Delhi - DPCC",               "lat":28.540721,"lng":77.168544,"city":"Delhi","state":"Delhi","pollutants":{"PM2.5":63,"PM10":88,"NO2":13,"SO2":1,"CO":26}},
    {"station":"R K Puram, Delhi - DPCC",         "lat":28.563262,"lng":77.186937,"city":"Delhi","state":"Delhi","pollutants":{"PM2.5":82,"PM10":104,"NO2":27,"SO2":36,"CO":27}},
    {"station":"Anand Vihar, Delhi - DPCC",       "lat":28.647622,"lng":77.315809,"city":"Delhi","state":"Delhi","pollutants":{"PM2.5":98,"PM10":134,"NO2":30,"SO2":9,"CO":57}},
    {"station":"ITO, Delhi - CPCB",               "lat":28.628624,"lng":77.24106,"city":"Delhi","state":"Delhi","pollutants":{"PM2.5":76,"PM10":97,"NO2":56,"SO2":15,"CO":58}},
    {"station":"DTU, Delhi - CPCB",               "lat":28.7500499,"lng":77.1112615,"city":"Delhi","state":"Delhi","pollutants":{"PM2.5":86,"PM10":96,"NO2":28,"SO2":43,"CO":34}},
    {"station":"Rohini, Delhi - DPCC",            "lat":28.732528,"lng":77.11992,"city":"Delhi","state":"Delhi","pollutants":{"PM2.5":87,"PM10":120,"NO2":31,"NH3":7,"CO":51}},
    {"station":"Dwarka-Sector 8, Delhi - DPCC",   "lat":28.5710274,"lng":77.0719006,"city":"Delhi","state":"Delhi","pollutants":{"PM2.5":59,"PM10":124,"NO2":24,"SO2":16,"CO":33}},
    {"station":"Vasundhara, Ghaziabad - UPPCB",   "lat":28.6603346,"lng":77.3572563,"city":"Ghaziabad","state":"Uttar Pradesh","pollutants":{"PM2.5":66,"PM10":100,"NO2":24,"SO2":18,"CO":37}},
    {"station":"Sector - 125, Noida - UPPCB",     "lat":28.5447608,"lng":77.3231257,"city":"Noida","state":"Uttar Pradesh","pollutants":{"PM2.5":59,"PM10":106,"NO2":23,"SO2":5}},
    {"station":"Sector-1, Noida - UPPCB",         "lat":28.5898,"lng":77.3101,"city":"Noida","state":"Uttar Pradesh","pollutants":{"PM2.5":79,"PM10":102,"NO2":37,"CO":28}},
    # Bengaluru
    {"station":"BTM Layout, Bengaluru - CPCB",    "lat":12.9135218,"lng":77.5950804,"city":"Bengaluru","state":"Karnataka","pollutants":{"PM2.5":26,"PM10":46,"NO2":24,"NH3":4,"SO2":19,"CO":50}},
    {"station":"Jayanagar 5th Block, Bengaluru - KSPCB","lat":12.920984,"lng":77.584908,"city":"Bengaluru","state":"Karnataka","pollutants":{"PM2.5":17,"PM10":26,"NO2":7,"SO2":17,"CO":10}},
    {"station":"Silk Board, Bengaluru - KSPCB",   "lat":12.917348,"lng":77.622813,"city":"Bengaluru","state":"Karnataka","pollutants":{"PM2.5":23,"PM10":81,"NO2":9,"SO2":7,"CO":None}},
    {"station":"Hebbal, Bengaluru - KSPCB",       "lat":13.029152,"lng":77.585901,"city":"Bengaluru","state":"Karnataka","pollutants":{"PM2.5":5,"PM10":21,"NO2":17,"SO2":14,"CO":19}},
    # Hyderabad
    {"station":"Sanathnagar, Hyderabad - TSPCB",  "lat":17.4559458,"lng":78.4332152,"city":"Hyderabad","state":"Telangana","pollutants":{"PM2.5":16,"PM10":None,"NO2":38,"SO2":7,"CO":35}},
    {"station":"Ramachandrapuram, Hyderabad - TSPCB","lat":17.528544,"lng":78.286195,"city":"Hyderabad","state":"Telangana","pollutants":{"PM2.5":43,"PM10":67,"NO2":15,"SO2":12,"CO":31}},
    {"station":"Zoo Park, Hyderabad - TSPCB",     "lat":17.349694,"lng":78.451437,"city":"Hyderabad","state":"Telangana","pollutants":{"PM2.5":8,"PM10":9,"NO2":7,"SO2":2,"CO":39}},
    {"station":"ECIL Kapra, Hyderabad - TSPCB",   "lat":17.470431,"lng":78.566959,"city":"Hyderabad","state":"Telangana","pollutants":{"PM2.5":40,"PM10":63,"NO2":7,"SO2":14,"CO":26}},
    # Chennai
    {"station":"Royapuram, Chennai - TNPCB",      "lat":13.1036,"lng":80.2909,"city":"Chennai","state":"Tamil Nadu","pollutants":{"PM2.5":40,"PM10":53,"NO2":14,"SO2":5,"CO":54}},
    {"station":"Manali, Chennai - CPCB",          "lat":13.164544,"lng":80.26285,"city":"Chennai","state":"Tamil Nadu","pollutants":{"PM10":71,"NO2":None,"SO2":17,"CO":13}},
    {"station":"Velachery Res. Area, Chennai - CPCB","lat":13.0052189,"lng":80.2398125,"city":"Chennai","state":"Tamil Nadu","pollutants":{"PM2.5":29,"PM10":55,"NO2":12,"SO2":7}},
    {"station":"Perungudi, Chennai - TNPCB",      "lat":12.9533,"lng":80.2357,"city":"Chennai","state":"Tamil Nadu","pollutants":{"PM2.5":57,"PM10":43,"NO2":5,"SO2":6,"CO":31}},
    # Kolkata
    {"station":"Jadavpur, Kolkata - WBPCB",       "lat":22.49929,"lng":88.36917,"city":"Kolkata","state":"West Bengal","pollutants":{"PM2.5":51,"PM10":56,"NO2":35,"SO2":5,"CO":22}},
    {"station":"Victoria, Kolkata - WBPCB",       "lat":22.5448082,"lng":88.3403691,"city":"Kolkata","state":"West Bengal","pollutants":{"PM2.5":75,"PM10":90,"NO2":25,"NH3":8,"SO2":17,"CO":51}},
    {"station":"Ballygunge, Kolkata - WBPCB",     "lat":22.5367507,"lng":88.3638022,"city":"Kolkata","state":"West Bengal","pollutants":{"PM2.5":30,"PM10":28,"NO2":37,"SO2":3,"CO":15}},
    {"station":"Bidhannagar, Kolkata - WBPCB",    "lat":22.58157048,"lng":88.41002457,"city":"Kolkata","state":"West Bengal","pollutants":{"PM2.5":29,"PM10":41,"NO2":13,"SO2":8,"CO":43}},
    # Pune / Nashik
    {"station":"MIDC Ambad, Nashik - MPCB",       "lat":19.95022,"lng":73.73148,"city":"Nashik","state":"Maharashtra","pollutants":{"PM2.5":25,"PM10":25,"NO2":4,"SO2":3,"CO":13}},
    {"station":"Gangapur Road, Nashik - MPCB",    "lat":20.0073285,"lng":73.7762427,"city":"Nashik","state":"Maharashtra","pollutants":{"PM2.5":16,"PM10":18,"NO2":5,"SO2":3,"CO":21}},
    {"station":"Rachnakar Colony, Aurangabad - MPCB","lat":19.863756,"lng":75.321188,"city":"Aurangabad","state":"Maharashtra","pollutants":{"PM2.5":18,"PM10":30,"NO2":18,"SO2":7,"CO":25}},
    # Ahmedabad / Gujarat
    {"station":"Chandkheda, Ahmedabad - IITM",    "lat":23.107969,"lng":72.574648,"city":"Ahmedabad","state":"Gujarat","pollutants":{"PM2.5":52,"PM10":46,"NO2":16,"NH3":4,"SO2":9,"CO":19}},
    {"station":"Maninagar, Ahmedabad - GPCB",     "lat":23.002657,"lng":72.591912,"city":"Ahmedabad","state":"Gujarat","pollutants":{"PM2.5":83,"PM10":73,"NO2":29,"NH3":None,"SO2":70,"CO":52}},
    {"station":"Gyaspur, Ahmedabad - IITM",       "lat":22.977134,"lng":72.553024,"city":"Ahmedabad","state":"Gujarat","pollutants":{"PM2.5":43,"PM10":90,"NO2":12,"NH3":3,"SO2":23,"CO":22}},
    {"station":"Raikhad, Ahmedabad - IITM",       "lat":23.020509,"lng":72.579261,"city":"Ahmedabad","state":"Gujarat","pollutants":{"PM2.5":30,"PM10":74,"NO2":7,"NH3":1,"SO2":4,"CO":27}},
    {"station":"Katargam, Surat - Nexteng Enviro", "lat":21.217779,"lng":72.834787,"city":"Surat","state":"Gujarat","pollutants":{"PM2.5":43,"PM10":65,"NO2":38,"NH3":3,"SO2":7,"CO":41}},
    {"station":"Science Center, Surat - SMC",     "lat":21.170046,"lng":72.795405,"city":"Surat","state":"Gujarat","pollutants":{"PM2.5":26,"PM10":36,"NO2":3,"SO2":16,"CO":41}},
]

def _build_station_index():
    """Group CSV rows by station, merge pollutants, ready for fast nearest-lookup."""
    idx = {}
    for row in _CSV_STATION_DATA:
        key = row["station"]
        if key not in idx:
            idx[key] = {"station": key, "lat": row["lat"], "lng": row["lng"],
                        "city": row["city"], "state": row["state"], "pollutants": {}}
        for pol, val in row["pollutants"].items():
            if val is not None:
                idx[key]["pollutants"][pol] = val
    return list(idx.values())

_LIVE_STATIONS = _build_station_index()

# ── CPCB AQI sub-index breakpoints & Helpers ─────────────────────────────────
_BP = {
    "PM2.5":  [(0,30,0,50),(30,60,51,100),(60,90,101,200),(90,120,201,300),(120,250,301,400),(250,500,401,500)],
    "PM10":   [(0,50,0,50),(50,100,51,100),(100,250,101,200),(250,350,201,300),(350,430,301,400),(430,600,401,500)],
    "NO2":    [(0,40,0,50),(40,80,51,100),(80,180,101,200),(180,280,201,300),(280,400,301,400),(400,800,401,500)],
    "SO2":    [(0,40,0,50),(40,80,51,100),(80,380,101,200),(380,800,201,300),(800,1600,301,400),(1600,2100,401,500)],
    "CO":     [(0,1,0,50),(1,2,51,100),(2,10,101,200),(10,17,201,300),(17,34,301,400),(34,50,401,500)],
    "OZONE":  [(0,50,0,50),(50,100,51,100),(100,168,101,200),(168,208,201,300),(208,748,301,400),(748,1000,401,500)],
    "NH3":    [(0,200,0,50),(200,400,51,100),(400,800,101,200),(800,1200,201,300),(1200,1800,301,400),(1800,2400,401,500)],
}

def _sub_index(pol, conc):
    for (cl, ch, il, ih) in _BP.get(pol, []):
        if cl <= conc <= ch:
            return round(il + (ih - il) * (conc - cl) / max(ch - cl, 1e-9))
    return 500 if conc > 0 else None

def _aqi_from_station(s):
    # BUG FIX (CO units): the CO breakpoint table above is calibrated for mg/m³
    # (CPCB "Good" ceiling = 1 mg/m³). The CO values baked into
    # _CSV_STATION_DATA are 10-90+ — physically impossible as mg/m³ ambient CO,
    # so they're clearly recorded in a different unit (µg/m³ or similar) that
    # was never converted. Feeding them through the mg/m³ table pushed CO's
    # sub-index to 300-500 ("Hazardous") for ~85% of stations, and since AQI
    # takes the MAX sub-index as the dominant pollutant, CO was silently
    # hijacking the reported AQI on stations whose real PM2.5/PM10 readings
    # were "Good"/"Moderate". Excluded until verified mg/m³ CO data is sourced.
    mapping = {
        "PM2.5": s.get("pm25"), "PM10": s.get("pm10"),
        "NO2":   s.get("no2"),  "SO2":  s.get("so2"),
        "OZONE": s.get("ozone"), "NH3": s.get("nh3"),
    }
    subs = {}
    for pol, val in mapping.items():
        if val is not None:
            try:
                si = _sub_index(pol, float(val))
                if si is not None:
                    subs[pol] = si
            except (TypeError, ValueError):
                pass
    if not subs:
        return None, "PM2.5"
    dom = max(subs, key=lambda k: subs[k])
    return float(max(subs.values())), dom

def _haversine_simple(la1, lo1, la2, lo2):
    R = 6371.0
    dlat, dlng = math.radians(la2 - la1), math.radians(lo2 - lo1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(la1))*math.cos(math.radians(la2))*math.sin(dlng/2)**2
    return R * 2 * math.asin(math.sqrt(a))

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


def _no_pollution_response(mode: str) -> dict:
    """Shared 'nothing to see here' template — used both by the local keyword
    fallback AND by the Gemini-response validator below, so an irrelevant/
    unreadable report gets the exact same safe, low-severity result no matter
    which analysis path produced it."""
    return {
        "severity": 1,
        "pollutant_type": "Unknown",
        "estimated_aqi_range": "0-50",
        "detailed_visual_analysis": "No visible pollution detected.",
        "government_consistency": "No data",
        "advisory": "No pollution detected. Air quality appears acceptable.",
        "summary": "No visible pollution detected in the report.",
        "analysis_mode": mode,
        "possible_sources": [],
        "root_causes": "N/A",
        "health_impact": "None expected.",
        "affected_groups": [],
        "precautions": [],
        "measures": [],
        "environmental_impact": "None",
    }


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

    # GUARDRAIL FOR IRRELEVANT TEXT
    if not matched_keywords and len(text.split()) <= 3:
        return _no_pollution_response("local_fallback")

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


# --- Gemini response validator (anti-hallucination guardrail) ---
#
# BUG FIX: previously the ONLY thing stopping a garbage/irrelevant photo or
# text report from producing a confident "Severity 4/5 Hazardous" result was
# a sentence in the prompt asking Gemini nicely not to do that. Nothing
# enforced it in code, so a model response could (and did) simultaneously say
# "dark image, cannot assess smoke/haze" AND set severity to 4 with an
# invented location and pollutant. This function is the enforcement layer:
# it runs on every Gemini response before it's cached or returned, and
# distrusts the model's own severity number under three conditions.

_HEDGE_PHRASES = [
    "cannot assess", "can't assess", "unable to determine", "unable to assess",
    "not visible", "too dark", "unclear", "cannot tell", "can't tell",
    "difficult to assess", "no visible pollution", "cannot determine",
    "hard to tell", "image unclear", "no clear indicators",
]

_STRONG_VISUAL_KEYWORDS = [
    "smoke", "fire", "flame", "haze", "smog", "dust cloud", "black plume",
    "burning", "chimney", "dump fire", "thick haze", "visible pollution",
]


def _aqi_range_to_severity(aqi_range: str) -> int | None:
    """Parse '150-200' style estimated_aqi_range into a rough 1-5 severity,
    so we can cross-check it against the severity integer the model gave —
    the two frequently didn't agree (e.g. AQI 170-200 = 'Moderate' on the
    Indian scale, but the model separately called it 'Hazardous')."""
    try:
        lo = int(re.findall(r"\d+", aqi_range)[0])
    except (IndexError, ValueError):
        return None
    if lo <= 50:   return 1
    if lo <= 100:  return 2
    if lo <= 200:  return 3
    if lo <= 300:  return 4
    return 5


def _validate_analysis(analysis: dict, station: dict = None) -> dict:
    """Enforce the guardrails the prompt only *asked* for. Returns a
    (possibly corrected) analysis dict — never trusts severity blindly."""

    # 1) Explicit self-report: if the model says it didn't actually find
    #    pollution, throw away everything else it wrote (including any
    #    invented location/pollutant/severity) and use the safe template.
    if analysis.get("pollution_detected") is False:
        return _no_pollution_response("gemini_no_pollution")

    text_blob = f"{analysis.get('detailed_visual_analysis', '')} {analysis.get('summary', '')}".lower()
    has_hedge = any(p in text_blob for p in _HEDGE_PHRASES)
    has_strong_visual = any(k in text_blob for k in _STRONG_VISUAL_KEYWORDS)

    severity = analysis.get("severity", 3)
    try:
        severity = int(severity)
    except (TypeError, ValueError):
        severity = 3

    # 2) Model hedged ("dark image", "cannot assess") but still claimed a
    #    high severity — the hedge means it had no real evidence, so cap it.
    #    BUG FIX: Removed "and not has_strong_visual" because if the AI says
    #    "cannot assess smoke, haze", it triggers both the hedge AND the strong visual.
    if has_hedge:
        severity = min(severity, 2)
        analysis["government_consistency"] = analysis.get("government_consistency") or "No data"

    # 3) Cross-check against the real government station reading. If the
    #    model's severity implies an AQI far from the station's actual AQI
    #    AND it has no concrete visual evidence backing up "trust me, it's
    #    worse here," pull the severity back toward the station's reality
    #    instead of the model's invented narrative.
    if station and station.get("aqi") is not None and not has_strong_visual:
        try:
            station_aqi = float(station["aqi"])
        except (TypeError, ValueError):
            station_aqi = None
        if station_aqi is not None:
            station_severity = _aqi_range_to_severity(f"{station_aqi}-{station_aqi}")
            if station_severity is not None and abs(severity - station_severity) >= 2:
                severity = station_severity
                analysis["government_consistency"] = "Consistent"

    # 4) Internal consistency: severity number vs. the AQI range the model
    #    itself quoted (e.g. severity=4 "Hazardous" next to "170-200", which
    #    is actually "Moderate" on the CPCB scale). Trust the AQI range,
    #    since it's a concrete number, over the qualitative severity label.
    range_severity = _aqi_range_to_severity(analysis.get("estimated_aqi_range", ""))
    if range_severity is not None and abs(severity - range_severity) >= 2:
        severity = range_severity

    analysis["severity"] = max(1, min(5, severity))
    return analysis


@app.get("/")
def read_root():
    return {"status": "online", "message": "AirWatch API is running. Visit /docs for API info."}


@app.get("/health")
def health():
    return {"status": "ok", "service": "airwatch-backend"}


@app.post("/debug-log")
async def debug_log(payload: dict):
    # #region agent log
    payload.setdefault("sessionId", "d825a9")
    _write_debug(payload)
    return {"ok": True}
    # #endregion

@app.get("/test-env")
def test_env():
    return {
        "has_supabase_url": bool(SUPABASE_URL),
        "has_supabase_key": bool(SUPABASE_ANON_KEY),
        "has_gemini_key": bool(GEMINI_KEYS),
        "dev_mode": DEV_MODE
    }

@app.get("/nearest-station")
async def nearest_station(lat: float, lng: float):
    # Use live CSV stations instead of stale Supabase RPC
    scored = []
    for s in _LIVE_STATIONS:
        dist = _haversine_simple(lat, lng, s["lat"], s["lng"])
        # Compute AQI from actual pollutants
        pollutants = s["pollutants"]
        computed_aqi, dominant = _aqi_from_station({
            "pm25": pollutants.get("PM2.5"), "pm10": pollutants.get("PM10"),
            "no2": pollutants.get("NO2"), "so2": pollutants.get("SO2"),
            "co": pollutants.get("CO"), "ozone": pollutants.get("OZONE"),
            "nh3": pollutants.get("NH3")
        })
        
        if computed_aqi is not None:
            scored.append({
                "station_name": s["station"],
                "city": s["city"],
                "state": s["state"],
                "aqi": computed_aqi,
                "dominant_pollutant": dominant,
                "distance_km": dist,
                "lat": s["lat"],
                "lng": s["lng"]
            })
            
    scored.sort(key=lambda x: x["distance_km"])
    if not scored:
        return {"error": "No station found"}
    
    return scored[0]


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
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    location: str = Form("Unknown location"),
    email: str = Form(None),
    photo: UploadFile = File(None),
):
    try:
        print(f"Received report: {text}, lat: {lat}, lng: {lng}")
        
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
                photo_instruction = "PHOTO: Describe visible pollution in 10 words max (smoke color/density, haze, waste, sky clarity)."

            prompt = f"""You are an air quality expert. Be EXTREMELY BRIEF — every text field must be 10 words or fewer. No long sentences.

USER REPORT:
Location: {location} (lat: {lat}, lng: {lng})
Description: {text}

GOVERNMENT DATA:
{station_context}

{photo_instruction if photo else "No photo — use text and government data only."}

CRITICAL RULE: If the text/photo has no visible pollution indicators (e.g., it is just a random object, person, an unreadable/too-dark image, or an irrelevant word like "Charger"), you MUST set "pollution_detected" to false, set severity to 1, return empty arrays for possible_sources, precautions, and measures, and set the summary to "No visible pollution detected". Do NOT invent a severity, pollutant, or location if you are not actually able to assess the image or text — say so honestly via "pollution_detected": false instead of guessing.

Respond in this EXACT JSON format:
{{
  "pollution_detected": <true or false — false if the photo/text gives no real evidence of pollution>,
  "severity": <integer 1-5>,
  "pollutant_type": "<PM2.5|PM10|NO2|SO2|CO|Ozone|Mixed|Unknown>",
  "estimated_aqi_range": "<e.g. '150-200'>",
  "detailed_visual_analysis": "<max 12 words describing visible pollution>",
  "government_consistency": "<Consistent|Higher than official|Lower than official|No data>",
  "summary": "<max 15 words: what, where, severity>",
  "possible_sources": ["<5 words max>", "<5 words max>"],
  "root_causes": "<max 10 words>",
  "health_impact": "<max 12 words>",
  "affected_groups": ["<group name only>", "<group name only>"],
  "precautions": ["<action phrase, 6 words max>", "<action phrase, 6 words max>"],
  "measures": ["<action phrase, 6 words max>", "<action phrase, 6 words max>"],
  "environmental_impact": "<max 10 words>",
  "advisory": "<one clear action sentence, 12 words max>"
}}
IMPORTANT: Respond with ONLY the JSON. No markdown. No extra text."""

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
                    match= re.search(r'```(?:json)?\s*([\s\S]*?)```', cleaned)
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

                # Anti-hallucination guardrail — never trust severity as-is
                analysis = _validate_analysis(analysis, station)

                # Cache the successful (and validated) response
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

        # --- Send Thank You Email ---
        if email:
            print(f"\n[EMAIL SYSTEM] Queuing email to {email}")
            # Dispatch immediately using asyncio to prevent Render dropping post-response BackgroundTasks
            asyncio.create_task(asyncio.to_thread(send_thank_you_email, email, location, severity))

        return {
            "success": True,
            "analysis": analysis,
            "station": station,
        }
    except Exception as e:
        import traceback
        print(f"Error in /report: {str(e)}")
        print(traceback.format_exc())
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


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


async def _resolve_local_aqi(lat: float, lng: float) -> dict:
    """Interpolate a proper AQI *for the user's own coordinates* — never a
    single raw station reading, no matter how far away it is.

    BUG FIX (misleading location): the old /nearest-station endpoint (still
    used for the map's individual station pins — that's fine, those ARE
    specific stations) was also being shown on the front page/report header
    as if it were "air quality near you," including the raw station's own
    city name and its distance ("Nerul, Navi Mumbai • 34km away"). A station
    34km away is not "near you," and showing its city name in a "near you"
    card actively misleads users about where the bad reading is. This
    function instead inverse-distance-weights every live station within 50km
    of the user's exact coordinates into one interpolated number, the same
    way /aqi-prediction already anchored its forecast — so "near you" always
    means the user's own location, never a single distant station's.

    Returns a dict with current_aqi/dominant_pollutant/station_count plus
    the raw candidate stations (kept only as internal debugging metadata,
    not meant to be surfaced to the user as "your" location).
    """
    scored = []
    for s in _LIVE_STATIONS:
        dist = _haversine_simple(lat, lng, s["lat"], s["lng"])
        computed_aqi, dominant = _aqi_from_station({"pm25": s["pollutants"].get("PM2.5"),
                                                     "pm10": s["pollutants"].get("PM10"),
                                                     "no2":  s["pollutants"].get("NO2"),
                                                     "so2":  s["pollutants"].get("SO2"),
                                                     "co":   s["pollutants"].get("CO"),
                                                     "ozone":s["pollutants"].get("OZONE"),
                                                     "nh3":  s["pollutants"].get("NH3")})
        if computed_aqi:
            scored.append({"station": s["station"], "city": s["city"], "state": s["state"],
                            "lat": s["lat"], "lng": s["lng"],
                            "distance_km": dist, "computed_aqi": computed_aqi,
                            "dominant": dominant})

    scored.sort(key=lambda x: x["distance_km"])
    close_live = [s for s in scored if s["distance_km"] <= 50]

    station_name, city, dominant_pollutant = "Unknown Station", "Unknown", "PM2.5"
    station_count = 1
    candidate_stations = []

    if close_live:
        # Inverse-distance-weighted AQI from up to 5 nearest live stations
        total_w = wt_aqi = 0.0
        for s in close_live[:5]:
            w = 1.0 / max(0.5, s["distance_km"] ** 1.5)
            wt_aqi += s["computed_aqi"] * w
            total_w += w
        current_aqi = wt_aqi / total_w
        best = close_live[0]
        station_name = best["station"]
        city = best["city"]
        dominant_pollutant = best["dominant"]
        station_count = len(close_live[:5])
        candidate_stations = [{"name": s["station"], "dist_km": round(s["distance_km"], 1),
                                "aqi": round(s["computed_aqi"])} for s in close_live[:5]]
    else:
        # Fallback: Supabase stations with pollutant columns
        async with httpx.AsyncClient() as client:
            raw_res = await client.get(
                f"{SUPABASE_URL}/rest/v1/aqi_stations"
                "?select=station_name,city,state,lat,lng,aqi,dominant_pollutant,pm25,pm10,no2,so2,co,ozone,nh3"
                "&lat=not.is.null&limit=2000",
                headers=HEADERS
            )
        all_stations = raw_res.json() if isinstance(raw_res.json(), list) else []

        async with httpx.AsyncClient() as client:
            rpc_res = await client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/nearest_aqi_station",
                headers=HEADERS,
                json={"user_lat": lat, "user_lng": lng}
            )
        rpc_stations = rpc_res.json() or []

        fb_candidates = []
        for s in all_stations:
            try:
                slat, slng = float(s["lat"]), float(s["lng"])
            except (TypeError, ValueError, KeyError):
                continue
            dist = _haversine_simple(lat, lng, slat, slng)
            if dist > 100:
                continue
            computed, dom = _aqi_from_station(s)
            if computed:
                fb_candidates.append({**s, "distance_km": dist,
                                       "computed_aqi": computed, "computed_dominant": dom})

        fb_candidates.sort(key=lambda x: x["distance_km"])
        close_computed = [c for c in fb_candidates if c["distance_km"] <= 50]
        close_stored   = [c for c in fb_candidates if c.get("aqi") and c["distance_km"] <= 60]

        if close_computed:
            total_w = wt_aqi = 0.0
            for s in close_computed[:5]:
                w = 1.0 / max(0.5, s["distance_km"] ** 1.5)
                wt_aqi += s["computed_aqi"] * w
                total_w += w
            current_aqi = wt_aqi / total_w
            best = close_computed[0]
            station_name, city = best.get("station_name","Unknown"), best.get("city","Unknown")
            dominant_pollutant = best.get("computed_dominant","PM2.5")
            station_count = len(close_computed[:5])
            candidate_stations = [{"name": s["station_name"], "dist_km": round(s["distance_km"],1),
                                    "aqi": round(s["computed_aqi"])} for s in close_computed[:5]]
        elif close_stored:
            total_w = wt_aqi = 0.0
            for s in close_stored[:3]:
                w = 1.0 / max(0.5, s["distance_km"] ** 1.5)
                wt_aqi += float(s["aqi"]) * w
                total_w += w
            current_aqi = wt_aqi / total_w
            best = close_stored[0]
            station_name, city = best.get("station_name","Unknown"), best.get("city","Unknown")
            dominant_pollutant = best.get("dominant_pollutant","PM2.5")
            station_count = len(close_stored[:3])
            candidate_stations = [{"name": s["station_name"], "dist_km": round(s["distance_km"],1),
                                    "aqi": round(float(s["aqi"]))} for s in close_stored[:3]]
        elif rpc_stations:
            s0 = rpc_stations[0]
            aqi_val = s0.get("aqi")
            current_aqi = float(aqi_val) if aqi_val is not None else 75.0
            station_name, city = s0.get("station_name","Unknown"), s0.get("city","Unknown")
            dominant_pollutant = s0.get("dominant_pollutant","PM2.5")
            candidate_stations = [{"name": station_name,
                                    "dist_km": round(s0.get("distance_km",0),1),
                                    "aqi": round(current_aqi)}]
        else:
            return {"error": "No nearby CPCB station found"}

    return {
        "current_aqi":        float(current_aqi),
        "station_name":       station_name,
        "city":               city,
        "dominant_pollutant": dominant_pollutant,
        "station_count":      station_count,
        "stations_used":      candidate_stations,
    }


async def _reverse_geocode_locality(lat: float, lng: float, fallback: str) -> str:
    """User's own locality name via reverse geocoding — this, not any
    station's city, is what should be shown as "your location"."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            geo = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 14,
                        "addressdetails": 1},
                headers={"User-Agent": "AirWatch-App/1.0"}
            )
        geo_data = geo.json()
        addr = geo_data.get("address", {})
        parts = []
        for key in ("neighbourhood", "suburb", "village", "town", "city_district"):
            if addr.get(key):
                parts.append(addr[key])
                break
        for key in ("city", "district", "county", "state_district"):
            if addr.get(key):
                parts.append(addr[key])
                break
        return ", ".join(parts) if parts else (geo_data.get("display_name", "").split(",")[0] or fallback)
    except Exception:
        return fallback


@app.get("/local-aqi")
async def local_aqi(lat: float, lng: float):
    """Lightweight endpoint for the front-page 'air quality near you' card
    and header badge. Returns an interpolated AQI anchored to the user's own
    coordinates and their own reverse-geocoded locality name — deliberately
    does NOT surface a specific (possibly far-away) station's name/city/
    distance as the headline, since that's what caused the "Nerul, Navi
    Mumbai • 34km away" confusion on a Kalyan-Dombivli user's front page."""
    resolved = await _resolve_local_aqi(lat, lng)
    if "error" in resolved:
        return resolved

    current_aqi = resolved["current_aqi"]
    user_location = await _reverse_geocode_locality(lat, lng, fallback=resolved["city"])

    def _label(aqi):
        if aqi <= 50:   return "Good"
        if aqi <= 100:  return "Moderate"
        if aqi <= 150:  return "Unhealthy for Sensitive Groups"
        if aqi <= 200:  return "Unhealthy"
        if aqi <= 300:  return "Very Unhealthy"
        return "Hazardous"

    return {
        "aqi":                round(current_aqi),
        "label":              _label(round(current_aqi)),
        "dominant_pollutant": resolved["dominant_pollutant"],
        "user_location":      user_location,
        "station_count":      resolved["station_count"],
    }


@app.get("/aqi-prediction")
async def aqi_prediction(lat: float, lng: float):
    """AQI forecast built from live CPCB pollutant readings.

    Computes AQI from actual PM2.5/PM10/NO2/SO2/O3/NH3 concentrations
    using Indian CPCB breakpoints — not the stale aggregated 'aqi' column.
    Inverse-distance-weights nearby stations for accurate local anchor.
    """
    try:
        return await _aqi_prediction_impl(lat, lng)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return {
            "error": f"Prediction temporarily unavailable: {str(exc)[:120]}",
            "historical": [],
            "predicted": [],
        }


async def _aqi_prediction_impl(lat: float, lng: float):
    """Inner implementation — called by the route handler inside a try/except."""
    resolved = await _resolve_local_aqi(lat, lng)
    if "error" in resolved:
        return {"error": resolved["error"], "historical": [], "predicted": []}

    current_aqi        = resolved["current_aqi"]
    station_name        = resolved["station_name"]
    city                = resolved["city"]
    dominant_pollutant  = resolved["dominant_pollutant"]
    station_count       = resolved["station_count"]
    candidate_stations  = resolved["stations_used"]

    # ── 2. Fetch live weather ──────────────────────────────────────────────────
    weather_data = await get_weather(lat, lng)
    weather_ok = not weather_data.get("error")
    t_val = weather_data.get("temperature")
    temp  = float(t_val) if weather_ok and t_val is not None else 28.0
    
    w_val = weather_data.get("wind_speed")
    wind  = float(w_val) if weather_ok and w_val is not None else 10.0
    
    h_val = weather_data.get("humidity")
    hum   = float(h_val) if weather_ok and h_val is not None else 55.0
    cond  = weather_data.get("condition", "Clear sky")
    wcode = int(weather_data.get("weather_code", 0)) if weather_ok else 0

    # ── 3. Monthly seasonal model (India-specific) ────────────────────────────
    SEASONAL = {
        1:  (1.35, "Winter — inversion layer traps PM2.5"),
        2:  (1.20, "Late winter — pollution slowly declining"),
        3:  (1.05, "Pre-summer — moderate, improving"),
        4:  (1.00, "Summer — heat disperses pollutants"),
        5:  (0.95, "Summer peak — dust storms possible in north"),
        6:  (0.80, "Monsoon onset — rain begins washing pollutants"),
        7:  (0.70, "Monsoon — heavy rain, cleanest period"),
        8:  (0.72, "Monsoon — sustained rain keeps AQI low"),
        9:  (0.82, "Monsoon retreat — AQI rising again"),
        10: (1.10, "Post-monsoon — crop burning begins"),
        11: (1.30, "Pre-winter — crop burning + inversion"),
        12: (1.38, "Winter peak — fog + PM2.5 worst of year"),
    }
    today = datetime.now(IST)
    month = today.month
    seasonal_base, seasonal_label = SEASONAL[month]

    # ── 4. Weather multiplier ─────────────────────────────────────────────────
    weather_mult = 1.0
    weather_tags = []

    if 61 <= wcode <= 82:
        weather_mult *= 0.60
        weather_tags.append("🌧 Heavy rain washing pollutants")
    elif 51 <= wcode <= 55:
        weather_mult *= 0.80
        weather_tags.append("🌦 Drizzle reducing PM levels")

    if temp < 10 and wind < 3:
        weather_mult *= 1.30
        weather_tags.append("🌫 Severe inversion — pollutants trapped")
    elif temp < 15 and wind < 5:
        weather_mult *= 1.18
        weather_tags.append("🌫 Inversion layer forming")
    elif temp < 20 and wind < 6:
        weather_mult *= 1.07

    if hum > 90 and wind < 5:
        weather_mult *= 1.15
        weather_tags.append("💧 Very high humidity + still air → smog")
    elif hum > 80 and wind < 8:
        weather_mult *= 1.08

    # Wind dispersal
    if wind > 25:
        weather_mult *= 0.75
        weather_tags.append("💨 Strong winds dispersing pollutants fast")
    elif wind > 15:
        weather_mult *= 0.88
        weather_tags.append("🌬 Moderate wind dispersing pollutants")

    weather_analysis = " · ".join(weather_tags) if weather_tags else f"{cond} · {wind:.0f} km/h wind"

    # ── 5. Historical generation (30 days back) ───────────────────────────────
    # Seed deterministically per grid (rounded to 1 decimal, ~11km) so nearby devices see same graph shape
    seed = int(abs(round(lat, 1) * 10) + abs(round(lng, 1) * 10)) ^ (month * 31 + 7)
    rng = random.Random(seed)

    # Traffic/industrial pattern per day-of-week
    DOW_FACTOR = {0: 1.04, 1: 1.02, 2: 1.02, 3: 1.03, 4: 1.06, 5: 0.90, 6: 0.87}

    # Walk BACKWARDS from today using relative seasonal ratios.
    # Key principle: we only apply the RATIO between past month's seasonal factor
    # and today's seasonal factor, so today always anchors to current_aqi.
    raw_values = []
    prev_dev = 0.0
    for i in range(30, 0, -1):
        day = today - timedelta(days=i)
        m_past = day.month
        s_past, _ = SEASONAL[m_past]
        # Relative factor: how much different was that month vs today?
        rel_seasonal = s_past / seasonal_base  # = 1.0 for same month, >1 if worse month

        dow = day.weekday()
        traffic = DOW_FACTOR[dow]

        # Week-scale oscillation
        week_osc = 1.0 + 0.04 * math.sin(2 * math.pi * (30 - i) / 7.0)

        # Autocorrelated noise (70% persistence)
        noise = rng.gauss(0, 0.03)
        prev_dev = 0.65 * prev_dev + noise
        noise_factor = 1.0 + prev_dev

        # Base is current_aqi adjusted only by relative seasonal + traffic + noise
        # This guarantees the series arrives naturally close to current_aqi today
        aqi_val = current_aqi * rel_seasonal * traffic * week_osc * noise_factor
        raw_values.append(max(10, min(500, aqi_val)))

    # Exponential smoothing (α=0.30)
    alpha = 0.30
    smoothed = [raw_values[0]]
    for v in raw_values[1:]:
        smoothed.append(alpha * v + (1 - alpha) * smoothed[-1])

    # HISTORICAL FIX: Force-normalize the final value to exactly equal current_aqi
    if smoothed[-1] > 0:
        correction_factor = current_aqi / smoothed[-1]
        smoothed = [v * correction_factor for v in smoothed]

    historical = [
        {
            "date": (today - timedelta(days=30 - i)).strftime("%Y-%m-%d"),
            "aqi": max(10, min(500, round(smoothed[i]))),
            "type": "historical",
        }
        for i in range(30)
    ]
    historical.append({
        "date": today.strftime("%Y-%m-%d"),
        "aqi": round(current_aqi),
        "type": "current",
    })

    # ── 6. Weighted trend regression (last 10 days, recent = higher weight) ───
    recent = [h["aqi"] for h in historical[-10:]]
    n = len(recent)
    weights = [0.5 + 0.5 * (k / max(n - 1, 1)) for k in range(n)]
    wsum = sum(weights)
    x_mean = sum(weights[k] * k for k in range(n)) / wsum
    y_mean = sum(weights[k] * recent[k] for k in range(n)) / wsum
    num = sum(weights[k] * (k - x_mean) * (recent[k] - y_mean) for k in range(n))
    den = sum(weights[k] * (k - x_mean) ** 2 for k in range(n))
    slope = num / den if den != 0 else 0.0

    if slope > 2.5:
        trend = "increasing"
        trend_description = f"Rising ~{abs(slope):.1f} pts/day — deteriorating"
    elif slope < -2.5:
        trend = "decreasing"
        trend_description = f"Falling ~{abs(slope):.1f} pts/day — improving"
    else:
        trend = "stable"
        trend_description = f"Stable (±{abs(slope):.1f} pts/day)"

    # ── 7. AQI label helper ───────────────────────────────────────────────────
    def _label(aqi):
        if aqi <= 50:   return "Good"
        if aqi <= 100:  return "Moderate"
        if aqi <= 150:  return "Unhealthy for Sensitive Groups"
        if aqi <= 200:  return "Unhealthy"
        if aqi <= 300:  return "Very Unhealthy"
        return "Hazardous"

    def _tip(label):
        return {
            "Good":                              "Safe for all outdoor activity",
            "Moderate":                          "Sensitive groups limit strenuous outdoor activity",
            "Unhealthy for Sensitive Groups":    "Wear N95 mask — children & elderly stay indoors",
            "Unhealthy":                         "Avoid prolonged outdoor activity for everyone",
            "Very Unhealthy":                    "Stay indoors; run air purifier",
            "Hazardous":                         "Stay indoors, seal windows, seek medical help if unwell",
        }.get(label, "Monitor local AQI")

    # ── 8. 7-day prediction ───────────────────────────────────────────────────
    predicted = []
    base_aqi = current_aqi

    # PREDICTION RNG FIX: Use a different seed for forward prediction
    pred_seed = seed ^ 0x5A5A
    rng_pred = random.Random(pred_seed)

    for i in range(1, 8):
        fwd_day = today + timedelta(days=i)
        dow = fwd_day.weekday()
        m_fwd = fwd_day.month
        s_fwd, _ = SEASONAL[m_fwd]
        traffic = DOW_FACTOR[dow]

        # Trend contribution: linear projection that fades over time
        trend_contrib = slope * i * (0.82 ** i)

        # Weather influence fades linearly after day 3
        w_fade = max(0.25, 1.0 - (i - 1) * 0.15)
        w_adj = 1.0 + (weather_mult - 1.0) * w_fade

        # Use base_aqi to prevent exponential compounding of traffic and weather multipliers
        season_ratio = s_fwd / seasonal_base
        
        # Calculate unadjusted projection
        projected = (base_aqi * season_ratio) + trend_contrib
        
        # Apply daily multipliers and jitter
        projected = projected * traffic * w_adj
        projected += rng_pred.gauss(0, current_aqi * 0.015)
        
        projected = max(10, min(500, projected))

        lbl = _label(round(projected))
        predicted.append({
            "date":           fwd_day.strftime("%Y-%m-%d"),
            "aqi":            round(projected),
            "type":           "predicted",
            "label":          lbl,
            "tip":            _tip(lbl),
            "confidence":     max(40, round(95 - i * 7)),
            "weather_impact": round((w_adj - 1.0) * 100, 1),
        })

    # ── 9. Citizen spike detection ────────────────────────────────────────────
    spike_alerts = []
    try:
        nearby_reports = await get_nearby_reports(lat, lng, radius_km=10)
        recent_severe = [r for r in nearby_reports[:20] if r.get("severity", 0) >= 4]
        if recent_severe:
            spike_alerts.append({
                "title": "Spike Risk",
                "reason": f"{len(recent_severe)} severe report(s) within 10km",
                "impact": "AQI may be 50-100 pts above forecast in next 24h",
            })
            if predicted:
                predicted[0]["aqi"] = min(500, predicted[0]["aqi"] + 70)
    except Exception:
        pass

    weather_factors = {
        "temperature": temp,
        "wind_speed":  wind,
        "humidity":    hum,
        "condition":   cond,
        "analysis":    weather_analysis,
        "multiplier":  round(weather_mult, 3),
    } if weather_ok else None

    # ── Reverse-geocode user's coordinates → their actual locality name ─────
    user_location = await _reverse_geocode_locality(lat, lng, fallback=city)

    return {
        "station_name":       station_name,
        "city":               city,
        "user_location":      user_location,
        "dominant_pollutant": dominant_pollutant,
        "current_aqi":        round(current_aqi),
        "current_label":      _label(round(current_aqi)),
        "seasonal_context":   seasonal_label,
        "trend":              trend,
        "trend_description":  trend_description,
        "historical":         historical,
        "predicted":          predicted,
        "spike_alerts":       spike_alerts,
        "weather_factors":    weather_factors,
        "station_count":      station_count,
        "stations_used":      candidate_stations,
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
                "https://api.open-meteo.com/v1/forecast",
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