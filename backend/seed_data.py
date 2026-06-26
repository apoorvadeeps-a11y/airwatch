import pandas as pd
import os
import glob

# ── City coordinates lookup ──────────────────────────────────────────────────
CITY_COORDS = {
    "Tirupati": (13.6288, 79.4192), "Vijayawada": (16.5062, 80.6480),
    "Visakhapatnam": (17.6868, 83.2185), "Rajamahendravaram": (17.0005, 81.8040),
    "Amaravati": (16.5130, 80.5157), "Anantapur": (14.6819, 77.6006),
    "Chittoor": (13.2172, 79.1003), "Kadapa": (14.4674, 78.8241),
    "Guwahati": (26.1445, 91.7362), "Sivasagar": (26.9833, 94.6333),
    "Nalbari": (26.4448, 91.4357), "Patna": (25.5941, 85.1376),
    "Muzaffarpur": (26.1209, 85.3647), "Gaya": (24.7914, 85.0002),
    "Bhagalpur": (25.2425, 86.9842), "Chandigarh": (30.7333, 76.7794),
    "Raipur": (21.2514, 81.6296), "Bhilai": (21.1938, 81.3509),
    "Korba": (22.3595, 82.7501), "Delhi": (28.6139, 77.2090),
    "Faridabad": (28.4089, 77.3178), "Gurgaon": (28.4595, 77.0266),
    "Panaji": (15.4909, 73.8278), "Ahmedabad": (23.0225, 72.5714),
    "Surat": (21.1702, 72.8311), "Vadodara": (22.3072, 73.1812),
    "Rajkot": (22.3039, 70.8022), "Gandhinagar": (23.2156, 72.6369),
    "Ambala": (30.3752, 76.7821), "Faridabad": (28.4089, 77.3178),
    "Shimla": (31.1048, 77.1734), "Dharamshala": (32.2190, 76.3234),
    "Jammu": (32.7266, 74.8570), "Ranchi": (23.3441, 85.3096),
    "Dhanbad": (23.7957, 86.4304), "Bengaluru": (12.9716, 77.5946),
    "Mysuru": (12.2958, 76.6394), "Hubli": (15.3647, 75.1240),
    "Mangaluru": (12.9141, 74.8560), "Kochi": (9.9312, 76.2673),
    "Thiruvananthapuram": (8.5241, 76.9366), "Kozhikode": (11.2588, 75.7804),
    "Bhopal": (23.2599, 77.4126), "Indore": (22.7196, 75.8577),
    "Jabalpur": (23.1815, 79.9864), "Gwalior": (26.2183, 78.1828),
    "Mumbai": (19.0760, 72.8777), "Pune": (18.5204, 73.8567),
    "Nagpur": (21.1458, 79.0882), "Nashik": (19.9975, 73.7898),
    "Aurangabad": (19.8762, 75.3433), "Imphal": (24.8170, 93.9368),
    "Shillong": (25.5788, 91.8933), "Aizawl": (23.7307, 92.7173),
    "Kohima": (25.6751, 94.1086), "Bhubaneswar": (20.2961, 85.8245),
    "Cuttack": (20.4625, 85.8830), "Talcher": (20.9500, 85.2333),
    "Ludhiana": (30.9010, 75.8573), "Amritsar": (31.6340, 74.8723),
    "Jalandhar": (31.3260, 75.5762), "Jaipur": (26.9124, 75.7873),
    "Jodhpur": (26.2389, 73.0243), "Kota": (25.2138, 75.8648),
    "Udaipur": (24.5854, 73.7125), "Gangtok": (27.3314, 88.6138),
    "Chennai": (13.0827, 80.2707), "Coimbatore": (11.0168, 76.9558),
    "Madurai": (9.9252, 78.1198), "Tiruchirappalli": (10.7905, 78.7047),
    "Hyderabad": (17.3850, 78.4867), "Warangal": (17.9784, 79.5941),
    "Agartala": (23.8315, 91.2868), "Lucknow": (26.8467, 80.9462),
    "Kanpur": (26.4499, 80.3319), "Agra": (27.1767, 78.0081),
    "Varanasi": (25.3176, 82.9739), "Allahabad": (25.4358, 81.8463),
    "Dehradun": (30.3165, 78.0322), "Haridwar": (29.9457, 78.1642),
    "Kolkata": (22.5726, 88.3639), "Howrah": (22.5958, 88.2636),
    "Asansol": (23.6889, 86.9661), "Durgapur": (23.5204, 87.3119),
    "Naharlagu": (27.1000, 93.7167),
}

def get_coords(city):
    for key, coords in CITY_COORDS.items():
        if key.lower() in str(city).lower() or str(city).lower() in key.lower():
            return coords
    return (None, None)

def compute_aqi_from_pm25(pm25):
    """Standard AQI breakpoints for PM2.5 (India/US EPA)"""
    if pd.isna(pm25) or pm25 < 0:
        return None
    breakpoints = [
        (0, 12.0, 0, 50), (12.1, 35.4, 51, 100),
        (35.5, 55.4, 101, 150), (55.5, 150.4, 151, 200),
        (150.5, 250.4, 201, 300), (250.5, 350.4, 301, 400),
        (350.5, 500.4, 401, 500),
    ]
    for c_low, c_high, i_low, i_high in breakpoints:
        if c_low <= pm25 <= c_high:
            return round(((i_high - i_low) / (c_high - c_low)) * (pm25 - c_low) + i_low)
    return 500

