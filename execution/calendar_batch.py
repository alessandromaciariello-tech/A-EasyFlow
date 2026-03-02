"""
Calendar Batch — Operazioni batch su Google Calendar da CLI.
Reusa: backend/google_calendar.py, backend/scheduler.py
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime

from common import setup_backend_path, load_env, write_json, ensure_tmp_dir

load_env()
setup_backend_path()

import google_calendar  # noqa: E402
import scheduler  # noqa: E402


def list_events(date: str | None = None, days: int = 1) -> list:
    """Stampa gli eventi formattati per un intervallo di date."""
    events = google_calendar.get_events(date, days)

    if not events:
        print(f"Nessun evento trovato per {date or 'oggi'} (+{days} giorni)")
        return []

    print(f"\n--- Eventi: {date or 'oggi'} (+{days} giorni) — {len(events)} totali ---\n")

    for event in events:
        start = event.get("start", {})
        end = event.get("end", {})
        start_str = start.get("dateTime", start.get("date", "?"))
        end_str = end.get("dateTime", end.get("date", "?"))
        summary = event.get("summary", "(senza titolo)")

        # Formatta orari
        try:
            s = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            e = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            time_range = f"{s.strftime('%H:%M')} - {e.strftime('%H:%M')}"
        except (ValueError, AttributeError):
            time_range = f"{start_str} - {end_str}"

        print(f"  {time_range}  {summary}")

    return events


def clear_easyflow_events(date: str | None = None, days: int = 1) -> int:
    """Elimina tutti gli eventi creati da EasyFlow (con [EasyFlow] nella descrizione)."""
    events = google_calendar.get_events(date, days)
    deleted = 0

    for event in events:
        description = event.get("description", "")
        if "[EasyFlow]" in description:
            try:
                google_calendar.delete_event(event["id"])
                print(f"  Eliminato: {event.get('summary', '?')}")
                deleted += 1
            except Exception as e:
                print(f"  Errore eliminando {event.get('summary', '?')}: {e}")

    print(f"\n{deleted} eventi EasyFlow eliminati")
    return deleted


def export_events_json(date: str | None = None, days: int = 1, output_path: str | None = None) -> None:
    """Esporta gli eventi in formato JSON."""
    events = google_calendar.get_events(date, days)
    if output_path is None:
        output_path = str(ensure_tmp_dir() / "calendar_export.json")
    write_json(events, output_path)


def schedule_from_file(input_path: str) -> None:
    """Legge un file JSON di task e le schedula tutte.

    Formato file:
    [
      {"title": "...", "type": "deep_work|noise", "urgency": "asap|normal", "duration": 60},
      ...
    ]
    """
    with open(input_path) as f:
        tasks = json.load(f)

    if not isinstance(tasks, list):
        print("Errore: il file deve contenere un JSON array di task")
        return

    # Recupera eventi esistenti per conflict detection
    existing = google_calendar.get_events(days=14)

    for i, task in enumerate(tasks, 1):
        title = task.get("title", f"Task {i}")
        task_type = task.get("type", "deep_work")
        urgency = task.get("urgency", "normal")
        duration = task.get("duration", 60)

        try:
            slot = scheduler.find_next_available_slot(
                task_type=task_type,
                urgency=urgency,
                duration=duration,
                existing_events=existing,
            )

            event = google_calendar.create_event(
                title=title,
                start=slot["start"],
                end=slot["end"],
                description="[EasyFlow] Schedulato via batch",
            )

            print(f"  [{i}/{len(tasks)}] {title} → {slot['start']} - {slot['end']}")

            # Aggiungi l'evento appena creato per evitare conflitti con i prossimi
            existing.append(event)

        except Exception as e:
            print(f"  [{i}/{len(tasks)}] ERRORE: {title} — {e}")

    print(f"\nScheduling batch completato: {len(tasks)} task processate")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Calendar Batch CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    lp = sub.add_parser("list", help="Elenca eventi")
    lp.add_argument("--date", help="Data di partenza (YYYY-MM-DD, default: oggi)")
    lp.add_argument("--days", type=int, default=1, help="Numero di giorni (default: 1)")

    cp = sub.add_parser("clear-easyflow", help="Elimina eventi EasyFlow")
    cp.add_argument("--date", help="Data di partenza (YYYY-MM-DD)")
    cp.add_argument("--days", type=int, default=1, help="Numero di giorni")

    ep = sub.add_parser("export", help="Esporta eventi in JSON")
    ep.add_argument("--date", help="Data di partenza (YYYY-MM-DD)")
    ep.add_argument("--days", type=int, default=1, help="Numero di giorni")
    ep.add_argument("--output", help="Path file di output")

    sp = sub.add_parser("schedule", help="Scheduling batch da file JSON")
    sp.add_argument("input_path", help="Path del file JSON con le task")

    args = parser.parse_args()

    if args.command == "list":
        list_events(args.date, args.days)
    elif args.command == "clear-easyflow":
        clear_easyflow_events(args.date, args.days)
    elif args.command == "export":
        export_events_json(args.date, args.days, args.output)
    elif args.command == "schedule":
        schedule_from_file(args.input_path)
