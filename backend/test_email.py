import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_APP_PASSWORD = os.getenv("EMAIL_APP_PASSWORD")

def test_email():
    if not EMAIL_USER or not EMAIL_APP_PASSWORD:
        print("Missing credentials")
        return

    print(f"Testing with USER: {EMAIL_USER}")
    
    try:
        msg = MIMEMultipart()
        msg['From'] = EMAIL_USER
        msg['To'] = EMAIL_USER
        msg['Subject'] = "Test Email"
        msg.attach(MIMEText("Test", 'plain'))
        
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.set_debuglevel(1)
        server.starttls()
        server.login(EMAIL_USER, EMAIL_APP_PASSWORD)
        server.send_message(msg)
        server.quit()
        print("Success")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    test_email()
