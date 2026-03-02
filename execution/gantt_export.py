"""
Gantt Export/Import — Gestione progetto e template Gantt da CLI.
Reusa: backend/gantt_store.py, backend/gantt_templates.py
"""
from __future__ import annotations

import argparse

from common import setup_backend_path, write_json, ensure_tmp_dir

setup_backend_path()

import gantt_store  # noqa: E402
import gantt_templates  # noqa: E402


def export_project(output_path: str | None = None) -> dict:
    """Esporta il progetto Gantt corrente in JSON."""
    project = gantt_store.load_project()
    if output_path is None:
        output_path = str(ensure_tmp_dir() / "gantt_project.json")
    write_json(project, output_path)
    return project


def import_project(input_path: str) -> None:
    """Importa un progetto Gantt da file JSON (sovrascrive il corrente)."""
    import json
    with open(input_path) as f:
        project = json.load(f)
    gantt_store.save_project(project)
    print(f"Progetto importato da: {input_path}")
    sections = project.get("sections", [])
    total_tasks = sum(len(s.get("tasks", [])) for s in sections)
    print(f"  {len(sections)} sezioni, {total_tasks} task di primo livello")


def export_templates(output_path: str | None = None) -> list:
    """Esporta tutti i template (hardcoded + custom) in JSON."""
    templates = gantt_templates.get_templates()
    if output_path is None:
        output_path = str(ensure_tmp_dir() / "gantt_templates.json")
    write_json(templates, output_path)
    return templates


def list_sections() -> None:
    """Stampa la struttura del progetto corrente."""
    project = gantt_store.load_project()
    sections = project.get("sections", [])

    if not sections:
        print("Progetto vuoto (nessuna sezione)")
        return

    print(f"Progetto: {project.get('name', 'Senza nome')}")
    print(f"Sezioni: {len(sections)}\n")

    for i, section in enumerate(sections, 1):
        tasks = section.get("tasks", [])
        print(f"  {i}. {section['title']} ({len(tasks)} task)")
        for j, task in enumerate(tasks, 1):
            children_count = len(task.get("children", []))
            progress = task.get("progress", 0)
            suffix = f" [{children_count} subtask]" if children_count > 0 else ""
            print(f"     {j}. {task['title']} — {task.get('duration', 0)}gg, {progress}%{suffix}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gantt Export/Import CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    ep = sub.add_parser("export-project", help="Esporta progetto Gantt in JSON")
    ep.add_argument("--output", help="Path file di output")

    ip = sub.add_parser("import-project", help="Importa progetto Gantt da JSON")
    ip.add_argument("input_path", help="Path del file JSON da importare")

    et = sub.add_parser("export-templates", help="Esporta tutti i template in JSON")
    et.add_argument("--output", help="Path file di output")

    sub.add_parser("list", help="Stampa struttura progetto corrente")

    args = parser.parse_args()

    if args.command == "export-project":
        export_project(args.output)
    elif args.command == "import-project":
        import_project(args.input_path)
    elif args.command == "export-templates":
        export_templates(args.output)
    elif args.command == "list":
        list_sections()
