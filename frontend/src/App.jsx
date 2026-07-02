import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Cloud, Thermometer, Wind, Volume2, Globe, Send, AlertTriangle, Info, TrendingUp, TrendingDown, Minus, Calendar, MapPin, Activity, Camera, Leaf, Shield, CheckCircle, Zap, Factory } from "lucide-react";

const TABS = ["Report", "Prediction", "Map", "Alerts", "Chat", "Municipal"];

function resolveApiBase() {
  const custom = localStorage.getItem('airwatch_api_url');
  if (custom) return custom.replace(/\/$/, "");
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL.replace(/\/$/, "");
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:8000`;
}

const API = resolveApiBase();

// #region agent log
function agentLog(location, message, data, hypothesisId) {
  const payload = { sessionId: "d825a9", location, message, data, timestamp: Date.now(), hypothesisId };
  fetch(`${window.location.protocol}//${window.location.hostname}:8000/debug-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
// #endregion

const TRANSLATIONS = {
  en: {
    title: "AirWatch", sub: "Neighbourhood Air Quality Tracker", describe: "Describe what you see", photo: "Attach a photo", location: "Location", submit: "Submit Report", dictate: "Dictate", listening: "Listening...", loading: "Analysing...", report: "Report", prediction: "Prediction", map: "Map", alerts: "Alerts", chat: "Chat", municipal: "Municipal",
    weatherContext: "Local Weather", humidity: "Humidity", wind: "Wind",
    mapTabShareLoc: "Share your location to see local air quality",
    mapTabDetecting: "Detecting...", mapTabDetect: "Detect My Location",
    mapTabReportsNearby: "reports nearby", mapTabRefresh: "Refresh",
    alertsTabLocReq: "Location Required for Alerts",
    alertsTabLocReqDesc: "Please detect your location in the Report tab first to view nearby alerts.",
    alertsTabGoToReport: "Go to Report Tab", alertsTabScanning: "Scanning for local alerts...",
    alertsTabNoAlerts: "No Severe Alerts Nearby",
    alertsTabStable: "Air quality in your 25km radius looks stable.",
    alertsTabLocalAlerts: "Local Severe Pollution Alerts",
    chatTabIntro: "Hello! I'm your AirWatch AI assistant. How can I help you understand your local air quality or pollution health risks today?",
    chatTabExpert: "AirWatch AI Expert", chatTabAskContext: "Ask about pollution, health risks, or local data",
    chatTabInputPlace: "Ask a question...", chatTabConnError: "Sorry, I'm having trouble connecting to the server. Please try again later.",
    aqiPredLocReq: "Location Required for Prediction",
    aqiPredLocReqDesc: "To provide an accurate AQI prediction, we need to know your coordinates. Please go to the Report tab and detect your location first.",
    aqiPredTitle: "AQI Prediction — Localized for", aqiPredSeasonal: "Seasonal context:", aqiPredLoading: "Loading AQI prediction data...",
    municipalDashboard: "Municipal Dispatch Dashboard", activeHotspots: "Active Severe Hotspots",
    deployCannon: "Deploy Water-Mist Cannon", dispatchCrew: "Dispatch Cleanup Crew",
    recentDispatches: "Recent Dispatches", noHotspots: "No severe hotspots currently.",
    lowConnTitle: "No internet?", lowConnDesc: "Report via WhatsApp: Send 'SMOKE [location]' to +91-98765-43210",
    mapTabShowAqi: "We'll show AQI data and citizen reports within 15km of you",
    mapTabYourLoc: "Your location"
  },
  hi: {
    title: "AirWatch", sub: "पड़ोस की वायु गुणवत्ता ट्रैकर", describe: "आप जो देखते हैं उसका वर्णन करें", photo: "एक फोटो संलग्न करें", location: "स्थान", submit: "रिपोर्ट जमा करें", dictate: "बोलें", listening: "सुन रहा हूँ...", loading: "विश्लेषण कर रहा है...", report: "रिपोर्ट", prediction: "भविष्यवाणी", map: "नक्शा", alerts: "चेतावनी", chat: "चैट", municipal: "नगर पालिका",
    weatherContext: "स्थानीय मौसम", humidity: "नमी", wind: "हवा",
    mapTabShareLoc: "स्थानीय वायु गुणवत्ता देखने के लिए अपना स्थान साझा करें",
    mapTabDetecting: "पता लगाया जा रहा है...", mapTabDetect: "मेरा स्थान जांचें",
    mapTabReportsNearby: "आसपास की रिपोर्टें", mapTabRefresh: "ताज़ा करें",
    alertsTabLocReq: "चेतावनी के लिए स्थान आवश्यक है",
    alertsTabLocReqDesc: "आसपास की चेतावनियों को देखने के लिए कृपया पहले रिपोर्ट टैब में अपने स्थान का पता लगाएं।",
    alertsTabGoToReport: "रिपोर्ट टैब पर जाएं", alertsTabScanning: "स्थानीय चेतावनियों के लिए स्कैन किया जा रहा है...",
    alertsTabNoAlerts: "आसपास कोई गंभीर चेतावनी नहीं",
    alertsTabStable: "आपके 25 किमी के दायरे में वायु गुणवत्ता स्थिर दिख रही है।",
    alertsTabLocalAlerts: "स्थानीय गंभीर प्रदूषण चेतावनियाँ",
    chatTabIntro: "नमस्ते! मैं आपका एयरवाच एआई सहायक हूं। आज मैं आपकी स्थानीय वायु गुणवत्ता या प्रदूषण के स्वास्थ्य जोखिमों को समझने में आपकी कैसे मदद कर सकता हूं?",
    chatTabExpert: "एयरवाच एआई विशेषज्ञ", chatTabAskContext: "प्रदूषण, स्वास्थ्य जोखिम, या स्थानीय डेटा के बारे में पूछें",
    chatTabInputPlace: "एक प्रश्न पूछें...", chatTabConnError: "क्षमा करें, मुझे सर्वर से जुड़ने में समस्या हो रही है। कृपया बाद में पुनः प्रयास करें।",
    aqiPredLocReq: "भविष्यवाणी के लिए स्थान आवश्यक है",
    aqiPredLocReqDesc: "सटीक एक्यूआई भविष्यवाणी प्रदान करने के लिए, हमें आपके निर्देशांक जानना आवश्यक है। कृपया पहले रिपोर्ट टैब पर जाएं और अपने स्थान का पता लगाएं।",
    aqiPredTitle: "एक्यूआई भविष्यवाणी — इसके लिए स्थानीयकृत", aqiPredSeasonal: "मौसमी संदर्भ:", aqiPredLoading: "एक्यूआई भविष्यवाणी डेटा लोड हो रहा है...",
    municipalDashboard: "नगर पालिका प्रेषण डैशबोर्ड", activeHotspots: "सक्रिय गंभीर हॉटस्पॉट",
    deployCannon: "वाटर-मिस्ट कैनन तैनात करें", dispatchCrew: "सफाई दल भेजें",
    recentDispatches: "हालिया प्रेषण", noHotspots: "वर्तमान में कोई गंभीर हॉटस्पॉट नहीं है।",
    lowConnTitle: "इंटरनेट नहीं है?", lowConnDesc: "व्हाट्सएप के माध्यम से रिपोर्ट करें: '+91-98765-43210' पर 'SMOKE [स्थान]' भेजें",
    mapTabShowAqi: "हम आपको आपके 15 किमी के दायरे में एक्यूआई डेटा और नागरिक रिपोर्ट दिखाएंगे",
    mapTabYourLoc: "आपका स्थान"
  },
  te: {
    title: "AirWatch", sub: "పరిసర వాయు నాణ్యత ట్రాకర్", describe: "మీరు ఏమి చూస్తున్నారో వివరించండి", photo: "ఫోటోను జత చేయండి", location: "స్థానం", submit: "నివేదిక సమర్పించండి", dictate: "మాట్లాడండి", listening: "వింటుంది...", loading: "విశ్లేషిస్తోంది...", report: "నివేదిక", prediction: "అంచనా", map: "మ్యాప్", alerts: "హెచ్చరికలు", chat: "చాట్", municipal: "మున్సిపల్",
    weatherContext: "స్థానిక వాతావరణం", humidity: "తేమ", wind: "గాలి",
    mapTabShareLoc: "స్థానిక గాలి నాణ్యతను చూడటానికి మీ స్థానాన్ని పంచుకోండి",
    mapTabDetecting: "గుర్తిస్తోంది...", mapTabDetect: "నా స్థానాన్ని గుర్తించండి",
    mapTabReportsNearby: "సమీపంలోని నివేదికలు", mapTabRefresh: "రిఫ్రెష్",
    alertsTabLocReq: "హెచ్చరికల కోసం స్థానం అవసరం",
    alertsTabLocReqDesc: "సమీప హెచ్చరికలను వీక్షించడానికి దయచేసి ముందుగా నివేదిక ట్యాబ్‌లో మీ స్థానాన్ని గుర్తించండి.",
    alertsTabGoToReport: "రిపోర్ట్ ట్యాబ్‌కి వెళ్లండి", alertsTabScanning: "స్థానిక హెచ్చరికల కోసం స్కాన్ చేస్తోంది...",
    alertsTabNoAlerts: "సమీపంలో తీవ్రమైన హెచ్చరికలు లేవు",
    alertsTabStable: "మీ 25కి.మీ వ్యాసార్థంలో గాలి నాణ్యత స్థిరంగా కనిపిస్తోంది.",
    alertsTabLocalAlerts: "స్థానిక తీవ్ర కాలుష్య హెచ్చరికలు",
    chatTabIntro: "నమస్కారం! నేను మీ ఎయిర్‌వాచ్ AI సహాయకుడిని. ఈరోజు మీ స్థానిక గాలి నాణ్యత లేదా కాలుష్యం ఆరోగ్య ప్రమాదాలను అర్థం చేసుకోవడంలో నేను మీకు ఎలా సహాయపడగలను?",
    chatTabExpert: "ఎయిర్‌వాచ్ AI నిపుణుడు", chatTabAskContext: "కాలుష్యం, ఆరోగ్య ప్రమాదాలు లేదా స్థానిక డేటా గురించి అడగండి",
    chatTabInputPlace: "ఒక ప్రశ్న అడగండి...", chatTabConnError: "క్షమించండి, నాకు సర్వర్‌కి కనెక్ట్ కావడంలో సమస్య ఉంది. దయచేసి మళ్లీ ప్రయత్నించండి.",
    aqiPredLocReq: "అంచనా కోసం స్థానం అవసరం",
    aqiPredLocReqDesc: "ఖచ్చితమైన AQI అంచనాను అందించడానికి, మేము మీ కోఆర్డినేట్‌లను తెలుసుకోవాలి. దయచేసి ముందుగా రిపోర్ట్ ట్యాబ్‌కి వెళ్లి మీ స్థానాన్ని గుర్తించండి.",
    aqiPredTitle: "AQI అంచనా — దీని కోసం స్థానికీకరించబడింది", aqiPredSeasonal: "కాలానుగుణ సందర్భం:", aqiPredLoading: "AQI అంచనా డేటాను లోడ్ చేస్తోంది...",
    municipalDashboard: "మున్సిపల్ డిస్పాచ్ డాష్‌బోర్డ్", activeHotspots: "క్రియాశీల తీవ్రమైన హాట్‌స్పాట్‌లు",
    deployCannon: "వాటర్-మిస్ట్ కానన్ పంపండి", dispatchCrew: "క్లీనప్ క్రూను పంపండి",
    recentDispatches: "ఇటీవలి డిస్పాచ్‌లు", noHotspots: "ప్రస్తుతం తీవ్రమైన హాట్‌స్పాట్‌లు లేవు.",
    lowConnTitle: "ఇంటర్నెట్ లేదా?", lowConnDesc: "వాట్సాప్ ద్వారా నివేదించండి: '+91-98765-43210' కు 'SMOKE [స్థానం]' పంపండి",
    mapTabShowAqi: "మేము మీ 15కిమీ పరిధిలో AQI డేటా మరియు పౌర నివేదికలను చూపుతాము",
    mapTabYourLoc: "మీ స్థానం"
  },
  ta: {
    title: "AirWatch", sub: "அக்கம் பக்க காற்று தரக் கண்காணிப்பாளர்", describe: "நீங்கள் பார்ப்பதை விவரிக்கவும்", photo: "புகைப்படத்தை இணைக்கவும்", location: "இடம்", submit: "அறிக்கையைச் சமர்ப்பிக்கவும்", dictate: "பேசுங்கள்", listening: "கேட்கிறது...", loading: "பகுப்பாய்வு செய்கிறது...", report: "அறிக்கை", prediction: "கணிப்பு", map: "வரைபடம்", alerts: "எச்சரிக்கைகள்", chat: "அரட்டை", municipal: "நகராட்சி",
    weatherContext: "உள்ளூர் வானிலை", humidity: "ஈரப்பதம்", wind: "காற்றின் வேகம்",
    mapTabShareLoc: "உள்ளூர் காற்றின் தரத்தைக் காண உங்கள் இருப்பிடத்தைப் பகிரவும்",
    mapTabDetecting: "கண்டறிகிறது...", mapTabDetect: "என் இருப்பிடத்தைக் கண்டறி",
    mapTabReportsNearby: "அருகிலுள்ள அறிக்கைகள்", mapTabRefresh: "புதுப்பி",
    alertsTabLocReq: "எச்சரிக்கைகளுக்கு இருப்பிடம் தேவை",
    alertsTabLocReqDesc: "அருகிலுள்ள எச்சரிக்கைகளைக் காண தயவுசெய்து முதலில் அறிக்கை தாவலில் உங்கள் இருப்பிடத்தைக் கண்டறியவும்.",
    alertsTabGoToReport: "அறிக்கை தாவலுக்குச் செல்", alertsTabScanning: "உள்ளூர் எச்சரிக்கைகளுக்காக ஸ்கேன் செய்கிறது...",
    alertsTabNoAlerts: "அருகில் கடுமையான எச்சரிக்கைகள் இல்லை",
    alertsTabStable: "உங்கள் 25 கி.மீ சுற்றளவில் காற்றின் தரம் நிலையானதாகத் தெரிகிறது.",
    alertsTabLocalAlerts: "உள்ளூர் கடுமையான மாசுக் கட்டுப்பாட்டு எச்சரிக்கைகள்",
    chatTabIntro: "வணக்கம்! நான் உங்கள் ஏர்வாட்ச் AI உதவியாளர். இன்று உங்கள் உள்ளூர் காற்றின் தரம் அல்லது மாசு சுகாதார அபாயங்களைப் புரிந்துகொள்ள நான் உங்களுக்கு எவ்வாறு உதவ முடியும்?",
    chatTabExpert: "ஏர்வாட்ச் AI நிபுணர்", chatTabAskContext: "மாசு, சுகாதார அபாயங்கள் அல்லது உள்ளூர் தரவு பற்றி கேளுங்கள்",
    chatTabInputPlace: "ஒரு கேள்வி கேளுங்கள்...", chatTabConnError: "மன்னிக்கவும், சேவையகத்துடன் இணைப்பதில் சிக்கல் உள்ளது. பின்னர் மீண்டும் முயற்சிக்கவும்.",
    aqiPredLocReq: "கணிப்புக்கு இருப்பிடம் தேவை",
    aqiPredLocReqDesc: "துல்லியமான AQI கணிப்பை வழங்க, நாங்கள் உங்கள் ஆயத்தொலைவுகளை அறிய வேண்டும். தயவுசெய்து முதலில் அறிக்கை தாவலுக்குச் சென்று உங்கள் இருப்பிடத்தைக் கண்டறியவும்.",
    aqiPredTitle: "AQI கணிப்பு — இதற்காக உள்ளூர்மயமாக்கப்பட்டது", aqiPredSeasonal: "பருவகால சூழல்:", aqiPredLoading: "AQI கணிப்பு தரவை ஏற்றுகிறது...",
    municipalDashboard: "நகராட்சி அனுப்பும் டாஷ்போர்டு", activeHotspots: "செயலில் உள்ள கடுமையான ஹாட்ஸ்பாட்கள்",
    deployCannon: "நீர்-பனி பீரங்கியை அனுப்பு", dispatchCrew: "சுத்தம் செய்யும் குழுவை அனுப்பு",
    recentDispatches: "சமீபத்திய அனுப்புதல்கள்", noHotspots: "தற்போது கடுமையான ஹாட்ஸ்பாட்கள் இல்லை.",
    lowConnTitle: "இணையம் இல்லையா?", lowConnDesc: "வாட்ஸ்அப் மூலம் புகாரளிக்கவும்: '+91-98765-43210' க்கு 'SMOKE [இடம்]' என அனுப்பவும்",
    mapTabShowAqi: "உங்கள் 15கி.மீ சுற்றளவில் AQI தரவு மற்றும் குடிமக்கள் அறிக்கைகளை நாங்கள் காண்பிப்போம்",
    mapTabYourLoc: "உங்கள் இருப்பிடம்"
  },
  bn: {
    title: "AirWatch", sub: "আশেপাশের বায়ুর মান ট্র্যাকার", describe: "আপনি যা দেখছেন তা বর্ণনা করুন", photo: "একটি ছবি সংযুক্ত করুন", location: "অবস্থান", submit: "রিপোর্ট জমা দিন", dictate: "বলুন", listening: "শুনছি...", loading: "বিশ্লেষণ করছে...", report: "রিপোর্ট", prediction: "ভবিষ্যদ্বাণী", map: "মানচিত্র", alerts: "সতর্কতা", chat: "চ্যাট", municipal: "পৌরসভা",
    weatherContext: "স্থানীয় আবহাওয়া", humidity: "আর্দ্রতা", wind: "বাতাস",
    mapTabShareLoc: "স্থানীয় বায়ুর মান দেখতে আপনার অবস্থান শেয়ার করুন",
    mapTabDetecting: "সনাক্ত করছে...", mapTabDetect: "আমার অবস্থান সনাক্ত করুন",
    mapTabReportsNearby: "আশেপাশের রিপোর্ট", mapTabRefresh: "রিফ্রেশ করুন",
    alertsTabLocReq: "সতর্কতার জন্য অবস্থান প্রয়োজন",
    alertsTabLocReqDesc: "আশেপাশের সতর্কতা দেখতে দয়া করে প্রথমে রিপোর্ট ট্যাবে আপনার অবস্থান সনাক্ত করুন।",
    alertsTabGoToReport: "রিপোর্ট ট্যাবে যান", alertsTabScanning: "স্থানীয় সতর্কতার জন্য স্ক্যান করা হচ্ছে...",
    alertsTabNoAlerts: "আশেপাশে কোন গুরুতর সতর্কতা নেই",
    alertsTabStable: "আপনার ২৫ কিমি ব্যাসার্ধের মধ্যে বায়ুর মান স্থিতিশীল দেখাচ্ছে।",
    alertsTabLocalAlerts: "স্থানীয় গুরুতর দূষণ সতর্কতা",
    chatTabIntro: "হ্যালো! আমি আপনার এয়ারওয়াচ এআই সহকারী। আজ আপনার স্থানীয় বায়ুর মান বা দূষণের স্বাস্থ্য ঝুঁকি বুঝতে আমি আপনাকে কীভাবে সাহায্য করতে পারি?",
    chatTabExpert: "এয়ারওয়াচ এআই বিশেষজ্ঞ", chatTabAskContext: "দূষণ, স্বাস্থ্য ঝুঁকি বা স্থানীয় ডেটা সম্পর্কে জিজ্ঞাসা করুন",
    chatTabInputPlace: "একটি প্রশ্ন জিজ্ঞাসা করুন...", chatTabConnError: "দুঃখিত, সার্ভারের সাথে সংযোগ করতে আমার সমস্যা হচ্ছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।",
    aqiPredLocReq: "ভবিষ্যদ্বাণীর জন্য অবস্থান প্রয়োজন",
    aqiPredLocReqDesc: "সঠিক একিউআই ভবিষ্যদ্বাণী প্রদান করতে, আমাদের আপনার স্থানাঙ্কগুলি জানতে হবে। দয়া করে প্রথমে রিপোর্ট ট্যাবে যান এবং আপনার অবস্থান সনাক্ত করুন।",
    aqiPredTitle: "একিউআই ভবিষ্যদ্বাণী — এর জন্য স্থানীয়কৃত", aqiPredSeasonal: "মৌসুমি প্রেক্ষাপট:", aqiPredLoading: "একিউআই ভবিষ্যদ্বাণী ডেটা লোড করা হচ্ছে...",
    municipalDashboard: "পৌরসভা প্রেরণ ড্যাশবোর্ড", activeHotspots: "সক্রিয় গুরুতর হটস্পট",
    deployCannon: "জল-কুয়াশা কামান মোতায়েন করুন", dispatchCrew: "পরিচ্ছন্নতা কর্মী প্রেরণ করুন",
    recentDispatches: "সাম্প্রতিক প্রেরণ", noHotspots: "বর্তমানে কোনও গুরুতর হটস্পট নেই।",
    lowConnTitle: "ইন্টারনেট নেই?", lowConnDesc: "হোয়াটসঅ্যাপের মাধ্যমে রিপোর্ট করুন: '+91-98765-43210' এ 'SMOKE [অবস্থান]' পাঠান",
    mapTabShowAqi: "আমরা আপনার ১৫ কিলোমিটারের মধ্যে একিউআই ডেটা এবং নাগরিক রিপোর্ট দেখাব",
    mapTabYourLoc: "আপনার অবস্থান"
  }
};

function speakText(text, lang) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const langCode = { 'en': 'en-IN', 'hi': 'hi-IN', 'te': 'te-IN', 'ta': 'ta-IN', 'bn': 'bn-IN' }[lang] || 'en-IN';
  utterance.lang = langCode;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

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

function AQIPredictorChart({ lat, lng, t }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);

  useEffect(() => {
    if (!lat || !lng) return;
    setLoading(true);
    fetch(`${API}/aqi-prediction?lat=${lat}&lng=${lng}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [lat, lng]);

  if (loading) return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center flex flex-col items-center justify-center min-h-[200px]">
      <Activity className="w-6 h-6 text-emerald-500 animate-pulse mb-3" />
      <div className="text-gray-400 text-sm animate-pulse">{t.aqiPredLoading}</div>
    </div>
  );
  if (error || !data || data.error) return null;

  const allPoints = [...(data.historical || []), ...(data.predicted || [])];
  if (allPoints.length === 0) return null;

  const historicalCount = (data.historical || []).length;
  const maxAqi = Math.max(...allPoints.map((p) => p.aqi), 200);
  const chartW = 900, chartH = 300, padL = 42, padR = 20, padT = 18, padB = 34;
  const plotW = chartW - padL - padR, plotH = chartH - padT - padB;
  const yMax = Math.ceil(maxAqi / 50) * 50 + 50;
  const x = (i) => padL + (i / (allPoints.length - 1)) * plotW;
  const y = (aqi) => padT + plotH - (aqi / yMax) * plotH;
  const bands = [
    { min: 0,   max: 50,   color: "rgba(0,228,0,0.05)",    label: "Good" },
    { min: 50,  max: 100,  color: "rgba(255,255,0,0.04)",  label: "Moderate" },
    { min: 100, max: 200,  color: "rgba(255,126,0,0.04)",  label: "Unhealthy" },
    { min: 200, max: 300,  color: "rgba(255,0,0,0.04)",    label: "V.Unhealthy" },
    { min: 300, max: yMax, color: "rgba(143,63,151,0.05)", label: "Hazardous" },
  ];
  const histPath = allPoints.slice(0, historicalCount).map((p, i) =>
    `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.aqi).toFixed(1)}`).join(" ");
  const predPoints = allPoints.slice(historicalCount - 1);
  const predPath = predPoints.map((p, i) => {
    const idx = historicalCount - 1 + i;
    return `${i === 0 ? "M" : "L"}${x(idx).toFixed(1)},${y(p.aqi).toFixed(1)}`;
  }).join(" ");
  const predicted = data.predicted || [];

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-white font-bold text-sm flex items-center gap-1.5">
            <Activity className="text-emerald-400 w-4 h-4" /> AQI Forecast — {data.user_location || data.city}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3" />
            {data.user_location || data.city}
            <span className="text-gray-600 ml-1">· {data.station_name}</span>
            {data.station_count > 1 && <span className="text-gray-600 ml-1">({data.station_count} stations avg)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-gray-950"
              style={{ backgroundColor: aqiColor(data.current_aqi) }}>{data.current_aqi}</div>
            <div>
              <p className="text-xs text-gray-400">Now</p>
              <p className="text-xs font-bold text-white">{data.current_label || aqiLabel(data.current_aqi)}</p>
            </div>
          </div>
          {data.weather_factors && (
            <div className="flex items-center gap-2 text-xs text-gray-300 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5">
              <Thermometer className="w-3.5 h-3.5 text-emerald-400" />{data.weather_factors.temperature}°C
              <Wind className="w-3.5 h-3.5 text-blue-400 ml-1" />{data.weather_factors.wind_speed}km/h
              <Cloud className="w-3.5 h-3.5 text-purple-400 ml-1" />{data.weather_factors.humidity}%
            </div>
          )}
          {data.trend === "increasing" && <span className="flex items-center gap-1 text-xs font-bold text-red-400 bg-red-950/40 border border-red-900/50 px-2.5 py-1 rounded-lg"><TrendingUp className="w-3.5 h-3.5" /> {data.trend_description}</span>}
          {data.trend === "decreasing" && <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-2.5 py-1 rounded-lg"><TrendingDown className="w-3.5 h-3.5" /> {data.trend_description}</span>}
          {data.trend === "stable" && <span className="flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-950/40 border border-amber-900/50 px-2.5 py-1 rounded-lg"><Minus className="w-3.5 h-3.5" /> {data.trend_description}</span>}
        </div>
      </div>

      {/* Spike alert */}
      {data.spike_alerts?.length > 0 && (
        <div className="bg-red-950/30 border border-red-600/40 rounded-xl px-4 py-2.5 flex items-center gap-3">
          <AlertTriangle className="text-red-400 w-4 h-4 flex-shrink-0" />
          <p className="text-xs"><span className="text-red-400 font-bold">{data.spike_alerts[0].title}: </span>
          <span className="text-red-300/80">{data.spike_alerts[0].reason} — {data.spike_alerts[0].impact}</span></p>
        </div>
      )}

      {/* Chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 overflow-x-auto scrollbar-hide">
        <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{data.seasonal_context}</p>
        <div className="min-w-[600px]">
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto bg-gray-950 rounded-lg border border-gray-800/60">
          {bands.map((b) => {
            const bTop = Math.max(y(Math.min(b.max, yMax)), padT);
            const bBot = Math.min(y(b.min), padT + plotH);
            if (bBot <= bTop) return null;
            return (<g key={b.label}>
              <rect x={padL} y={bTop} width={plotW} height={bBot - bTop} fill={b.color} />
              <text x={padL + 5} y={bTop + 11} fill="rgba(255,255,255,0.18)" fontSize="9" fontFamily="sans-serif">{b.label}</text>
            </g>);
          })}
          {Array.from({ length: Math.floor(yMax / 50) + 1 }, (_, i) => i * 50).map((val) => (
            <g key={val}>
              <line x1={padL} y1={y(val)} x2={padL + plotW} y2={y(val)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="4 4" />
              <text x={padL - 6} y={y(val) + 3} fill="#6b7280" fontSize="9" textAnchor="end" fontFamily="sans-serif">{val}</text>
            </g>
          ))}
          {historicalCount < allPoints.length && (
            <rect x={x(historicalCount - 1)} y={padT} width={x(allPoints.length - 1) - x(historicalCount - 1)} height={plotH} fill="rgba(59,130,246,0.04)" />
          )}
          <path d={histPath} fill="none" stroke="rgba(16,185,129,0.25)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={histPath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {predPath && <>
            <path d={predPath} fill="none" stroke="rgba(59,130,246,0.18)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={predPath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
          </>}
          {allPoints.map((p, i) => {
            const isPred = i >= historicalCount;
            const isCur  = p.type === "current";
            return (
              <g key={i} onMouseEnter={() => setHoveredPoint({ ...p, idx: i })} onMouseLeave={() => setHoveredPoint(null)} style={{ cursor: "pointer" }}>
                {isCur && <circle cx={x(i)} cy={y(p.aqi)} r={7} fill="rgba(245,158,11,0.25)" />}
                <circle cx={x(i)} cy={y(p.aqi)} r={isCur ? 5 : 3.5}
                  fill={isCur ? "#f59e0b" : isPred ? "#3b82f6" : "#10b981"}
                  stroke={isCur ? "#fff" : "#111827"} strokeWidth={1.5} />
                <circle cx={x(i)} cy={y(p.aqi)} r={12} fill="transparent" />
              </g>
            );
          })}
          {hoveredPoint && (
            <g>
              <rect x={Math.min(x(hoveredPoint.idx) - 52, chartW - padR - 110)} y={y(hoveredPoint.aqi) - 42} width="104" height="32" rx="5" fill="#1f2937" stroke="#374151" strokeWidth="1" />
              <text x={Math.min(x(hoveredPoint.idx), chartW - padR - 52)} y={y(hoveredPoint.aqi) - 26} textAnchor="middle" fill="white" fontSize="10" fontFamily="sans-serif" fontWeight="700">AQI {hoveredPoint.aqi} · {hoveredPoint.date?.slice(5)}</text>
              <text x={Math.min(x(hoveredPoint.idx), chartW - padR - 52)} y={y(hoveredPoint.aqi) - 14} textAnchor="middle" fill="#9ca3af" fontSize="8" fontFamily="sans-serif">
                {hoveredPoint.type === "predicted" ? `Predicted · ${hoveredPoint.confidence}% conf.` : hoveredPoint.type === "current" ? "Today (live)" : "Historical"}
              </text>
            </g>
          )}
          {allPoints.filter((_, i) => i % 7 === 0 || i === allPoints.length - 1).map((p) => {
            const idx = allPoints.indexOf(p);
            return <text key={p.date} x={x(idx)} y={chartH - 5} fill="#6b7280" fontSize="9" textAnchor="middle" fontFamily="sans-serif">{p.date?.slice(5)}</text>;
          })}
          <g transform={`translate(${padL + 8}, ${chartH - 18})`}>
            <circle cx="0" cy="0" r="3.5" fill="#10b981" /><text x="8" y="3" fill="#9ca3af" fontSize="9" fontFamily="sans-serif">Historical</text>
            <circle cx="72" cy="0" r="3.5" fill="#3b82f6" /><text x="80" y="3" fill="#9ca3af" fontSize="9" fontFamily="sans-serif">Predicted</text>
            <circle cx="148" cy="0" r="4" fill="#f59e0b" stroke="#fff" strokeWidth="1" /><text x="156" y="3" fill="#9ca3af" fontSize="9" fontFamily="sans-serif">Today</text>
          </g>
        </svg>
        </div>
      </div>

      {/* 7-day forecast cards */}
      {predicted.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">7-Day Forecast</p>
          <div className="grid grid-cols-7 gap-1.5 mb-2">
            {predicted.map((p, i) => {
              const shortDay = new Date(p.date).toLocaleDateString("en", { weekday: "short" });
              return (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-2 flex flex-col items-center gap-1 text-center">
                  <p className="text-gray-500" style={{ fontSize: "10px" }}>{shortDay}</p>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-gray-950" style={{ backgroundColor: aqiColor(p.aqi) }}>{p.aqi}</div>
                  <p className="text-gray-400 leading-tight" style={{ fontSize: "9px" }}>{p.label?.split(" ")[0]}</p>
                  <p className="text-gray-600 leading-tight" style={{ fontSize: "8px" }}>{p.confidence}%</p>
                </div>
              );
            })}
          </div>
          <div className="space-y-1">
            {predicted.slice(0, 3).map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-400 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-1.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: aqiColor(p.aqi) }} />
                <span className="text-gray-500 flex-shrink-0">{new Date(p.date).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}:</span>
                <span>{p.tip}</span>
                {p.weather_impact !== 0 && <span className={`ml-auto flex-shrink-0 text-xs ${p.weather_impact > 0 ? "text-red-400" : "text-emerald-400"}`}>{p.weather_impact > 0 ? "+" : ""}{p.weather_impact}% weather</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weather insight */}
      {data.weather_factors?.analysis && (
        <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-900/50 border border-gray-800 rounded-xl px-3 py-2">
          <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
          <span>{data.weather_factors.analysis}</span>
        </div>
      )}
    </div>
  );
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
          {station.station_name} • {Math.round(station.distance_km)}km away
        </p>
        <p className="text-xs text-gray-500">{station.city}, {station.state} • {station.dominant_pollutant}</p>
      </div>
    </div>
  );
}

function MapTab({ userLat, userLng, onLocationDetected, t }) {
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
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!localLat || !localLng) return;
    fetch(`${API}/nearest-station?lat=${localLat}&lng=${localLng}`)
      .then((r) => r.json())
      .then(setNearestStation)
      .catch(() => { });
    fetch(`${API}/reports/nearby?lat=${localLat}&lng=${localLng}&radius_km=15`)
      .then((r) => r.json())
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => { });
  }, [localLat, localLng]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    const center = localLat && localLng ? [localLat, localLng] : [20.5937, 78.9629];
    const zoom = localLat && localLng ? 11 : 5;
    const map = L.map(mapRef.current).setView(center, zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    mapInstanceRef.current = map;
    setTimeout(() => { if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize(); }, 400);
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
    }).addTo(map).bindPopup(`<b>📍 ${t.mapTabYourLoc}</b>`);
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
          <b>🏢 ${s.station_name}</b><br/>
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
      try { analysis = JSON.parse(r.gemini_analysis || "{}"); } catch { }
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
          <p className="text-sm text-gray-300 font-medium">{t.mapTabShareLoc}</p>
          <p className="text-xs text-gray-500">{t.mapTabShowAqi}</p>
          <button
            onClick={detectLocation}
            disabled={locating}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {locating ? t.mapTabDetecting : t.mapTabDetect}
          </button>
        </div>
      )}

      {nearestStation && <LocalAQICard station={nearestStation} />}

      {localLat && (
        <div className="flex items-center justify-between">
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> You</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-orange-500 inline-block" /> CPCB Station</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full inline-block" style={{ background: "#ff7e00" }} /> Citizen Report</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{reports.length} {t.mapTabReportsNearby}</span>
            <button
              onClick={detectLocation}
              disabled={locating}
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
            >
              {locating ? "..." : `📍 ${t.mapTabRefresh}`}
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

function AlertsTab({ userLat, userLng, t }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userLat || !userLng) return;
    setLoading(true);
    fetch(`${API}/reports/nearby?lat=${userLat}&lng=${userLng}&radius_km=25`)
      .then(r => r.json())
      .then(data => {
        const severeAlerts = data.filter(r => r.severity >= 3);
        setAlerts(severeAlerts);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userLat, userLng]);

  if (!userLat) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center space-y-4">
        <p className="text-4xl">📍</p>
        <p className="text-lg text-white font-medium">{t.alertsTabLocReq}</p>
        <p className="text-sm text-gray-400">{t.alertsTabLocReqDesc}</p>
        <button
          onClick={() => document.querySelector("button:nth-child(1)")?.click()} // Hacks to tab 1
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-colors inline-block mt-2"
        >
          {t.alertsTabGoToReport}
        </button>
      </div>
    );
  }

  if (loading) return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center">
      <div className="animate-pulse text-gray-400">📡 {t.alertsTabScanning}</div>
    </div>
  );

  if (alerts.length === 0) return (
    <div className="bg-emerald-900/30 border border-emerald-800 rounded-xl p-8 text-center space-y-3">
      <p className="text-4xl">✅</p>
      <p className="text-lg text-white font-medium">{t.alertsTabNoAlerts}</p>
      <p className="text-sm text-gray-400">{t.alertsTabStable}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">⚠️ {t.alertsTabLocalAlerts}</h3>
        <span className="text-xs text-gray-500">{alerts.length} report{alerts.length !== 1 ? "s" : ""} within 25km</span>
      </div>

      {/* Severity scale legend */}
      <div className="grid grid-cols-5 gap-1 text-center">
        {[
          { level: 1, label: "Good",      color: "bg-green-900 border-green-700 text-green-300",   icon: "✅" },
          { level: 2, label: "Moderate",  color: "bg-yellow-900 border-yellow-700 text-yellow-300", icon: "🟡" },
          { level: 3, label: "Unhealthy", color: "bg-orange-900 border-orange-700 text-orange-300", icon: "⚠️" },
          { level: 4, label: "Hazardous", color: "bg-red-900 border-red-700 text-red-300",          icon: "🛑" },
          { level: 5, label: "Emergency", color: "bg-purple-900 border-purple-700 text-purple-300", icon: "🚨" },
        ].map(({ level, label, color, icon }) => {
          const count = alerts.filter(a => a.severity === level).length;
          return (
            <div key={level} className={`border rounded-lg px-2 py-2 ${color} ${count > 0 ? "opacity-100" : "opacity-30"}`}>
              <div className="text-base">{icon}</div>
              <div className="text-xs font-bold mt-0.5">{level}</div>
              <div className="text-xs opacity-80">{label}</div>
              {count > 0 && <div className="text-xs font-bold mt-0.5">{count} report{count !== 1 ? "s" : ""}</div>}
            </div>
          );
        })}
      </div>

      {/* Reports grouped by severity (5 → 1) */}
      {[5, 4, 3].map((sev) => {
        const group = alerts.filter(a => a.severity === sev);
        if (group.length === 0) return null;
        const cfg = {
          5: { bg: "bg-purple-900/20 border-purple-500", label: "🚨 EMERGENCY", tc: "text-purple-300" },
          4: { bg: "bg-red-900/20 border-red-500",       label: "🛑 HAZARDOUS", tc: "text-red-300" },
          3: { bg: "bg-orange-900/20 border-orange-500", label: "⚠️ UNHEALTHY", tc: "text-orange-300" },
        }[sev];
        return (
          <div key={sev}>
            <p className={`text-xs font-bold mb-1.5 ${cfg.tc}`}>{cfg.label} — {group.length} report{group.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-1 gap-2">
              {group.map((alert, i) => {
                let analysis = {};
                try { analysis = JSON.parse(alert.gemini_analysis || "{}"); } catch { }
                return (
                  <div key={i} className={`border-l-4 ${cfg.bg} border rounded-r-lg p-3 flex gap-3 items-start`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-white font-semibold truncate">{alert.location}</p>
                        <span className="text-xs text-gray-500 flex-shrink-0">{new Date(alert.timestamp || Date.now()).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
                      </div>
                      {analysis.summary && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{analysis.summary}</p>}
                      {analysis.advisory && <p className="text-xs text-emerald-400 mt-0.5 line-clamp-1">💡 {analysis.advisory}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChatTab({ userLat, userLng, lang, t }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    setMessages([{ role: "ai", text: t.chatTabIntro }]);
  }, [t.chatTabIntro]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(Math.random().toString(36).substring(7)).current;
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setLoading(true);

    const fd = new FormData();
    fd.append("message", userMsg);
    fd.append("session_id", sessionId);
    fd.append("lang", lang);
    if (userLat) fd.append("lat", userLat);
    if (userLng) fd.append("lng", userLng);

    try {
      const res = await fetch(`${API}/chat`, { method: "POST", body: fd });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "ai", text: t.chatTabConnError }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl flex flex-col h-[600px] glass-card shadow-2xl">
      <div className="p-4 border-b border-gray-800 bg-gray-900/80 rounded-t-xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
          <Globe className="text-emerald-400 w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-white">{t.chatTabExpert}</h3>
          <p className="text-xs text-gray-400">{t.chatTabAskContext}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 text-sm leading-relaxed shadow-md ${msg.role === 'user' ? 'chat-bubble-user text-white' : 'chat-bubble-ai text-gray-200'}`}>
              {msg.text.split('\n').map((line, j) => (
                <span key={j}>{line}<br /></span>
              ))}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="chat-bubble-ai p-4 flex gap-2 items-center text-emerald-500 max-w-[85%] shadow-md">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce"></span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0.2s' }}></span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0.4s' }}></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-800 bg-gray-900/80 rounded-b-xl">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t.chatTabInputPlace}
            className="flex-1 bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 text-white placeholder-gray-500 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl px-4 flex items-center justify-center transition-colors shadow-lg"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MunicipalTab({ userLat, userLng, t }) {
  const [data, setData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(`${API}/municipal/dashboard?lat=${userLat || 0}&lng=${userLng || 0}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => { });

    fetch(`${API}/municipal/dispatch-log`)
      .then(r => r.json())
      .then(d => setLogs(d.logs || []))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [userLat, userLng]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDispatch = async (lat, lng, actionType) => {
    setActionLoading(true);
    const fd = new FormData();
    fd.append("lat", lat);
    fd.append("lng", lng);
    fd.append("action_type", actionType);

    try {
      const res = await fetch(`${API}/municipal/dispatch`, { method: "POST", body: fd });
      if (res.ok) {
        setToast(`✅ Action dispatched successfully!`);
        setTimeout(() => setToast(null), 3000);
        fetchData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !data) return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center">
      <div className="animate-pulse text-gray-400">Loading Dashboard...</div>
    </div>
  );

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-slide-up">
          {toast}
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Active Hotspots</p>
          <p className="text-2xl font-bold text-white">{data?.total_active || 0}</p>
        </div>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Active Crews</p>
          <p className="text-2xl font-bold text-blue-400">{logs.filter(l => l.status === 'Dispatched').length}</p>
        </div>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Action Required</p>
          <p className="text-2xl font-bold text-red-400">{data?.total_active || 0}</p>
        </div>
      </div>

      {/* Hotspots Table */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-gray-800 bg-gray-800/50">
          <h3 className="font-bold text-white flex items-center gap-2">🚨 {t.activeHotspots}</h3>
        </div>
        {(!data?.active_hotspots || data.active_hotspots.length === 0) ? (
          <div className="p-8 text-center text-gray-400">{t.noHotspots}</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {data.active_hotspots.map((hs, i) => (
              <div key={i} className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    <span className="font-bold text-white">Zone {i + 1}</span>
                    <span className="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded border border-red-800">
                      Severity {hs.max_severity}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-1">{hs.report_count} citizen reports · {hs.pollution_type}</p>
                  <p className="text-xs text-gray-500 mt-1">Lat: {hs.lat.toFixed(4)}, Lng: {hs.lng.toFixed(4)}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDispatch(hs.lat, hs.lng, 'Water-Mist Cannon')}
                    disabled={actionLoading}
                    className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg shadow disabled:opacity-50 transition-colors"
                  >
                    💦 {t.deployCannon}
                  </button>
                  <button
                    onClick={() => handleDispatch(hs.lat, hs.lng, 'Cleanup Crew')}
                    disabled={actionLoading}
                    className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg shadow disabled:opacity-50 transition-colors"
                  >
                    🧹 {t.dispatchCrew}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dispatch Log */}
      {logs.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-gray-800 bg-gray-800/50">
            <h3 className="font-bold text-white flex items-center gap-2">📋 {t.recentDispatches}</h3>
          </div>
          <div className="divide-y divide-gray-800 max-h-60 overflow-y-auto">
            {logs.map(log => (
              <div key={log.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-gray-300">{log.action}</span>
                  <span className="text-gray-500 text-xs ml-2">to {log.lat.toFixed(3)}, {log.lng.toFixed(3)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-gray-500">{new Date(log.timestamp * 1000).toLocaleTimeString()}</span>
                  <span className="bg-blue-900/30 text-blue-400 px-2 py-1 rounded-full border border-blue-800">
                    {log.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("Report");
  const [lang, setLang] = useState("en");
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;

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
  const [weatherData, setWeatherData] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [customApiUrl, setCustomApiUrl] = useState(localStorage.getItem('airwatch_api_url') || "");
  const recognitionRef = useRef(null);
  const fileRef = useRef();
  
  // Use custom API URL if set, otherwise use default
  const activeApiUrl = customApiUrl || API;

  useEffect(() => {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setText((prev) => prev + (prev ? " " : "") + finalTranscript);
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (recognitionRef.current) {
        const rcLang = { 'en': 'en-IN', 'hi': 'hi-IN', 'te': 'te-IN', 'ta': 'ta-IN', 'bn': 'bn-IN' }[lang] || 'en-IN';
        recognitionRef.current.lang = rcLang;
        recognitionRef.current.start();
        setIsListening(true);
      }
    }
  };

  const fetchLocality = async (la, lo) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${la}&lon=${lo}`);
      const data = await res.json();
      if (data && data.address) {
        const locality = data.address.suburb || data.address.neighbourhood || data.address.city || data.address.town || data.address.village;
        if (locality) return locality;
      }
    } catch (e) {
      console.log("Reverse geocoding failed", e);
    }
    return `${la}, ${lo}`;
  };

  useEffect(() => {
    // #region agent log
    (async () => {
      const env = {
        href: window.location.href,
        hostname: window.location.hostname,
        apiBase: API,
        isSecureContext: window.isSecureContext,
        userAgent: navigator.userAgent.slice(0, 120),
      };
      agentLog("App.jsx:mount", "client environment", env, "A");

      const localhostUrl = "http://localhost:8000/health";
      let localhostOk = false;
      try {
        const r = await fetch(localhostUrl, { signal: AbortSignal.timeout(4000) });
        localhostOk = r.ok;
      } catch (e) {
        agentLog("App.jsx:mount", "localhost health failed", { error: String(e) }, "A");
      }

      let hostnameOk = false;
      try {
        const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(4000) });
        hostnameOk = r.ok;
      } catch (e) {
        agentLog("App.jsx:mount", "hostname API health failed", { api: API, error: String(e) }, "A");
      }

      agentLog("App.jsx:mount", "API reachability", { localhostOk, hostnameOk, apiBase: API }, "A");
    })();
    // #endregion

    const fallbackToIp = async () => {
      try {
        let res = await fetch("https://get.geojs.io/v1/ip/geo.json").catch(() => null);
        if (!res || !res.ok) res = await fetch("https://ipapi.co/json/").catch(() => null);
        if (!res || !res.ok) throw new Error("Fallback failed");
        
        const data = await res.json();
        const la = parseFloat(data.latitude);
        const lo = parseFloat(data.longitude);
        if (!isNaN(la) && !isNaN(lo)) {
          setUserLat(la); setUserLng(lo);
          setLat(la.toFixed(5)); setLng(lo.toFixed(5));
          const locName = await fetchLocality(la, lo);
          setLocationDisplay(locName);
          setError("Used approximate network location (GPS disabled).");
          fetch(`${API}/nearest-station?lat=${la}&lng=${lo}`)
            .then((r) => r.json())
            .then(setNearestStation).catch(() => {});
        } else {
          throw new Error("Invalid format");
        }
      } catch (err) {
        if (!window.isSecureContext && window.location.hostname !== "localhost") {
          setError("Location blocked: mobile browsers require HTTPS for GPS on local networks. Enter coordinates manually or use Detect after allowing location.");
        }
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const la = pos.coords.latitude;
          const lo = pos.coords.longitude;
          setUserLat(la);
          setUserLng(lo);
          setLat(la.toFixed(5));
          setLng(lo.toFixed(5));
          const locName = await fetchLocality(la, lo);
          setLocationDisplay(locName);
          // #region agent log
          agentLog("App.jsx:geo", "geolocation success", { la, lo }, "D");
          // #endregion
          fetch(`${API}/nearest-station?lat=${la}&lng=${lo}`)
            .then((r) => r.json())
            .then(setNearestStation)
            .catch(() => { });
        },
        (err) => {
          // #region agent log
          agentLog("App.jsx:geo", "geolocation failed", {
            code: err.code,
            message: err.message,
            isSecureContext: window.isSecureContext,
          }, "D");
          // #endregion
          fallbackToIp();
        }
      );
    } else {
      fallbackToIp();
    }
  }, []);

  useEffect(() => {
    if (userLat && userLng) {
      fetch(`${API}/weather?lat=${userLat}&lng=${userLng}`)
        .then(r => r.json())
        .then(data => {
          if (!data.error) setWeatherData(data);
        })
        .catch(() => { });
    }
  }, [userLat, userLng]);

  async function handleLocationDetected(la, lo) {
    setUserLat(la);
    setUserLng(lo);
    setLat(la.toFixed(5));
    setLng(lo.toFixed(5));
    const locName = await fetchLocality(la, lo);
    setLocationDisplay(locName);
  }

  function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function handleLocation() {
    const fallbackToIp = async () => {
      try {
        let res = await fetch("https://get.geojs.io/v1/ip/geo.json").catch(() => null);
        if (!res || !res.ok) res = await fetch("https://ipapi.co/json/").catch(() => null);
        if (!res || !res.ok) throw new Error("Fallback failed");
        
        const data = await res.json();
        const la = parseFloat(data.latitude);
        const lo = parseFloat(data.longitude);
        if (!isNaN(la) && !isNaN(lo)) {
          setLat(la.toFixed(5)); setLng(lo.toFixed(5));
          setUserLat(la); setUserLng(lo);
          const locName = await fetchLocality(la, lo);
          setLocationDisplay(locName);
          setError("Used approximate network location.");
        } else {
          setError("Network location failed. Enter coordinates manually.");
        }
      } catch (err) {
        setError("Location failed. Enter coordinates manually.");
      }
    };

    if (!navigator.geolocation) { 
      fallbackToIp(); 
      return; 
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const la = pos.coords.latitude.toFixed(5);
        const lo = pos.coords.longitude.toFixed(5);
        setLat(la); setLng(lo);
        setUserLat(parseFloat(la));
        setUserLng(parseFloat(lo));
        const locName = await fetchLocality(pos.coords.latitude, pos.coords.longitude);
        setLocationDisplay(locName);
        setError(null);
      },
      (err) => fallbackToIp()
    );
  }

  function handleLocationInput(val) {
    setLocationDisplay(val);
    const parts = val.split(",").map((s) => s.trim());
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] !== '' && parts[1] !== '') {
      setLat(parts[0]);
      setLng(parts[1]);
      setUserLat(parseFloat(parts[0]));
      setUserLng(parseFloat(parts[1]));
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!text) { setError(t.describe + " is required."); return; }
    if (!lat || !lng) { setError(t.location + " is required."); return; }
    setLoading(true);

    let weatherContext = "";
    if (weatherData) {
      weatherContext = ` [Weather context at location: ${weatherData.temperature}°C, Humidity ${weatherData.humidity}%, Wind ${weatherData.wind_speed} km/h]`;
    }

    try {
      const fd = new FormData();
      let query = text + weatherContext;
      if (lang !== 'en') {
        const langName = { 'hi': 'Hindi', 'te': 'Telugu', 'ta': 'Tamil', 'bn': 'Bengali' }[lang];
        query += `\n[IMPORTANT: Please generate the analysis, summary, health impact, advisory, precautions, and measures entirely in ${langName}. The JSON structure must remain exactly the same, only the text values should be translated.]`;
      }

      fd.append("text", query);
      fd.append("lat", lat);
      fd.append("lng", lng);
      fd.append("location", locationDisplay);
      if (photo) fd.append("photo", photo);
      // #region agent log
      agentLog("App.jsx:submit", "report submit start", { api: API, lat, lng }, "A");
      // #endregion
      const res = await fetch(`${activeApiUrl}/report`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // #region agent log
      agentLog("App.jsx:submit", "report submit success", { severity: data?.analysis?.severity }, "A");
      // #endregion
      setResult(data);
    } catch (e) {
      // #region agent log
      agentLog("App.jsx:submit", "report submit failed", { api: API, error: String(e) }, "A");
      // #endregion
      let errorMsg = e.message;
      if (errorMsg === "Failed to fetch") {
         errorMsg = `Failed to connect to ${API}. If on mobile, your browser might be blocking the request. Try setting a Custom API URL in settings.`;
      }
      setError(`Submit failed: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  }

  const severity = result?.analysis?.severity;
  const severityStyle = SEVERITY_COLORS[severity] || SEVERITY_COLORS[3];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans relative">
      <header className="border-b border-[var(--border-subtle)] px-6 py-4 flex items-center justify-between glass-card rounded-none sticky top-0 z-50">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">🌿 {t.title}</h1>
          <p className="text-xs text-[var(--text-secondary)]">{t.sub}</p>
        </div>

        <div className="flex items-center gap-4">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-xs rounded-md px-2 py-1 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="te">తెలుగు</option>
            <option value="ta">தமிழ்</option>
            <option value="bn">বাংলা</option>
          </select>

          {nearestStation && (
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-gray-950 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
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
        </div>
      </header>

      <nav className="flex border-b border-[var(--border-subtle)] px-6 bg-[var(--bg-secondary)] overflow-x-auto scrollbar-hide">
        {TABS.map((tName) => (
          <button
            key={tName}
            onClick={() => setTab(tName)}
            className={`py-3 px-4 text-sm font-medium transition-colors whitespace-nowrap ${tab === tName ? "tab-active text-emerald-400" : "text-gray-400 hover:text-white"
              }`}
          >
            {tName === 'Report' ? t.report || tName :
              tName === 'Map' ? t.map || tName :
                tName === 'Alerts' ? t.alerts || tName :
                  tName === 'Chat' ? t.chat || tName :
                    tName === 'Municipal' ? t.municipal || tName :
                      tName === 'Prediction' ? t.prediction || tName : tName}
          </button>
        ))}
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6 animate-slide-up">
        {tab === "Report" && (
          <>
            {nearestStation && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex items-center justify-between shadow-xl">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-bold">Current Status</p>
                  <p className="text-xl font-bold text-white mt-0.5" style={{ color: aqiColor(nearestStation.aqi) }}>
                    {aqiLabel(nearestStation.aqi).toUpperCase()}
                  </p>
                </div>
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-gray-950 text-lg shadow-[0_0_15px_rgba(255,255,255,0.15)]"
                  style={{ backgroundColor: aqiColor(nearestStation.aqi) }}
                >
                  {Math.round(nearestStation.aqi)}
                </div>
              </div>
            )}

            {weatherData && (
              <div className="glass-card p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Thermometer className="text-emerald-400 w-5 h-5" />
                  <div>
                    <p className="text-xs text-gray-400">Local Weather</p>
                    <p className="text-sm font-semibold">{weatherData.temperature}°C, {weatherData.condition}</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="text-right">
                    <p className="text-xs text-gray-400 flex items-center justify-end gap-1"><Cloud className="w-3 h-3" /> Humidity</p>
                    <p className="text-sm font-semibold">{weatherData.humidity}%</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 flex items-center justify-end gap-1"><Wind className="w-3 h-3" /> Wind</p>
                    <p className="text-sm font-semibold">{weatherData.wind_speed} km/h</p>
                  </div>
                </div>
              </div>
            )}
            {nearestStation && <LocalAQICard station={nearestStation} />}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-300 font-medium">{t.describe}</label>
                {recognitionRef.current && (
                  <button
                    onClick={toggleListen}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-colors ${isListening ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}
                  >
                    {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                    {isListening ? t.listening : t.dictate}
                  </button>
                )}
              </div>
              <textarea
                rows={4}
                placeholder="e.g. Black smoke from garbage dump near Hiranandani circle..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={`w-full bg-gray-900 border rounded-lg px-4 py-3 text-sm resize-none focus:outline-none transition-colors placeholder-gray-600 ${isListening ? 'border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.1)]' : 'border-gray-700 focus:border-emerald-500'}`}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-300 font-medium">{t.photo}</label>
              <div
                onClick={() => fileRef.current.click()}
                className="border-2 border-dashed border-gray-700 rounded-lg p-6 flex flex-col items-center gap-2 cursor-pointer hover:border-emerald-600 transition-colors"
              >
                {preview ? (
                  <img src={preview} alt="preview" className="max-h-48 rounded-md object-cover" />
                ) : (
                  <>
                    <span className="text-3xl">📸</span>
                    <p className="text-sm text-gray-400">{t.photo}</p>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-300 font-medium">{t.location}</label>
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
              className="w-full btn-primary"
            >
              {loading ? t.loading : t.submit}
            </button>

            {!result && (
              <div className="mt-6 bg-gray-900/50 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-emerald-400 text-xl">💬</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{t.lowConnTitle}</p>
                  <p className="text-xs text-gray-400 mt-1">{t.lowConnDesc}</p>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Header Card */}
                <div className={`${severityStyle.bg} border ${severityStyle.border} rounded-xl px-5 py-4 space-y-3`}>
                  <div className="flex items-center justify-between">
                    <p className={`font-semibold ${severityStyle.text}`}>
                      ✓ Report submitted — Severity {severity}/5 ({severityStyle.label})
                    </p>
                    {result.analysis?.estimated_aqi_range && (
                      <span className="text-xs px-3 py-1.5 rounded-full font-bold bg-gray-800/80 border border-gray-600" style={{ color: aqiColor(parseInt(result.analysis.estimated_aqi_range.split("-")[0]) || 100) }}>
                        Est. AQI: {result.analysis.estimated_aqi_range}
                      </span>
                    )}
                  </div>

                  {result.analysis?.summary && (
                    <p className="text-sm text-gray-300 leading-relaxed">{result.analysis.summary}</p>
                  )}

                  <div className="flex flex-wrap gap-3 text-xs">
                    {result.analysis?.pollutant_type && (
                      <span className="bg-gray-800/60 px-2.5 py-1 rounded-md text-gray-300 flex items-center gap-1">
                        <Cloud className="w-3 h-3 text-gray-400" /> {result.analysis.pollutant_type}
                      </span>
                    )}
                    {result.analysis?.government_consistency && (
                      <span className="bg-gray-800/60 px-2.5 py-1 rounded-md text-gray-300 flex items-center gap-1">
                        <Activity className="w-3 h-3 text-gray-400" /> vs Official: {result.analysis.government_consistency}
                      </span>
                    )}
                    {result.station && (
                      <span className="bg-gray-800/60 px-2.5 py-1 rounded-md text-gray-400 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-gray-500" /> {result.station.station_name} — AQI {result.station.aqi} ({Math.round(result.station.distance_km)}km)
                      </span>
                    )}
                  </div>
                </div>

                {/* Analysis grid — 2 columns, no scroll */}
                <div className="grid grid-cols-2 gap-2">
                  {result.analysis?.detailed_visual_analysis && (
                    <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5">
                      <p className="font-medium text-xs text-white mb-1 flex items-center gap-1.5">
                        <Camera className="text-cyan-400 w-3.5 h-3.5" /> Visual
                      </p>
                      <p className="text-xs text-gray-400 line-clamp-2">{result.analysis.detailed_visual_analysis}</p>
                    </div>
                  )}
                  {result.analysis?.possible_sources?.length > 0 && (
                    <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5">
                      <p className="font-medium text-xs text-white mb-1 flex items-center gap-1.5">
                        <Factory className="text-amber-400 w-3.5 h-3.5" /> Sources
                      </p>
                      <ul className="space-y-0.5">
                        {result.analysis.possible_sources.slice(0, 2).map((src, i) => (
                          <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                            <span className="text-amber-500 flex-shrink-0">▸</span><span className="line-clamp-1">{src}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.analysis?.health_impact && (
                    <div className="bg-gray-900 border border-red-900/30 rounded-xl px-3 py-2.5">
                      <p className="font-medium text-xs text-white mb-1 flex items-center gap-1.5">
                        <Activity className="text-red-400 w-3.5 h-3.5" /> Health Risk
                      </p>
                      <p className="text-xs text-gray-400 line-clamp-2">{result.analysis.health_impact}</p>
                      {result.analysis?.affected_groups?.length > 0 && (
                        <p className="text-xs text-yellow-400/70 mt-1">At risk: {result.analysis.affected_groups.slice(0, 2).join(", ")}</p>
                      )}
                    </div>
                  )}
                  {result.analysis?.precautions?.length > 0 && (
                    <div className="bg-gray-900 border border-emerald-900/30 rounded-xl px-3 py-2.5">
                      <p className="font-medium text-xs text-white mb-1 flex items-center gap-1.5">
                        <Shield className="text-blue-400 w-3.5 h-3.5" /> Precautions
                      </p>
                      <ul className="space-y-0.5">
                        {result.analysis.precautions.slice(0, 2).map((prec, i) => (
                          <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                            <span className="text-blue-400 flex-shrink-0">✧</span><span className="line-clamp-1">{prec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>


                {/* Advisory */}
                {result.analysis?.advisory && (
                  <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-xl px-5 py-4">
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-sm text-emerald-300 font-medium flex items-center gap-2">
                        <Zap className="w-4 h-4 text-emerald-400" /> Advisory
                      </p>
                      <button
                        onClick={() => speakText(result.analysis.advisory, lang)}
                        className="text-emerald-400 hover:text-emerald-300 bg-emerald-900/30 p-1.5 rounded-full transition-colors"
                        title="Read aloud"
                      >
                        <Volume2 size={16} />
                      </button>
                    </div>
                    <p className="text-sm text-emerald-300/90 leading-relaxed">{result.analysis.advisory}</p>
                  </div>
                )}

                {result.analysis?.error && (
                  <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {result.analysis.error}</p>
                )}
              </div>
            )}
          </>
        )}

        {tab === "Prediction" && (
          <div className="space-y-4">
            {!(userLat && userLng) && !(lat && lng) ? (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center space-y-4">
                <p className="text-4xl"></p>
                <p className="text-lg text-white font-medium">{t.aqiPredLocReq}</p>
                <p className="text-sm text-gray-400 max-w-md mx-auto">
                  {t.aqiPredLocReqDesc}
                </p>
                <button
                  onClick={() => setTab("Report")}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-colors inline-block mt-2"
                >
                  {t.alertsTabGoToReport}
                </button>
              </div>
            ) : (
              <AQIPredictorChart lat={userLat || parseFloat(lat)} lng={userLng || parseFloat(lng)} t={t} />
            )}
          </div>
        )}

        {tab === "Map" && (
          <MapTab userLat={userLat} userLng={userLng} onLocationDetected={handleLocationDetected} t={t} />
        )}

        {tab === "Alerts" && (
          <AlertsTab userLat={userLat} userLng={userLng} t={t} />
        )}

        {tab === "Chat" && (
          <ChatTab userLat={userLat} userLng={userLng} lang={lang} t={t} />
        )}

        {tab === "Municipal" && (
          <MunicipalTab userLat={userLat} userLng={userLng} t={t} />
        )}
      </main>

      {/* Settings / API URL Fallback Footer */}
      <footer className="w-full bg-gray-900 border-t border-gray-800 p-4 mt-8">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-xs text-gray-500">
            Current Backend URL: <span className="font-mono text-gray-400">{activeApiUrl}</span>
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="text" 
              placeholder="Custom Backend URL (e.g. https://...)" 
              value={customApiUrl}
              onChange={(e) => setCustomApiUrl(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white placeholder-gray-500 w-64 focus:outline-none focus:border-emerald-500"
            />
            <button 
              onClick={() => {
                if (customApiUrl) {
                  localStorage.setItem('airwatch_api_url', customApiUrl);
                } else {
                  localStorage.removeItem('airwatch_api_url');
                }
                window.location.reload();
              }}
              className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded transition-colors"
            >
              Save & Reload
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}