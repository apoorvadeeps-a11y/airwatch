import os
from dotenv import load_dotenv
load_dotenv()

from main import send_thank_you_email
import sys

print("EMAIL_USER:", os.getenv("EMAIL_USER"))
print("EMAIL_APP_PASSWORD:", "*" * len(os.getenv("EMAIL_APP_PASSWORD", "")))

try:
    send_thank_you_email("apoorvadeeps@gmail.com", "Test Location", 3)
    print("Email script finished.")
except Exception as e:
    print("Error:", e)
