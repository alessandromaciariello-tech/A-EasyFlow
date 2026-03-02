"""Utility condivise per tutti gli script di esecuzione."""
from __future__ import annotations

import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Root del progetto (due livelli su da execution/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
TMP_DIR = PROJECT_ROOT / ".tmp"


def setup_backend_path():
    """Aggiunge backend/ a sys.path per import diretti dei moduli backend."""
    backend_str = str(BACKEND_DIR)
    if backend_str not in sys.path:
        sys.path.insert(0, backend_str)


def load_env():
    """Carica le variabili d'ambiente da .env nella root del progetto."""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'\"")
            os.environ.setdefault(key, value)


def ensure_tmp_dir(subdir: str = "") -> Path:
    """Crea .tmp/ (e opzionalmente una sottodirectory) se non esiste. Ritorna il path."""
    target = TMP_DIR / subdir if subdir else TMP_DIR
    target.mkdir(parents=True, exist_ok=True)
    return target


def write_json(data, path: str | Path):
    """Scrive dati in formato JSON con indentazione leggibile."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    print(f"Scritto: {path}")


def write_csv(rows: list[dict], headers: list[str], path: str | Path):
    """Scrive una lista di dizionari in formato CSV."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Scritto: {path}")


def timestamp_str() -> str:
    """Ritorna un timestamp nel formato YYYYMMDD_HHMMSS."""
    return datetime.now().strftime("%Y%m%d_%H%M%S")
