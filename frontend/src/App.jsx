import { useState, useRef, useEffect } from "react";

const TABS = ["Report", "Map", "Alerts"];
const API = "https://airwatch-yb3c.onrender.com";

const SEVERITY_COLORS = {
  1: { bg: "bg-green-900", text: "text-green-300", border: "border-green-700", label: "Good" },
  2: { bg: "bg-yellow-900", text: "text-yellow-300", border: "border-yellow-700", label: "Moderate" },
  3: { bg: "bg-orange-900", text: "text-orange-300", border: "border-orange-700", label: "Unhealthy" },
  4: { bg: "bg-red-900", text: "text-red-300", border: "border-red-700", label: "Hazardous" },
  5: { bg: "bg-purple-900", text: "text-purple-300", border: "border-purple-700", label: "Emergency" },
};

function aqiColor(aqi) {
  if (aqi <= 50) return "#00e400";
  if (aqi <= 100) return "#ffff00";
  if (aqi <= 150) return "#ff7e00";
  if (aqi <= 200) return "#ff0000";
  if (aqi <= 300) return "#8f3f97";
  return "#7e0023";
}

function aqiLabel(aqi) {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

function LocalAQICard({ station }) {
  if (!station) return null;
  const aqi = Math.round(station.aqi);
  const color = aqiColor(aqi);
  const label = aqiLabel(aqi);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-5 flex items-center gap-5">
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center flex-shrink-0 text-2xl font-bold text-gray-950"
        style={{ backgroundColor: color }}
      >
        {aqi}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-1">Air quality near you</p>
        <p className="text-lg font-bold text-white">{label}</p>
        <p className="text-xs text-gray-400 mt-1 truncate">
          {station.station_name} · {Math.round(station.distance_km)}km away
        </p>
        <p className="text-xs text-gray-500">{station.city}, {station.state} · {station.dominant_pollutant}</p>
      </div>
    </div>
  );
}

