import asyncio
import json
import re
from main import call_gemini

async def test():
    prompt = """You are an air quality expert. Be EXTREMELY BRIEF — every text field must be 10 words or fewer. No long sentences.

USER REPORT:
Location: Test Location (lat: 19.0, lng: 72.0)
Description: I see heavy black smoke coming from a factory nearby.

GOVERNMENT DATA:
Nearest government station: Test Station (City, State) — AQI 150, dominant pollutant: PM2.5, distance: 5.0km away.

No photo — use text and government data only.

CRITICAL RULE: If the text/photo has no visible pollution indicators (e.g., it is just a random object, person, an unreadable/too-dark image, or an irrelevant word like "Charger"), you MUST set "pollution_detected" to false, set severity to 1, return empty arrays for possible_sources, precautions, and measures, and set the summary to "No visible pollution detected". Do NOT invent a severity, pollutant, or location if you are not actually able to assess the image or text — say so honestly via "pollution_detected": false instead of guessing.

Respond in this EXACT JSON format:
{
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
}
IMPORTANT: Respond with ONLY the JSON. No markdown. No extra text."""

    try:
        raw = await call_gemini(prompt)
        print("RAW RESPONSE:")
        print(raw)
        
        # Copied extraction logic
        cleaned = raw.strip()
        if "\'\'\'" in cleaned:
            match = re.search(r'\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`', cleaned)
            if match:
                cleaned = match.group(1).strip()
                print("Matched single quote condition.")
        
        try:
            analysis = json.loads(cleaned)
            print("Parsed directly!")
        except json.JSONDecodeError as e:
            print("Failed direct parse:", e)
            json_match = re.search(r'\{[\s\S]*\}', cleaned)
            if json_match:
                try:
                    analysis = json.loads(json_match.group())
                    print("Parsed with regex!")
                except Exception as e2:
                    print("Failed regex parse:", e2)
            else:
                print("Could not extract JSON.")
                
    except Exception as e:
        print(f"Error text: {e}")

if __name__ == "__main__":
    asyncio.run(test())
