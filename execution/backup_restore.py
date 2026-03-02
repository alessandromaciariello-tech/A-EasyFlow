"""
Backup & Restore — Salvataggio e ripristino dei file dati JSON.
Copia/ripristina: gantt_data.json, gantt_custom_templates.json,
gantt_hidden_templates.json, inventory_data.json.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from common import BACKEND_DIR, TMP_DIR, ensure_tmp_dir, timestamp_str


DATA_FILES = [
    "gantt_data.json",
    "gantt_custom_templates.json",
    "gantt_hidden_templates.json",
    "inventory_data.json",
]


def backup_all(output_dir: str | None = None) -> Path:
    """Copia tutti i file dati in una directory di backup timestamped."""
    if output_dir:
        backup_dir = Path(output_dir)
    else:
        backup_dir = ensure_tmp_dir(f"backup_{timestamp_str()}")

    backup_dir.mkdir(parents=True, exist_ok=True)
    copied = 0

    for filename in DATA_FILES:
        src = BACKEND_DIR / filename
        if src.exists():
            shutil.copy2(src, backup_dir / filename)
            copied += 1
            print(f"  Copiato: {filename}")
        else:
            print(f"  Skippato (non esiste): {filename}")

    print(f"\nBackup completato: {copied} file in {backup_dir}")
    return backup_dir


def restore(backup_dir: str) -> None:
    """Ripristina i file dati da una directory di backup."""
    backup_path = Path(backup_dir)
    if not backup_path.exists():
        print(f"Errore: directory di backup non trovata: {backup_dir}")
        return

    restored = 0
    for filename in DATA_FILES:
        src = backup_path / filename
        if src.exists():
            dst = BACKEND_DIR / filename
            shutil.copy2(src, dst)
            restored += 1
            print(f"  Ripristinato: {filename}")
        else:
            print(f"  Skippato (non nel backup): {filename}")

    print(f"\nRestore completato: {restored} file ripristinati")


def list_backups() -> list[Path]:
    """Elenca i backup disponibili in .tmp/."""
    if not TMP_DIR.exists():
        print("Nessun backup trovato (.tmp/ non esiste)")
        return []

    backups = sorted(
        [d for d in TMP_DIR.iterdir() if d.is_dir() and d.name.startswith("backup_")],
        reverse=True,
    )

    if not backups:
        print("Nessun backup trovato in .tmp/")
        return []

    print(f"Backup disponibili ({len(backups)}):")
    for b in backups:
        files = [f.name for f in b.iterdir() if f.is_file()]
        print(f"  {b.name}  ({len(files)} file: {', '.join(files)})")

    return backups


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backup & Restore dati EasyFlow")
    sub = parser.add_subparsers(dest="command", required=True)

    bp = sub.add_parser("backup", help="Crea un backup dei file dati")
    bp.add_argument("--output", help="Directory di output (default: .tmp/backup_TIMESTAMP)")

    rp = sub.add_parser("restore", help="Ripristina da un backup")
    rp.add_argument("backup_dir", help="Path della directory di backup")

    sub.add_parser("list", help="Elenca i backup disponibili")

    args = parser.parse_args()

    if args.command == "backup":
        backup_all(args.output)
    elif args.command == "restore":
        restore(args.backup_dir)
    elif args.command == "list":
        list_backups()
