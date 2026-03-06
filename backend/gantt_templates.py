"""
Gantt Templates - Pre-built process templates for common workflows.
Supports hardcoded defaults + user-created custom templates (JSON persistence).
"""
import os
import json
import uuid
from typing import Any, Dict, List, Optional
from storage_helper import get_data_path


CUSTOM_FILE = get_data_path("gantt_custom_templates.json")
HIDDEN_FILE = get_data_path("gantt_hidden_templates.json")


# --- Hardcoded default templates ---

TEMPLATES = [
    # --- Supply Chain ---
    {
        "id": "metal-sheet",
        "name": "Metal Sheet",
        "category": "Supply Chain",
        "description": "Approvvigionamento lamiere",
        "sections": [
            {
                "title": "Metal Sheet - Restock",
                "tasks": [
                    {"title": "Richiesta preventivo fornitori", "duration": 2, "offset": 0},
                    {"title": "Confronto offerte", "duration": 1, "offset": 2},
                    {"title": "Approvazione ordine", "duration": 1, "offset": 3},
                    {"title": "Produzione fornitore", "duration": 7, "offset": 4},
                    {"title": "Spedizione e trasporto", "duration": 3, "offset": 11},
                    {"title": "Controllo qualità arrivo", "duration": 1, "offset": 14},
                ],
            }
        ],
    },
    {
        "id": "china-export",
        "name": "China Export",
        "category": "Supply Chain",
        "description": "Import materiali dalla Cina",
        "sections": [
            {
                "title": "China Export - Import",
                "tasks": [
                    {"title": "Selezione fornitore", "duration": 3, "offset": 0},
                    {"title": "Negoziazione e contratto", "duration": 5, "offset": 3},
                    {"title": "Produzione", "duration": 14, "offset": 8},
                    {"title": "Ispezione pre-spedizione", "duration": 2, "offset": 22},
                    {"title": "Spedizione marittima", "duration": 30, "offset": 24},
                    {"title": "Sdoganamento", "duration": 3, "offset": 54},
                    {"title": "Consegna magazzino", "duration": 2, "offset": 57},
                ],
            }
        ],
    },
    {
        "id": "3d-printed",
        "name": "3D Printed",
        "category": "Supply Chain",
        "description": "Produzione componenti 3D",
        "sections": [
            {
                "title": "3D Print - Produzione",
                "tasks": [
                    {"title": "Design CAD componente", "duration": 3, "offset": 0},
                    {"title": "Slicing e preparazione", "duration": 1, "offset": 3},
                    {"title": "Stampa 3D", "duration": 2, "offset": 4},
                    {"title": "Post-processing", "duration": 1, "offset": 6},
                    {"title": "Test e validazione", "duration": 2, "offset": 7},
                ],
            }
        ],
    },
    # --- Marketing ---
    {
        "id": "ad-campaign",
        "name": "Ad Campaign",
        "category": "Marketing",
        "description": "Lancio campagna pubblicitaria",
        "sections": [
            {
                "title": "Ad Campaign - Lancio",
                "tasks": [
                    {"title": "Brief e strategia", "duration": 3, "offset": 0},
                    {"title": "Creazione contenuti", "duration": 5, "offset": 3},
                    {"title": "Setup piattaforme ads", "duration": 2, "offset": 8},
                    {"title": "Lancio campagna", "duration": 1, "offset": 10},
                    {"title": "Monitoraggio e ottimizzazione", "duration": 14, "offset": 11},
                    {"title": "Report risultati", "duration": 2, "offset": 25},
                ],
            }
        ],
    },
    {
        "id": "new-website",
        "name": "New Website",
        "category": "Marketing",
        "description": "Sviluppo nuovo sito web",
        "sections": [
            {
                "title": "New Website - Sviluppo",
                "tasks": [
                    {"title": "Wireframe e UX design", "duration": 5, "offset": 0},
                    {"title": "UI design", "duration": 5, "offset": 5},
                    {"title": "Sviluppo frontend", "duration": 10, "offset": 10},
                    {"title": "Sviluppo backend", "duration": 10, "offset": 10},
                    {"title": "Testing e QA", "duration": 5, "offset": 20},
                    {"title": "Deploy e go-live", "duration": 2, "offset": 25},
                ],
            }
        ],
    },
    # --- R&D ---
    {
        "id": "new-product",
        "name": "New Product",
        "category": "R&D",
        "description": "Sviluppo nuovo prodotto",
        "sections": [
            {
                "title": "New Product - R&D",
                "tasks": [
                    {"title": "Ricerca di mercato", "duration": 5, "offset": 0},
                    {"title": "Concept e specifiche", "duration": 5, "offset": 5},
                    {"title": "Prototipazione", "duration": 10, "offset": 10},
                    {"title": "Test funzionali", "duration": 5, "offset": 20},
                    {"title": "Iterazione design", "duration": 7, "offset": 25},
                    {"title": "Validazione finale", "duration": 3, "offset": 32},
                ],
            }
        ],
    },
]