def dominant_pollutant(row):
    pollutants = {
        "PM2.5": row.get("PM2.5_avg"),
        "PM10": row.get("PM10_avg"),
        "NO2": row.get("NO2_avg"),
        "SO2": row.get("SO2_avg"),
        "CO": row.get("CO_avg"),
        "Ozone": row.get("Ozone_avg"),
    }
    pollutants = {k: v for k, v in pollutants.items() if pd.notna(v) and v > 0}
    return max(pollutants, key=pollutants.get) if pollutants else "PM2.5"

# ── Load station metadata ─────────────────────────────────────────────────────
DATA_DIR = r"C:\Users\Admin\Downloads\air_quality_data"
stations_info = pd.read_csv(os.path.join(DATA_DIR, "stations_info.csv"))
stations_info.columns = stations_info.columns.str.strip()
print(f"Loaded {len(stations_info)} stations from metadata")

# ── Process each station CSV ──────────────────────────────────────────────────
results = []
csv_files = glob.glob(os.path.join(DATA_DIR, "*.csv"))
csv_files = [f for f in csv_files if "stations_info" not in f]

print(f"Processing {len(csv_files)} station files...")

for filepath in csv_files:
    file_name = os.path.basename(filepath).replace(".csv", "")
    
    # Get metadata for this station
    meta = stations_info[stations_info["file_name"] == file_name]
    if meta.empty:
        continue
    meta = meta.iloc[0]
    
    try:
        df = pd.read_csv(filepath)
        df.columns = df.columns.str.strip()
        
        # Parse dates - use From Date
        date_col = [c for c in df.columns if "From" in c or "from" in c or "Date" in c]
        if not date_col:
            continue
        df["date"] = pd.to_datetime(df[date_col[0]], dayfirst=True, errors="coerce")
        df = df.dropna(subset=["date"])
        
        # Take last 90 days of data
        latest = df["date"].max()
        recent = df[df["date"] >= latest - pd.Timedelta(days=90)]
        
        if recent.empty:
            recent = df.tail(30)
        
        # Map column names flexibly
        col_map = {}
        for col in df.columns:
            cu = col.upper()
            if "PM2.5" in cu or "PM25" in cu:
                col_map["PM2.5_avg"] = col
            elif "PM10" in cu and "PM2" not in cu:
                col_map["PM10_avg"] = col
            elif col.strip() == "NO2":
                col_map["NO2_avg"] = col
            elif col.strip() == "SO2":
                col_map["SO2_avg"] = col
            elif col.strip() == "CO":
                col_map["CO_avg"] = col
            elif "OZONE" in cu or col.strip() == "Ozone":
                col_map["Ozone_avg"] = col
        
        row = {"file_name": file_name}
        for target, source in col_map.items():
            row[target] = pd.to_numeric(recent[source], errors="coerce").mean()
        
        row["recorded_at"] = latest.strftime("%Y-%m-%d")
        results.append(row)
        
    except Exception as e:
        print(f"Skipping {file_name}: {e}")

print(f"Processed {len(results)} stations successfully")

# ── Merge with metadata + compute AQI ────────────────────────────────────────
results_df = pd.DataFrame(results)
merged = results_df.merge(stations_info[["file_name", "state", "city", "station_location"]], 
                          on="file_name", how="left")

merged["aqi"] = merged["PM2.5_avg"].apply(compute_aqi_from_pm25)
merged["dominant_pollutant"] = merged.apply(dominant_pollutant, axis=1)

# Add coordinates
coords = merged["city"].apply(get_coords)
merged["lat"] = coords.apply(lambda x: x[0])
merged["lng"] = coords.apply(lambda x: x[1])

# Drop rows with no AQI or no coords
merged = merged.dropna(subset=["aqi"])
print(f"Rows with AQI: {len(merged)}")
print(f"Rows with coordinates: {merged.dropna(subset=['lat','lng']).shape[0]}")

# ── Final output ──────────────────────────────────────────────────────────────
# Only keep columns that actually exist
possible_cols = ["file_name", "station_location", "city", "state",
    "lat", "lng", "aqi", "dominant_pollutant",
    "PM2.5_avg", "PM10_avg", "NO2_avg", "SO2_avg", "CO_avg", "Ozone_avg",
    "recorded_at"]
existing_cols = [c for c in possible_cols if c in merged.columns]
final = merged[existing_cols].copy()

rename_map = {
    "file_name": "station_code",
    "station_location": "station_name",
    "PM2.5_avg": "pm25",
    "PM10_avg": "pm10",
    "NO2_avg": "no2",
    "SO2_avg": "so2",
    "CO_avg": "co",
    "Ozone_avg": "ozone",
}
final = final.rename(columns={k: v for k, v in rename_map.items() if k in final.columns})

output_path = os.path.join(DATA_DIR, "aqi_stations_clean.csv")
final.to_csv(output_path, index=False)
print(f"\nDone! Saved to: {output_path}")
print(f"Total stations: {len(final)}")
print(f"\nSample output:")
print(final.head(3).to_string())