"""
Motore di Scheduling - Business Logic

Definizione Slot Temporali:
- Deep Work Window: 09:00 - 13:30
- Noise Window: 14:30 - 20:00

Logica dei Tag:
- ASAP (qualsiasi tipo): Priorità massima. Primo slot libero assoluto.
  Se ASAP + Noise, ignora la restrizione pomeridiana.
- Normal + Deep Work: Solo tra 09:00 e 13:30.
- Normal + Noise: Solo tra 14:30 e 20:00.
"""
from datetime import datetime, timedelta, time
from typing import Dict, List, Optional, Tuple


# Definizione finestre temporali
DEEP_WORK_START = time(9, 0)
DEEP_WORK_END = time(13, 30)
NOISE_START = time(14, 30)
NOISE_END = time(20, 0)

# Granularità degli slot (minuti)
SLOT_GRANULARITY = 15


def find_next_available_slot(
    task_type: str,
    urgency: str,
    duration: int,
    existing_events: List[dict],
    reference_time: Optional[datetime] = None,
    pinned: bool = False,
) -> dict:
    """
    Trova il prossimo slot disponibile per una task.

    Args:
        task_type: "deep_work" o "noise"
        urgency: "asap" o "normal"
        duration: durata in minuti
        existing_events: lista di eventi esistenti con "start" e "end" (datetime ISO strings)
        reference_time: orario di riferimento (default: now)
        pinned: se True, l'utente ha specificato un orario esatto.
                Bypassa le finestre e piazza la task al reference_time.

    Returns:
        dict con "start" e "end" (datetime ISO strings) dello slot trovato
    """
    if reference_time is None:
        reference_time = datetime.now()

    # Normalizza i valori
    task_type = task_type.lower().replace(" ", "_")
    urgency = urgency.lower()

    # Parsa gli eventi esistenti in intervalli (start, end)
    busy_intervals = _parse_busy_intervals(existing_events)

    # Cerca fino a 14 giorni avanti
    max_search_days = 14

    # Se l'utente ha specificato un orario esatto, rispettalo
    # (ignora le finestre Deep Work/Noise)
    if pinned:
        return _find_pinned_slot(reference_time, duration, busy_intervals)

    if urgency == "asap":
        return _find_asap_slot(reference_time, duration, busy_intervals, max_search_days)
    elif task_type == "deep_work":
        return _find_window_slot(
            reference_time, duration, busy_intervals,
            DEEP_WORK_START, DEEP_WORK_END, max_search_days
        )
    else:  # noise
        return _find_window_slot(
            reference_time, duration, busy_intervals,
            NOISE_START, NOISE_END, max_search_days
        )


def _parse_busy_intervals(events: List[dict]) -> List[Tuple[datetime, datetime]]:
    """Converte la lista di eventi in intervalli (start, end) ordinati."""
    intervals = []
    for event in events:
        start = event.get("start", {})
        end = event.get("end", {})

        # Gestisci sia dateTime che date (eventi all-day)
        start_str = start.get("dateTime") or start.get("date")
        end_str = end.get("dateTime") or end.get("date")

        if not start_str or not end_str:
            continue

        try:
            s = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            e = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            # Rimuovi timezone info per confronto naive
            s = s.replace(tzinfo=None)
            e = e.replace(tzinfo=None)
            intervals.append((s, e))
        except (ValueError, AttributeError):
            continue

    intervals.sort(key=lambda x: x[0])
    return intervals


def _is_slot_free(
    start: datetime,
    end: datetime,
    busy_intervals: List[Tuple[datetime, datetime]],
) -> bool:
    """Verifica che lo slot non si sovrapponga con nessun evento esistente."""
    for busy_start, busy_end in busy_intervals:
        # C'è sovrapposizione se lo slot inizia prima che l'evento finisca
        # e finisce dopo che l'evento inizia
        if start < busy_end and end > busy_start:
            return False
    return True


