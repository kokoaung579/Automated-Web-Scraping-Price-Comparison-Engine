import sys
from pathlib import Path
from email.message import EmailMessage
import smtplib

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import (
    get_gmail_smtp_email,
    get_gmail_app_password,
    get_gmail_smtp_host,
    get_gmail_smtp_port,
)

sender = get_gmail_smtp_email()
password = get_gmail_app_password()

if not sender or not password:
    raise RuntimeError("Gmail SMTP credentials are missing.")

message = EmailMessage()
message["Subject"] = "PricePilot Gmail SMTP Test"
message["From"] = sender
message["To"] = sender
message.set_content(
    "Congratulations! PricePilot Gmail SMTP is working."
)

try:
    with smtplib.SMTP(
        get_gmail_smtp_host(),
        get_gmail_smtp_port(),
        timeout=20,
    ) as server:
        server.starttls()
        server.login(sender, password)
        server.send_message(message)

    print("SUCCESS: Test email sent. Check your Gmail inbox.")

except Exception as error:
    print("FAILED:", type(error).__name__, str(error))