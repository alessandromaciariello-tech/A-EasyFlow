"""
Integrazione Google Calendar API (OAuth2)
Gestisce autenticazione, lettura e scrittura eventi.
"""
import os
import json
from datetime import datetime, timedelta
from typing import List, Optional

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/calendar"]
CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), "..", "credentials.json")
TOKEN_FILE = os.path.join(os.path.dirname(__file__), "..", "token.json")
REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/callback")

# Fallback: se il file non esiste, crealo da env var (per deploy su Render/Railway)
def _ensure_credentials_file():
    if not os.path.exists(CREDENTIALS_FILE):
        creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
        if creds_json:
            with open(CREDENTIALS_FILE, "w") as f:
                f.write(creds_json)

def _ensure_token_file():
    if not os.path.exists(TOKEN_FILE):
        token_json = os.getenv("GOOGLE_TOKEN_JSON")
        if token_json:
            with open(TOKEN_FILE, "w") as f:
                f.write(token_json)

_ensure_credentials_file()
_ensure_token_file()


def get_auth_url() -> str:
    """Genera l'URL per il flusso OAuth2 di Google."""
    flow = Flow.from_client_secrets_file(
        CREDENTIALS_FILE,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return auth_url


def handle_callback(authorization_code: str) -> dict:
    """Gestisce il callback OAuth2 e salva il token."""
    flow = Flow.from_client_secrets_file(
        CREDENTIALS_FILE,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
    )
    flow.fetch_token(code=authorization_code)
    creds = flow.credentials

    # Salva il token per sessioni future
    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }
    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f)

    return {"status": "authenticated"}


def get_credentials() -> Optional[Credentials]:
    """Carica le credenziali salvate, rinnovandole se necessario."""
    if not os.path.exists(TOKEN_FILE):
        return None

    with open(TOKEN_FILE) as f:
        token_data = json.load(f)

    creds = Credentials(
        token=token_data["token"],
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data["token_uri"],
        client_id=token_data["client_id"],
        client_secret=token_data["client_secret"],
        scopes=token_data.get("scopes"),
    )

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        # Aggiorna il token salvato
        token_data["token"] = creds.token
        with open(TOKEN_FILE, "w") as f:
            json.dump(token_data, f)

    return creds


def get_calendar_service():
    """Restituisce il servizio Google Calendar autenticato."""
    creds = get_credentials()
    if not creds:
        raise ValueError("Non autenticato. Effettua prima il login con Google.")
    return build("calendar", "v3", credentials=creds)


def get_events(date_str: Optional[str] = None, days: int = 1) -> List[dict]:
    """
    Recupera gli eventi da tutti i calendari visibili per un intervallo di date.

    Args:
        date_str: data di partenza in formato YYYY-MM-DD (default: oggi)
        days: numero di giorni da recuperare (default: 1)
    """
    service = get_calendar_service()

    if date_str:
        start_date = datetime.fromisoformat(date_str)
    else:
        start_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    end_date = start_date + timedelta(days=days)

    time_min = start_date.isoformat() + "Z"
    time_max = end_date.isoformat() + "Z"

    # Recupera tutti i calendari visibili dall'utente
    calendar_list = service.calendarList().list().execute()
    calendars = calendar_list.get("items", [])

    all_events = []  # type: List[dict]
    for cal in calendars:
        cal_id = cal["id"]
        try:
            events_result = service.events().list(
                calendarId=cal_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
            ).execute()
            all_events.extend(events_result.get("items", []))
        except Exception:
            # Calendario non accessibile, skip
            continue

    # Ordina tutti gli eventi per orario di inizio
    all_events.sort(key=lambda e: e.get("start", {}).get("dateTime", e.get("start", {}).get("date", "")))

    return all_events


def create_event(title: str, start: str, end: str, description: str = "") -> dict:
    """
    Crea un nuovo evento su Google Calendar.

    Args:
        title: titolo dell'evento
        start: data/ora di inizio in formato ISO
        end: data/ora di fine in formato ISO
        description: descrizione opzionale
    """
    service = get_calendar_service()

    event_body = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start, "timeZone": "Europe/Rome"},
        "end": {"dateTime": end, "timeZone": "Europe/Rome"},
    }

    event = service.events().insert(
        calendarId="primary",
        body=event_body,
    ).execute()

    return event


def update_event_times(event_id: str, end_datetime: Optional[str] = None, start_datetime: Optional[str] = None) -> Optional[dict]:
    """Aggiorna gli orari di un evento su Google Calendar. Torna None se l'evento non esiste."""
    service = get_calendar_service()
    body: dict = {}
    if start_datetime:
        body["start"] = {"dateTime": start_datetime, "timeZone": "Europe/Rome"}
    if end_datetime:
        body["end"] = {"dateTime": end_datetime, "timeZone": "Europe/Rome"}
    try:
        return service.events().patch(
            calendarId="primary",
            eventId=event_id,
            body=body,
        ).execute()
    except HttpError as e:
        if e.resp.status in (404, 410):
            return None
        raise


def delete_event(event_id: str) -> None:
    """Elimina un evento dal Google Calendar. Ignora se gia' cancellato (404/410)."""
    service = get_calendar_service()
    try:
        service.events().delete(calendarId="primary", eventId=event_id).execute()
    except HttpError as e:
        if e.resp.status in (404, 410):
            return
        raise
