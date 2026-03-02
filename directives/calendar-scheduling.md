# Calendar & Scheduling - SOP

## Scope
Integrazione Google Calendar API con EasyFlow per:
1. Autenticazione OAuth2 e gestione token
2. Lettura eventi da tutti i calendari visibili
3. Creazione/eliminazione eventi sul calendario primario
4. Scheduling intelligente con finestre Deep Work / Noise

## Autenticazione
- **Metodo**: OAuth2 con refresh token
- **Scopes**: `https://www.googleapis.com/auth/calendar`
- **Redirect URI**: `http://localhost:8000/api/auth/callback` (configurabile via env `GOOGLE_REDIRECT_URI`)
- **File credenziali**: `credentials.json` (root, fuori git)
- **File token**: `token.json` (root, fuori git — creato dopo primo login)

### Setup Credenziali
1. Google Cloud Console → APIs & Services → Credentials
2. Creare OAuth 2.0 Client ID (tipo "Web Application")
3. Aggiungere `http://localhost:8000/api/auth/callback` come Authorized Redirect URI
4. Scaricare il JSON e salvarlo come `credentials.json` nella root del progetto
5. Abilitare Google Calendar API nel progetto GCP

### Flusso OAuth
1. Frontend chiama `GET /api/auth/google` → riceve URL di autorizzazione
2. Utente autorizza → Google reindirizza a `/api/auth/callback?code=...`
3. Backend scambia il code per un refresh token → salva in `token.json`
4. Token rinnovato automaticamente quando scade (`creds.refresh()`)

## Tool di Esecuzione
- **`backend/google_calendar.py`**: OAuth flow, lettura/scrittura/cancellazione eventi
- **`backend/scheduler.py`**: motore di scheduling con finestre temporali e conflict detection
- **`backend/chat_parser.py`**: parsing AI del linguaggio naturale in task strutturate
- **`execution/calendar_batch.py`**: operazioni batch (lista, export, scheduling da file)

## Finestre Temporali
| Finestra | Orario | Uso |
|----------|--------|-----|
| Deep Work | 09:00 – 13:30 | Concentrazione: studio, coding, scrittura, analisi |
| Noise | 14:30 – 20:00 | Attività leggere: chiamate, email, meeting, spostamenti |

## Modalità di Scheduling
| Modalità | Comportamento |
|----------|---------------|
| **Normal + Deep Work** | Solo nella finestra 09:00–13:30 |
| **Normal + Noise** | Solo nella finestra 14:30–20:00 |
| **ASAP** (qualsiasi tipo) | Primo slot libero in qualsiasi finestra lavorativa |
| **Pinned** | Orario esatto scelto dall'utente, ignora finestre. Se occupato, cerca il più vicino nello stesso giorno |

## Regole di Scheduling
1. **Granularità**: slot da 15 minuti
2. **Ricerca**: fino a 14 giorni nel futuro
3. **Conflict detection**: controlla tutti i calendari visibili dell'utente
4. **Eventi all-day**: gestiti come intervalli di blocco (dalla mezzanotte alla mezzanotte)
5. **Timezone**: `Europe/Rome` per tutti gli eventi creati
6. **Arrotondamento**: orario di inizio arrotondato per eccesso al prossimo multiplo di 15min

## API Endpoints
| Endpoint | Metodo | Scopo |
|----------|--------|-------|
| `/api/auth/google` | GET | Genera URL autorizzazione OAuth |
| `/api/auth/callback` | GET | Gestisce callback OAuth, salva token |
| `/api/auth/status` | GET | Verifica se l'utente è autenticato |
| `/api/calendar/events` | GET | Recupera eventi (query: `date`, `days`) |
| `/api/calendar/events/{id}` | DELETE | Elimina un evento |
| `/api/tasks/schedule` | POST | Crea evento con slot automatico |

## Gestione Errori
- **Credenziali mancanti**: risponde 401 con messaggio "Non autenticato"
- **Token scaduto**: rinnovo automatico via refresh token
- **Calendario non accessibile**: skip silenzioso, continua con gli altri
- **Nessuno slot disponibile**: risponde con errore "Nessuno slot disponibile nei prossimi 14 giorni"
- **Orario pinned occupato**: cerca il più vicino nello stesso giorno; se tutto pieno, errore