function MapTab({ userLat, userLng, onLocationDetected }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const [mapReady, setMapReady] = useState(false);
  const [stations, setStations] = useState([]);
  const [reports, setReports] = useState([]);
  const [nearestStation, setNearestStation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [localLat, setLocalLat] = useState(userLat);
  const [localLng, setLocalLng] = useState(userLng);

  useEffect(() => {
    setLocalLat(userLat);
    setLocalLng(userLng);
  }, [userLat, userLng]);

  useEffect(() => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if (!window.L) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => setMapReady(true);
      document.head.appendChild(script);
    } else {
      setMapReady(true);
    }
    fetch(`${API}/stations`)
      .then((r) => r.json())
      .then((data) => setStations(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!localLat || !localLng) return;
    fetch(`${API}/nearest-station?lat=${localLat}&lng=${localLng}`)
      .then((r) => r.json())
      .then(setNearestStation)
      .catch(() => {});
    fetch(`${API}/reports/nearby?lat=${localLat}&lng=${localLng}&radius_km=15`)
      .then((r) => r.json())
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [localLat, localLng]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    const center = localLat && localLng ? [localLat, localLng] : [20.5937, 78.9629];
    const zoom = localLat && localLng ? 11 : 5;
    const map = L.map(mapRef.current).setView(center, zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    mapInstanceRef.current = map;
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !localLat || !localLng) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    map.setView([localLat, localLng], 11);

    const userMarker = L.circleMarker([localLat, localLng], {
      radius: 10, fillColor: "#3b82f6", color: "#fff", weight: 2, fillOpacity: 1,
    }).addTo(map).bindPopup("<b>📍 Your location</b>");
    markersRef.current.push(userMarker);

    stations.forEach((s) => {
      if (!s.lat || !s.lng) return;
      const dist = Math.sqrt((s.lat - localLat) ** 2 + (s.lng - localLng) ** 2) * 111;
      if (dist > 100) return;
      const aqi = s.aqi || 0;
      const color = aqiColor(aqi);
      const circle = L.circleMarker([s.lat, s.lng], {
        radius: 12, fillColor: color, color: "#fff", weight: 1, fillOpacity: 0.85,
      }).addTo(map);
      circle.bindPopup(`
        <div style="font-family:sans-serif;min-width:160px">
          <b>🏛️ ${s.station_name}</b><br/>
          <span style="color:#666">${s.city}, ${s.state}</span><br/>
          <span style="font-size:20px;font-weight:bold;color:${color}">${Math.round(aqi)}</span>
          <span style="color:#666"> AQI</span><br/>
          <small>Dominant: ${s.dominant_pollutant || "PM10"}</small><br/>
          <small style="color:#999">${Math.round(dist)}km from you</small>
        </div>
      `);
      markersRef.current.push(circle);
    });

    reports.forEach((r) => {
      if (!r.lat || !r.lng) return;
      const severity = r.severity || 3;
      const colors = ["", "#00e400", "#ffff00", "#ff7e00", "#ff0000", "#8f3f97"];
      const color = colors[severity] || "#ff7e00";
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 8, fillColor: color, color: "#fff", weight: 1, fillOpacity: 0.9, dashArray: "4",
      }).addTo(map);
      let analysis = {};
      try { analysis = JSON.parse(r.gemini_analysis || "{}"); } catch {}
      marker.bindPopup(`
        <div style="font-family:sans-serif;min-width:160px">
          <b>👤 Citizen Report</b><br/>
          <span style="color:#666">${r.location || "Unknown location"}</span><br/>
          <span style="font-weight:bold;color:${color}">Severity ${severity}/5</span><br/>
          <small>${(r.text || "").slice(0, 80)}...</small><br/>
          ${analysis.advisory ? `<small style="color:#888">💡 ${analysis.advisory}</small>` : ""}
        </div>
      `);
      markersRef.current.push(marker);
    });
  }, [mapReady, localLat, localLng, stations, reports]);

  function detectLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        setLocalLat(la);
        setLocalLng(lo);
        onLocationDetected(la, lo);
        setLocating(false);
      },
      () => setLocating(false)
    );
  }

  return (
    <div className="space-y-4">
      {!localLat && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 text-center space-y-3">
          <p className="text-2xl">📍</p>
          <p className="text-sm text-gray-300 font-medium">Share your location to see local air quality</p>
          <p className="text-xs text-gray-500">We'll show AQI data and citizen reports within 15km of you</p>
          <button
            onClick={detectLocation}
            disabled={locating}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {locating ? "Detecting..." : "Detect My Location"}
          </button>
        </div>
      )}

      {nearestStation && <LocalAQICard station={nearestStation} />}

 {localLat && (
  <div className="flex items-center justify-between">
    <div className="flex gap-3 text-xs">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> You</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-orange-500 inline-block" /> CPCB Station</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full inline-block" style={{background:"#ff7e00"}} /> Citizen Report</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">{reports.length} reports nearby</span>
      <button
        onClick={detectLocation}
        disabled={locating}
        className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
      >
        {locating ? "..." : "📍 Refresh"}
      </button>
    </div>
  </div>
)}

      <div className="flex gap-2 flex-wrap text-xs">
        {[
          { color: "#00e400", label: "Good" },
          { color: "#ffff00", label: "Moderate" },
          { color: "#ff7e00", label: "Unhealthy" },
          { color: "#ff0000", label: "Very Unhealthy" },
          { color: "#8f3f97", label: "Hazardous" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-gray-400">{item.label}</span>
          </div>
        ))}
      </div>

      <div
        ref={mapRef}
        className="rounded-lg overflow-hidden border border-gray-700"
        style={{ height: "460px", width: "100%" }}
      />
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("Report");
  const [text, setText] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locationDisplay, setLocationDisplay] = useState("");
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userLat, setUserLat] = useState(null);
  const [userLng, setUserLng] = useState(null);
  const [nearestStation, setNearestStation] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const la = pos.coords.latitude;
          const lo = pos.coords.longitude;
          setUserLat(la);
          setUserLng(lo);
          setLat(la.toFixed(5));
          setLng(lo.toFixed(5));
          setLocationDisplay(`${la.toFixed(5)}, ${lo.toFixed(5)}`);
          fetch(`${API}/nearest-station?lat=${la}&lng=${lo}`)
            .then((r) => r.json())
            .then(setNearestStation)
            .catch(() => {});
        },
        () => {}
      );
    }
  }, []);

  function handleLocationDetected(la, lo) {
    setUserLat(la);
    setUserLng(lo);
    setLat(la.toFixed(5));
    setLng(lo.toFixed(5));
    setLocationDisplay(`${la.toFixed(5)}, ${lo.toFixed(5)}`);
  }

  function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function handleLocation() {
    if (!navigator.geolocation) { setError("Geolocation not supported."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude.toFixed(5);
        const lo = pos.coords.longitude.toFixed(5);
        setLat(la); setLng(lo);
        setLocationDisplay(`${la}, ${lo}`);
        setUserLat(parseFloat(la));
        setUserLng(parseFloat(lo));
      },
      (err) => setError(`Location denied (code ${err.code}). Allow it in browser settings.`)
    );
  }

  function handleLocationInput(val) {
    setLocationDisplay(val);
    const parts = val.split(",").map((s) => s.trim());
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      setLat(parts[0]);
      setLng(parts[1]);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!text) { setError("Description is required."); return; }
    if (!lat || !lng) { setError("Location is required — click Detect or type lat, lng."); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("text", text);
      fd.append("lat", lat);
      fd.append("lng", lng);
      fd.append("location", locationDisplay);
      if (photo) fd.append("photo", photo);
      const res = await fetch(`${API}/report`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(`Submit failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const severity = result?.analysis?.severity;
  const severityStyle = SEVERITY_COLORS[severity] || SEVERITY_COLORS[3];

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">🌿 AirWatch</h1>
          <p className="text-xs text-gray-400">Neighbourhood Air Quality Tracker</p>
        </div>
        {nearestStation && (
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-gray-950"
              style={{ backgroundColor: aqiColor(nearestStation.aqi) }}
            >
              {Math.round(nearestStation.aqi)}
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium text-white">{aqiLabel(nearestStation.aqi)}</p>
              <p className="text-xs text-gray-400">{nearestStation.city}</p>
            </div>
          </div>
        )}
      </header>

      <nav className="flex border-b border-gray-800 px-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-emerald-400 text-emerald-400" : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {tab === "Report" && (
          <>
            {nearestStation && <LocalAQICard station={nearestStation} />}

            <div className="space-y-2">
              <label className="text-sm text-gray-300 font-medium">Describe what you see</label>
              <textarea
                rows={4}
                placeholder="e.g. Black smoke from garbage dump near Hiranandani circle..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm resize-none focus:outline-none focus:border-emerald-500 placeholder-gray-600"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-300 font-medium">Attach a photo</label>
              <div
                onClick={() => fileRef.current.click()}
                className="border-2 border-dashed border-gray-700 rounded-lg p-6 flex flex-col items-center gap-2 cursor-pointer hover:border-emerald-600 transition-colors"
              >
                {preview ? (
                  <img src={preview} alt="preview" className="max-h-48 rounded-md object-cover" />
                ) : (
                  <>
                    <span className="text-3xl">📷</span>
                    <p className="text-sm text-gray-400">Click to upload a photo</p>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-300 font-medium">Location</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Auto-detect or type: 19.01234, 72.85432"
                  value={locationDisplay}
                  onChange={(e) => handleLocationInput(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder-gray-600"
                />
                <button
                  onClick={handleLocation}
                  className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-2 text-sm transition-colors"
                >
                  📍 Detect
                </button>
              </div>
              {lat && lng && (
                <p className="text-xs text-emerald-500">✓ Coordinates locked: {lat}, {lng}</p>
              )}
            </div>

            {error && (
              <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? "Analysing..." : "Submit Report"}
            </button>

            {result && (
              <div className={`${severityStyle.bg} border ${severityStyle.border} rounded-lg px-5 py-4 space-y-3`}>
                <p className={`font-semibold ${severityStyle.text}`}>
                  ✓ Report submitted — Severity {severity}/5 ({severityStyle.label})
                </p>
                {result.analysis?.summary && (
                  <p className="text-sm text-gray-300">{result.analysis.summary}</p>
                )}
                {result.analysis?.advisory && (
                  <p className="text-sm text-gray-400 italic">💡 {result.analysis.advisory}</p>
                )}
                {result.station && (
                  <p className="text-xs text-gray-500">
                    Nearest station: {result.station.station_name} — AQI {result.station.aqi} ({Math.round(result.station.distance_km)}km away)
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {tab === "Map" && (
          <MapTab userLat={userLat} userLng={userLng} onLocationDetected={handleLocationDetected} />
        )}

        {tab === "Alerts" && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg h-32 flex items-center justify-center text-gray-500 text-sm">
            🔔 Alert feed — coming soon
          </div>
        )}
      </main>
    </div>
  );
}