def _find_pinned_slot(
    reference_time: datetime,
    duration: int,
    busy_intervals: List[Tuple[datetime, datetime]],
) -> dict:
    """
    Piazza la task esattamente al reference_time (orario scelto dall'utente).
    Ignora le finestre Deep Work/Noise. Controlla solo conflitti con eventi esistenti.
    Se lo slot esatto è occupato, cerca il più vicino possibile (stesso giorno, qualsiasi ora).
    """
    candidate = _ceil_to_granularity(reference_time)
    task_duration = timedelta(minutes=duration)
    slot_end = candidate + task_duration

    # Prova lo slot esatto
    if _is_slot_free(candidate, slot_end, busy_intervals):
        return {
            "start": candidate.isoformat(),
            "end": slot_end.isoformat(),
        }

    # Se occupato, cerca lo slot libero più vicino nello stesso giorno (00:00-23:59)
    day_start = candidate.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(hours=24)

    search = day_start
    while search + task_duration <= day_end:
        s_end = search + task_duration
        if _is_slot_free(search, s_end, busy_intervals):
            return {
                "start": search.isoformat(),
                "end": s_end.isoformat(),
            }
        search += timedelta(minutes=SLOT_GRANULARITY)

    raise ValueError("Nessuno slot disponibile nel giorno richiesto")


def _find_asap_slot(
    reference_time: datetime,
    duration: int,
    busy_intervals: List[Tuple[datetime, datetime]],
    max_days: int,
) -> dict:
    """
    ASAP: cerca il primo slot libero assoluto nelle finestre lavorative.
    Ignora le restrizioni di tipo (deep_work/noise).
    Cerca in entrambe le finestre: 09:00-13:30 e 14:30-20:00.
    """
    current_date = reference_time.date()

    for day_offset in range(max_days):
        check_date = current_date + timedelta(days=day_offset)

        # Definisci le finestre per questo giorno
        windows = [
            (datetime.combine(check_date, DEEP_WORK_START),
             datetime.combine(check_date, DEEP_WORK_END)),
            (datetime.combine(check_date, NOISE_START),
             datetime.combine(check_date, NOISE_END)),
        ]

        for window_start, window_end in windows:
            # Salta finestre già passate
            effective_start = max(window_start, reference_time)
            # Arrotonda al prossimo slot di SLOT_GRANULARITY minuti
            effective_start = _ceil_to_granularity(effective_start)

            if effective_start >= window_end:
                continue

            slot = _scan_window(effective_start, window_end, duration, busy_intervals)
            if slot:
                return slot

    raise ValueError("Nessuno slot disponibile trovato nei prossimi 14 giorni")


def _find_window_slot(
    reference_time: datetime,
    duration: int,
    busy_intervals: List[Tuple[datetime, datetime]],
    window_start_time: time,
    window_end_time: time,
    max_days: int,
) -> dict:
    """Cerca il primo slot libero in una finestra specifica (Deep Work o Noise)."""
    current_date = reference_time.date()

    for day_offset in range(max_days):
        check_date = current_date + timedelta(days=day_offset)
        window_start = datetime.combine(check_date, window_start_time)
        window_end = datetime.combine(check_date, window_end_time)

        # Salta finestre già passate
        effective_start = max(window_start, reference_time)
        effective_start = _ceil_to_granularity(effective_start)

        if effective_start >= window_end:
            continue

        slot = _scan_window(effective_start, window_end, duration, busy_intervals)
        if slot:
            return slot

    raise ValueError("Nessuno slot disponibile trovato nei prossimi 14 giorni")


def _scan_window(
    start: datetime,
    end: datetime,
    duration: int,
    busy_intervals: List[Tuple[datetime, datetime]],
) -> Optional[dict]:
    """Scansiona una finestra temporale cercando uno slot libero della durata richiesta."""
    candidate = start
    task_duration = timedelta(minutes=duration)

    while candidate + task_duration <= end:
        slot_end = candidate + task_duration

        if _is_slot_free(candidate, slot_end, busy_intervals):
            return {
                "start": candidate.isoformat(),
                "end": slot_end.isoformat(),
            }

        # Avanza al prossimo slot
        candidate += timedelta(minutes=SLOT_GRANULARITY)

    return None


def _ceil_to_granularity(dt: datetime) -> datetime:
    """Arrotonda per eccesso al prossimo multiplo di SLOT_GRANULARITY minuti."""
    minutes = dt.minute
    remainder = minutes % SLOT_GRANULARITY
    if remainder == 0 and dt.second == 0:
        return dt.replace(second=0, microsecond=0)
    add_minutes = SLOT_GRANULARITY - remainder
    return (dt + timedelta(minutes=add_minutes)).replace(second=0, microsecond=0)
