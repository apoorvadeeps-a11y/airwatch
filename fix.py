import sys
import re

file_path = 'frontend/src/App.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace Your location popup
content = re.sub(r'bindPopup\("<b>([^<]+) \{t\.mapTabYourLoc\}</b>"\)', r'bindPopup(`<b>\1 ${t.mapTabYourLoc}</b>`)', content)

# Replace Refresh button
content = re.sub(r'\{locating \? "\.\.\." : "([^"]+) Refresh"\}', r'{locating ? "..." : `\1 ${t.mapTabRefresh}`}', content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Replaced successfully')
