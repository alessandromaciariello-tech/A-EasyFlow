"""
Integrazione Google Calendar API (OAuth2)
Gestisce autenticazione, lettura e scrittura eventi.
Token OAuth salvato in Supabase per persistenza su Vercel.
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
from storage_helper import load_json, save_json

SCOPES = ["https://www.googleapis.com/auth/calendar"]
_LOCAL_CREDS = os.path.join(os.path.dirname(__file__), "..", "credentials.json")
# On Vercel, filesystem is read-only — use /tmp for credentials file
CREDENTIALS_FILE = _LOCAL_CREDS if os.path.exists(_LOCAL_CREDS) else "/tmp/credentials.json"
REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/callback")


def _ensure_credentials_file():
    """Create credentials.json from env var if file doesn't exist (cloud deploy)."""
    if not os.path.exists(CREDENTIALS_FILE):
        creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
        if creds_json:
            with open(CREDENTIALS_FILE, "w") as f:
                f.write(creds_json)

try:
    _ensure_credentials_file()
except Exception:
    pass


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
    """Gestisce il callback OAuth2 e salva il token nel DB."""
    flow = Flow.from_client_secrets_file(
        CREDENTIALS_FILE,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
    )
    flow.fetch_token(code=authorization_code)
    creds = flow.credentials

    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }
    save_json("google_token", token_data)

    return {"status": "authenticated"}


def get_credentials() -> Optional[Credentials]:
    """Carica le credenziali salvate dal DB, rinnovandole se necessario."""
    token_data = load_json("google_token")
    if token_data is None:
        return None

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
        token_data["token"] = creds.token
        save_json("google_token", token_data)

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
