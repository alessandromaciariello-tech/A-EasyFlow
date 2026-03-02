# Chat AI Parsing - SOP

## Scope
Motore NLP basato su Claude per:
1. Estrazione di task strutturate dal linguaggio naturale italiano
2. Analisi trend Shopify con suggerimenti modifiche Gantt

## Configurazione
- **Modello**: `claude-sonnet-4-20250514`
- **API Key**: `ANTHROPIC_API_KEY` in `.env`
- **Max tokens**: 512 (parsing task), 1024 (analisi Shopify)
- **Lingua**: italiano (sistema prompt, output, contesto date)

## Tool di Esecuzione
- **`backend/chat_parser.py`**: parsing linguaggio naturale → task strutturate
- **`backend/shopify_analyzer.py`**: analisi AI trend vendite → suggerimenti Gantt

## Schema Output Task
Ogni task estratta contiene:
```json
{
  "title": "string — titolo breve e chiaro",
  "urgency": "asap | normal",
  "type": "deep_work | noise",
  "duration": "int — minuti (5-480)",
  "duration_specified": "bool — true solo se l'utente ha scritto la durata",
  "preferred_date": "YYYY-MM-DD | null",
  "preferred_time": "HH:MM | null"
}
```

## Regole di Parsing

### Classificazione Urgenza
- **ASAP**: "urgente", "subito", "ASAP", "adesso", "immediatamente", "prima possibile"
- **Normal**: default per tutto il resto

### Classificazione Tipo
- **Deep Work**: "scrivere", "programmare", "studiare", "analizzare", "progettare", "report", "documento", "coding"
- **Noise**: "chiamare", "email", "riunione", "meeting", "telefonata", "admin", "fattura", "tragitto", "spostamento"

### Regole Durata
1. Se `duration_specified: false` → la durata viene forzata a **60 minuti**, indipendentemente da cosa restituisce l'AI
2. Se `duration_specified: true` → viene usato il valore dell'AI
3. Durata minima: 5 minuti (sotto → arrotondato a 15)
4. Durata massima: 480 minuti (8 ore)

### Date e Orari Relativi
- "oggi" → data corrente ISO
- "domani" → giorno successivo
- "lunedì prossimo", "martedì" → calcolato da data corrente
- **Orari relativi** (prima/dopo un appuntamento):
  - "30 min prima delle 16:00" → `preferred_time = 15:30` (16:00 - 30min durata)
  - "dopo l'appuntamento alle 16" (durata 60min) → `preferred_time = 17:00` (16:00 + 60min)

## Fallback Estrazione JSON
Se la risposta AI non è JSON valido, la catena di fallback è:
1. `json.loads()` diretto
2. Regex: cerca array `[...]` nel testo
3. Regex: trova singoli oggetti `{...}` nel testo
4. Se tutto fallisce: `ValueError("Risposta non valida dall'AI")`

## Routing Shopify
- Il frontend rileva query relative a Shopify tramite regex (parole come "shopify", "vendite", "ordini")
- Le query Shopify vengono instradate a `POST /api/chat/shopify-suggest` (usa `shopify_analyzer.py`)
- Tutte le altre query vanno a `POST /api/chat/parse` (usa `chat_parser.py`)

## Suggerimenti Shopify
1. L'AI confronta trend vendite periodo corrente vs periodo precedente
2. Suggerisce modifiche durate task Gantt supply chain
3. Formato suggerimento: `{ type, section_id, task_id, task_title, current_duration, suggested_duration, reason }`
4. I suggerimenti NON vengono mai applicati automaticamente
5. L'utente deve cliccare "Applica" per ogni singola modifica

## API Endpoints
| Endpoint | Metodo | Scopo |
|----------|--------|-------|
| `/api/chat/parse` | POST | Parsing messaggio → task strutturate |
| `/api/chat/shopify-suggest` | POST | Analisi Shopify + suggerimenti Gantt |

## Gestione Errori
- **API key mancante**: errore esplicito "ANTHROPIC_API_KEY non configurata"
- **Nessuna task estratta**: `ValueError("Nessuna task estratta dal messaggio")`
- **JSON malformato**: catena di fallback (vedi sopra)
- **Errore API Claude**: propagato al chiamante con messaggio originale
