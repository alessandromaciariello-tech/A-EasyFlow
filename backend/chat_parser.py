"""
AI Engine - Parsing dei messaggi naturali in task strutturate.
Usa Claude API per estrarre titolo, urgenza, tipo e durata dai messaggi dell'utente.
"""
import os
import re
import json
from datetime import datetime
from typing import List, Optional

import anthropic


def parse_tasks_from_message(user_message: str) -> List[dict]:
    """
    Analizza un messaggio in linguaggio naturale e ne estrae una o più task strutturate.

    Args:
        user_message: messaggio dell'utente in linguaggio naturale

    Returns:
        Lista di dict con: title, urgency, type, duration, preferred_date, preferred_time
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    now = datetime.now()
    date_context = now.strftime("%A %d %B %Y, ore %H:%M")
    iso_date = now.strftime("%Y-%m-%d")

    system_prompt = f"""Sei un assistente che analizza messaggi in linguaggio naturale per estrarre task strutturate.

DATA E ORA CORRENTE: {date_context} ({iso_date})

Per OGNI attività menzionata nel messaggio, estrai:
- "title": un titolo breve e chiaro per la task
- "urgency": "asap" se è urgente/immediata, "normal" altrimenti. Default: "normal"
- "type": "deep_work" se richiede concentrazione profonda (studio, scrittura, coding, analisi, progettazione), "noise" se è un'attività leggera (chiamate, email, meeting, admin, spostamenti, tragitti). Default: "deep_work"
- "duration": durata in minuti. Default: 60. Cambia SOLO se l'utente dice esplicitamente una durata.
- "duration_specified": BOOLEAN. true SOLO se l'utente ha scritto esplicitamente la durata per questa task (es: "30 minuti", "mezz'ora", "2 ore"). false se l'utente NON ha menzionato nessuna durata per questa task.
- "preferred_date": data desiderata in formato YYYY-MM-DD. Interpretala dal contesto:
  - "oggi" → {iso_date}
  - "domani" → il giorno dopo {iso_date}
  - "lunedì prossimo", "martedì" ecc → calcola la data corretta a partire da {iso_date}
  - Se non specificata, usa null (lo scheduler troverà il primo slot libero)
- "preferred_time": orario desiderato in formato HH:MM (24h). Es: "alle 16" → "16:00", "alle 9 e mezza" → "09:30". Se non specificato, usa null.
  IMPORTANTE per task relative (prima/dopo un'altra task):
  - "tragitto PRIMA dell'appuntamento alle 16, 30 minuti" → il tragitto deve FINIRE alle 16:00, quindi preferred_time = "15:30" (16:00 meno 30 minuti di durata)
  - "tragitto DOPO l'appuntamento alle 16" (appuntamento dura 60 min) → il tragitto deve INIZIARE quando l'appuntamento finisce, quindi preferred_time = "17:00" (16:00 più 60 minuti di durata dell'appuntamento)
  - Calcola sempre gli orari relativi in base alla durata delle task coinvolte.

Indizi per ASAP: "urgente", "subito", "ASAP", "adesso", "immediatamente", "prima possibile", "facciamolo subito"
Indizi per Deep Work: "scrivere", "programmare", "studiare", "analizzare", "progettare", "report", "documento", "coding", "concentrazione"
Indizi per Noise: "chiamare", "email", "riunione", "meeting", "telefonata", "rispondere", "admin", "organizzare", "fattura", "fornitore", "tragitto", "spostamento", "viaggio"

Rispondi SOLO con un JSON array valido. Anche se c'è una sola task, restituisci un array con un elemento.

Esempio input: "fissa appuntamento col commercialista domani alle 16 e 30 minuti di tragitto prima e 30 minuti di tragitto dopo"
Esempio output: [{{"title": "Tragitto per commercialista", "urgency": "normal", "type": "noise", "duration": 30, "duration_specified": true, "preferred_date": "2026-02-26", "preferred_time": "15:30"}}, {{"title": "Appuntamento commercialista", "urgency": "normal", "type": "noise", "duration": 60, "duration_specified": false, "preferred_date": "2026-02-26", "preferred_time": "16:00"}}, {{"title": "Tragitto da commercialista", "urgency": "normal", "type": "noise", "duration": 30, "duration_specified": true, "preferred_date": "2026-02-26", "preferred_time": "17:00"}}]
Nota: il tragitto "prima" ha preferred_time 15:30 (= 16:00 - 30min), l'appuntamento è alle 16:00, il tragitto "dopo" ha preferred_time 17:00 (= 16:00 + 60min durata appuntamento).

Niente markdown, niente testo aggiuntivo, solo il JSON array."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        system=system_prompt,
        messages=[
            {"role": "user", "content": user_message}
        ],
    )

    response_text = message.content[0].text.strip()

    raw_list = _extract_json_list(response_text)

    # Validazione e normalizzazione di ogni task
    tasks = []
    for item in raw_list:
        title = str(item.get("title", "Task senza titolo"))
        urgency = str(item.get("urgency", "normal")).lower()
        task_type = str(item.get("type", "deep_work")).lower()
        duration_specified = bool(item.get("duration_specified", False))

        # Se l'utente NON ha specificato la durata, forza 60 minuti
        # indipendentemente da cosa ha restituito l'AI
        if duration_specified:
            duration = int(item.get("duration", 60))
        else:
            duration = 60

        if urgency not in ("asap", "normal"):
            urgency = "normal"
        if task_type not in ("deep_work", "noise"):
            task_type = "noise"
        if duration < 5:
            duration = 15
        if duration > 480:
            duration = 480

        # Estrai preferred_date e preferred_time (possono essere null)
        preferred_date = item.get("preferred_date") or None
        preferred_time = item.get("preferred_time") or None

        # Validazione formato data
        if preferred_date:
            try:
                datetime.strptime(preferred_date, "%Y-%m-%d")
            except ValueError:
                preferred_date = None

        # Validazione formato orario
        if preferred_time:
            try:
                datetime.strptime(preferred_time, "%H:%M")
            except ValueError:
                preferred_time = None

        tasks.append({
            "title": title,
            "urgency": urgency,
            "type": task_type,
            "duration": duration,
            "preferred_date": preferred_date,
            "preferred_time": preferred_time,
        })

    if not tasks:
        raise ValueError("Nessuna task estratta dal messaggio")

    return tasks


def _extract_json_list(text: str) -> List[dict]:
    """Estrae una lista di oggetti JSON dal testo."""
    # Tentativo diretto
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict):
            return [data]
        return []
    except json.JSONDecodeError:
        pass

    # Fallback: cerca un array JSON [...] nel testo
    array_match = re.search(r'\[.*\]', text, re.DOTALL)
    if array_match:
        try:
            data = json.loads(array_match.group())
            if isinstance(data, list):
                return [item for item in data if isinstance(item, dict)]
        except json.JSONDecodeError:
            pass

    # Fallback: trova tutti i singoli oggetti {...}
    matches = re.findall(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text)
    results = []
    for match in matches:
        try:
            data = json.loads(match)
            if isinstance(data, dict):
                results.append(data)
        except json.JSONDecodeError:
            continue

    if results:
        return results

    raise ValueError(f"Risposta non valida dall'AI: {text}")