def _generate_id() -> str:
    return uuid.uuid4().hex[0:8]  # type: ignore[no-matching-overload]


# --- Custom templates persistence ---

def _load_custom() -> List[Dict]:
    if not os.path.exists(CUSTOM_FILE):
        return []
    with open(CUSTOM_FILE, "r") as f:
        return json.load(f)


def _save_custom(templates: List[Dict]) -> None:
    with open(CUSTOM_FILE, "w") as f:
        json.dump(templates, f, indent=2)


def _load_hidden() -> List[str]:
    if not os.path.exists(HIDDEN_FILE):
        return []
    with open(HIDDEN_FILE, "r") as f:
        return json.load(f)


def _save_hidden(ids: List[str]) -> None:
    with open(HIDDEN_FILE, "w") as f:
        json.dump(ids, f, indent=2)


# --- Merged access ---

def _get_all_templates() -> List[Dict]:
    """Return all templates: hardcoded + custom. Custom overrides hardcoded by ID."""
    custom = _load_custom()
    custom_ids = {t["id"] for t in custom}
    hidden_ids = set(_load_hidden())
    merged = []
    for t in TEMPLATES:
        if t["id"] not in custom_ids and t["id"] not in hidden_ids:
            merged.append(t)
    merged.extend(custom)
    return merged


def get_templates() -> List[Dict]:
    """Return templates grouped by category (for listing)."""
    all_tpls = _get_all_templates()
    categories = {}
    for t in all_tpls:
        cat = t["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append({
            "id": t["id"],
            "name": t["name"],
            "description": t["description"],
            "custom": t.get("custom", False),
        })
    return [{"name": name, "templates": tpls} for name, tpls in categories.items()]


def get_template_by_id(template_id: str) -> Optional[Dict]:
    """Return a single template by ID (full detail with sections)."""
    # Check custom first (overrides)
    for t in _load_custom():
        if t["id"] == template_id:
            return t
    # Then hardcoded
    for t in TEMPLATES:
        if t["id"] == template_id:
            return t
    return None


# --- CRUD for custom templates ---

def create_template(name: str, category: str, description: str,
                     sections: Optional[List[Dict]] = None,
                     phases: Optional[List[Dict]] = None,
                     fmt: Optional[str] = None) -> Dict:
    custom = _load_custom()
    template: Dict[str, Any] = {
        "id": _generate_id(),
        "name": name,
        "category": category,
        "description": description,
        "custom": True,
    }
    if fmt == "v2" and phases is not None:
        template["format"] = "v2"
        template["phases"] = phases
    else:
        template["sections"] = sections or []
    custom.append(template)
    _save_custom(custom)
    return template


def update_template(template_id: str, updates: Dict) -> Optional[Dict]:
    custom = _load_custom()

    # Check if it's already in custom store
    for t in custom:
        if t["id"] == template_id:
            t.update(updates)
            t["custom"] = True
            _save_custom(custom)
            return t

    # If it's a hardcoded template, copy it to custom store then update
    for t in TEMPLATES:
        if t["id"] == template_id:
            copy: Dict[str, Any] = dict(t)
            copy["custom"] = True
            copy.update(updates)
            custom.append(copy)
            _save_custom(custom)
            return copy

    return None


def delete_template(template_id: str) -> bool:
    # Try removing from custom templates
    custom = _load_custom()
    original_len = len(custom)
    custom = [t for t in custom if t["id"] != template_id]
    if len(custom) < original_len:
        _save_custom(custom)
        return True
    # If it's a hardcoded template, hide it
    for t in TEMPLATES:
        if t["id"] == template_id:
            hidden = _load_hidden()
            if template_id not in hidden:
                hidden.append(template_id)
                _save_hidden(hidden)
            return True
    return False
