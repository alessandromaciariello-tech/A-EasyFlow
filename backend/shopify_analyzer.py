"""
Shopify Trend Analyzer — Usa Claude per analizzare dati Shopify
e suggerire modifiche alle durate delle task nel Gantt.
"""
import os
import re
import json
from datetime import datetime
from typing import Any, Dict, List

import anthropic


def _simplify_gantt(project: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Semplifica il progetto Gantt per il contesto AI (riduce token)."""
    simplified = []
    for section in project.get("sections", []):
        section_data = {
            "section_id": section["id"],
            "section_title": section["title"],
            "tasks": [],
        }
        for task in section.get("tasks", []):
            task_data = {
                "task_id": task["id"],
                "title": task["title"],
                "duration_days": task["duration"],
                "start_date": task.get("startDate", ""),
                "progress": task.get("progress", 0),
            }
            if task.get("children"):
                task_data["subtasks"] = [
                    {
                        "task_id": child["id"],
                        "title": child["title"],
                        "duration_days": child["duration"],
                        "start_date": child.get("startDate", ""),
                    }
                    for child in task["children"]
                ]
            section_data["tasks"].append(task_data)
        simplified.append(section_data)
    return simplified


def _extract_json_object(text: str) -> Dict[str, Any]:
    """Estrae un oggetto JSON dalla risposta AI con fallback."""
    # Tentativo diretto
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    # Fallback: cerca un oggetto JSON {...} nel testo
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

    return {"analysis": text, "suggestions": []}


def generate_suggestions(
    user_message: str,
    trends: Dict[str, Any],
    gantt_project: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Analizza i trend Shopify e il progetto Gantt corrente, genera
    suggerimenti per modifiche alle durate delle task supply chain.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    simplified_gantt = _simplify_gantt(gantt_project)

    system_prompt = f"""Sei un consulente AI per supply chain e project management in EasyFlow.
Analizzi i trend di vendita Shopify e suggerisci modifiche alle durate delle task nel Gantt Chart.

DATA CORRENTE: {datetime.now().strftime("%Y-%m-%d %H:%M")}

TREND VENDITE SHOPIFY:
{json.dumps(trends, indent=2, default=str)}

PROGETTO GANTT CORRENTE:
{json.dumps(simplified_gantt, indent=2)}

REGOLE:
1. Suggerisci SOLO modifiche - non applicare nulla automaticamente
2. Basa i suggerimenti su dati concreti (percentuali di variazione, volumi)
3. Focus su task supply chain: spedizioni, produzione, approvvigionamento, controllo qualita
4. Volumi ordini piu alti possono richiedere:
   - Tempi di spedizione piu lunghi
   - Piu tempo di produzione
   - Periodi di controllo qualita estesi
   - Approvvigionamento anticipato
5. Volumi in calo possono permettere di accorciare le durate
6. Se non ci sono suggerimenti giustificati, restituisci array vuoto con spiegazione

FORMATO RISPOSTA — JSON valido:
{{
  "analysis": "Riepilogo in italiano dell'analisi dei trend (2-3 frasi)",
  "suggestions": [
    {{
      "type": "duration_change",
      "section_id": "id della sezione gantt",
      "task_id": "id della task gantt",
      "task_title": "titolo della task",
      "current_duration": 30,
      "suggested_duration": 42,
      "reason": "Motivazione basata sui dati"
    }}
  ]
}}

Rispondi SOLO con il JSON, niente markdown o testo aggiuntivo."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    response_text = message.content[0].text.strip()
    result = _extract_json_object(response_text)

    # Validazione suggerimenti
    validated_suggestions = []
    for s in result.get("suggestions", []):
        if not isinstance(s, dict):
            continue
        validated_suggestions.append({
            "type": s.get("type", "duration_change"),
            "section_id": s.get("section_id", ""),
            "task_id": s.get("task_id", ""),
            "task_title": s.get("task_title", ""),
            "current_duration": float(s.get("current_duration", 0)),
            "suggested_duration": float(s.get("suggested_duration", 0)),
            "reason": s.get("reason", ""),
        })

    return {
        "analysis": result.get("analysis", "Nessuna analisi disponibile"),
        "suggestions": validated_suggestions,
    }
