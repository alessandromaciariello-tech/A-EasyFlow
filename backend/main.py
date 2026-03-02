"""
EasyFlow Backend - Entry point FastAPI
Project Manager basato su chat con integrazione Google Calendar.
"""
import os
from datetime import datetime, time, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Carica variabili d'ambiente dal file .env nella root del progetto
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

import scheduler
from scheduler import find_next_available_slot
from chat_parser import parse_tasks_from_message
import google_calendar as gcal
import gantt_store
import gantt_templates
import shopify_client as shopify
import shopify_analyzer
import inventory_store as inventory
import restock_engine
import settings_store

app = FastAPI(title="EasyFlow API", version="0.1.0")

# CORS per permettere al frontend Next.js di comunicare con il backend
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Modelli Pydantic ---

class ChatMessage(BaseModel):
    message: str


class TaskSchedule(BaseModel):
    title: str
    urgency: str  # "asap" | "normal"
    type: str     # "deep_work" | "noise"
    duration: int  # minuti
    preferred_date: Optional[str] = None  # "YYYY-MM-DD"
    preferred_time: Optional[str] = None  # "HH:MM"


class GanttSectionCreate(BaseModel):
    title: str


class GanttSectionUpdate(BaseModel):
    title: Optional[str] = None
    collapsed: Optional[bool] = None


class GanttTaskCreate(BaseModel):
    title: str
    duration: float
    start_date: str
    color: Optional[str] = "#3B82F6"
    daily_hours: Optional[float] = None


class GanttTaskUpdate(BaseModel):
    title: Optional[str] = None
    duration: Optional[float] = None
    progress: Optional[int] = None
    color: Optional[str] = None
    startDate: Optional[str] = None
    collapsed: Optional[bool] = None
    dependencies: Optional[List[str]] = None
    daily_hours: Optional[float] = None


class GanttTemplateTaskDef(BaseModel):
    title: str
    duration: float = 1
    offset: int = 0


class GanttTemplateSectionDef(BaseModel):
    title: str
    tasks: List[GanttTemplateTaskDef] = []


# V2: phase-based workflow templates
class GanttTemplatePhaseTaskDef(BaseModel):
    title: str
    duration: float = 1


class GanttTemplatePhaseDef(BaseModel):
    title: str
    color: Optional[str] = None
    tasks: List[GanttTemplatePhaseTaskDef] = []


class GanttTemplateCreate(BaseModel):
    name: str
    category: str
    description: str = ""
    sections: Optional[List[GanttTemplateSectionDef]] = None
    phases: Optional[List[GanttTemplatePhaseDef]] = None


class GanttTemplateUpdateModel(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    sections: Optional[List[GanttTemplateSectionDef]] = None
    phases: Optional[List[GanttTemplatePhaseDef]] = None


# --- Health Check ---

@app.get("/")
def root():
    return {"status": "ok", "message": "EasyFlow API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# --- Auth Google OAuth2 ---

@app.get("/api/auth/google")
def auth_google():
    """Avvia il flusso OAuth2 con Google. Ritorna l'URL di autorizzazione."""
    try:
        auth_url = gcal.get_auth_url()
        return {"auth_url": auth_url}
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="File credentials.json non trovato. Scaricalo dalla Google Cloud Console.",
        )


@app.get("/api/auth/callback")
def auth_callback(code: str = Query(...)):
    """Gestisce il callback OAuth2 di Google."""
    try:
        result = gcal.handle_callback(code)
        # Redirect al frontend dopo l'autenticazione
        return RedirectResponse(url="http://localhost:3000?auth=success")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/auth/status")
def auth_status():
    """Verifica se l'utente è autenticato con Google."""
    creds = gcal.get_credentials()
    return {"authenticated": creds is not None}


# --- Calendar ---

@app.get("/api/calendar/events")
def get_calendar_events(
    date: Optional[str] = Query(None, description="Data in formato YYYY-MM-DD"),
    days: int = Query(1, description="Numero di giorni"),
):
    """Recupera gli eventi dal Google Calendar."""
    try:
        events = gcal.get_events(date_str=date, days=days)
        return {"events": events}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Chat / AI Parsing ---

@app.post("/api/chat/parse")
def parse_chat_message(body: ChatMessage):
    """
    Analizza un messaggio in linguaggio naturale e ne estrae una o più task strutturate.
    Non schedula ancora - permette all'utente di correggere i tag prima.
    """
    try:
        # Fetch today's events so the AI knows about existing schedule
        today_events = []
        try:
            raw_events = gcal.get_events(days=1)
            for ev in raw_events:
                start = ev.get("start", {})
                end = ev.get("end", {})
                start_dt = start.get("dateTime") or start.get("date", "")
                end_dt = end.get("dateTime") or end.get("date", "")
                today_events.append({
                    "title": ev.get("summary", ""),
                    "start": start_dt,
                    "end": end_dt,
                })
        except Exception:
            pass  # If calendar unavailable, proceed without events

        tasks = parse_tasks_from_message(body.message, existing_events=today_events)

        # Costruisci messaggio di conferma per tutte le task
        summaries = []
        for t in tasks:
            urgency_label = "ASAP" if t["urgency"] == "asap" else "To-Do"
            type_label = "Deep Work" if t["type"] == "deep_work" else "Noise"
            summaries.append(f"'{t['title']}' ({urgency_label}, {type_label}, {t['duration']} min)")

        if len(tasks) == 1:
            confirmation = f"Ho capito: Task {summaries[0]}"
        else:
            task_list = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(summaries))
            confirmation = f"Ho capito {len(tasks)} task:\n{task_list}"

        return {
            "parsed_tasks": tasks,
            "confirmation_message": confirmation,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Task Scheduling ---

@app.post("/api/tasks/schedule")
def schedule_task(task: TaskSchedule):
    """
    Trova il prossimo slot disponibile e crea l'evento su Google Calendar.
    Flusso completo: verifica disponibilità → inserimento evento → risposta.
    """
    try:
        # 1. Recupera eventi esistenti per trovare slot liberi
        events = gcal.get_events(days=14)

        # 2. Calcola reference_time da preferred_date/time
        reference_time = None
        pref_date = task.preferred_date
        pref_time = task.preferred_time
        if pref_date is not None:
            try:
                ref_date = datetime.strptime(pref_date, "%Y-%m-%d")
                if pref_time is not None:
                    parts = pref_time.split(":")
                    ref_date = ref_date.replace(hour=int(parts[0]), minute=int(parts[1]))
                else:
                    ref_date = ref_date.replace(hour=0, minute=0)
                reference_time = ref_date
            except (ValueError, IndexError):
                pass

        # 3. Trova lo slot disponibile
        # Se l'utente ha specificato un orario esatto, usa modalità "pinned"
        has_pinned_time = pref_time is not None
        slot = find_next_available_slot(
            task_type=task.type,
            urgency=task.urgency,
            duration=task.duration,
            existing_events=events,
            reference_time=reference_time,
            pinned=has_pinned_time,
        )

        # 3. Crea l'evento su Google Calendar
        description = f"[EasyFlow:source=microtask,status=todo] Urgenza: {task.urgency.upper()} | Tipo: {'Deep Work' if task.type == 'deep_work' else 'Noise'}"
        event = gcal.create_event(
            title=task.title,
            start=slot["start"],
            end=slot["end"],
            description=description,
        )

        return {
            "scheduled": True,
            "event": {
                "id": event.get("id"),
                "title": task.title,
                "start": slot["start"],
                "end": slot["end"],
                "urgency": task.urgency,
                "type": task.type,
                "calendar_link": event.get("htmlLink"),
            },
        }
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CalendarEventUpdate(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None


@app.patch("/api/calendar/events/{event_id}")
def update_calendar_event(event_id: str, body: CalendarEventUpdate):
    """Aggiorna gli orari di un evento su Google Calendar."""
    try:
        updated = gcal.update_event_times(event_id, end_datetime=body.end, start_datetime=body.start)
        return {"updated": True, "event": updated}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/calendar/events/{event_id}")
def delete_calendar_event(event_id: str):
    """Elimina un evento dal Google Calendar (task completata)."""
    try:
        gcal.delete_event(event_id)
        return {"deleted": True}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Gantt Chart ---

@app.get("/api/gantt/project")
def get_gantt_project():
    return gantt_store.load_project()


@app.post("/api/gantt/sections")
def create_gantt_section(body: GanttSectionCreate):
    return gantt_store.add_section(body.title)


@app.patch("/api/gantt/sections/{section_id}")
def update_gantt_section(section_id: str, body: GanttSectionUpdate):
    updates = body.dict(exclude_none=True)
    section = gantt_store.update_section(section_id, updates)
    if not section:
        raise HTTPException(status_code=404, detail="Sezione non trovata")
    return section


@app.delete("/api/gantt/sections/{section_id}")
def delete_gantt_section(section_id: str):
    if not gantt_store.delete_section(section_id):
        raise HTTPException(status_code=404, detail="Sezione non trovata")
    return {"deleted": True}


@app.post("/api/gantt/sections/{section_id}/tasks")
def create_gantt_task(section_id: str, body: GanttTaskCreate):
    task = gantt_store.add_task(
        section_id, body.title, body.duration, body.start_date, body.color or "#3B82F6",
        daily_hours=body.daily_hours or 0,
    )
    if not task:
        raise HTTPException(status_code=404, detail="Sezione non trovata")
    return task


@app.patch("/api/gantt/sections/{section_id}/tasks/{task_id}")
def update_gantt_task(section_id: str, task_id: str, body: GanttTaskUpdate):
    updates = body.dict(exclude_none=True)
    task = gantt_store.update_task(section_id, task_id, updates)
    if not task:
        raise HTTPException(status_code=404, detail="Task non trovata")
    return task


@app.delete("/api/gantt/sections/{section_id}/tasks/{task_id}")
def delete_gantt_task(section_id: str, task_id: str):
    if not gantt_store.delete_task(section_id, task_id):
        raise HTTPException(status_code=404, detail="Task non trovata")
    return {"deleted": True}


@app.post("/api/gantt/sections/{section_id}/tasks/{task_id}/duplicate")
def duplicate_gantt_task(section_id: str, task_id: str):
    task = gantt_store.duplicate_task(section_id, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task non trovata")
    return task


@app.post("/api/gantt/sections/{section_id}/tasks/{parent_task_id}/subtasks")
def create_gantt_subtask(section_id: str, parent_task_id: str, body: GanttTaskCreate):
    task = gantt_store.add_subtask(
        section_id, parent_task_id, body.title, body.duration, body.start_date, body.color or "#3B82F6",
        daily_hours=body.daily_hours or 0,
    )
    if not task:
        raise HTTPException(status_code=404, detail="Sezione o task genitore non trovata")
    return task


# --- Gantt → Calendar Sync ---

def _collect_tasks_with_hours(sections):
    """Recursively collect all tasks with daily_hours > 0."""
    results = []
    for section in sections:
        for task in section.get("tasks", []):
            _collect_tasks_recursive(task, results)
    return results


def _collect_tasks_recursive(task, results):
    if task.get("daily_hours", 0) > 0:
        results.append(task)
    for child in task.get("children", []):
        _collect_tasks_recursive(child, results)


@app.post("/api/gantt/sync-calendar")
def sync_gantt_to_calendar():
    """Sync Gantt tasks with daily_hours > 0 to Google Calendar."""
    try:
        project = gantt_store.load_project()
        tasks = _collect_tasks_with_hours(project.get("sections", []))

        if not tasks:
            return {"synced": 0, "events": []}

        created_events = []
        for task in tasks:
            daily_hours = task["daily_hours"]
            duration_minutes = int(daily_hours * 60)
            start_date = datetime.strptime(task["startDate"], "%Y-%m-%d")
            task_duration_days = max(1, int(task["duration"]))

            for day_offset in range(task_duration_days):
                target_date = start_date + timedelta(days=day_offset)
                date_str = target_date.strftime("%Y-%m-%d")

                # Get existing events for this day to avoid conflicts
                try:
                    day_events = gcal.get_events(date_str, days=1)
                except Exception:
                    day_events = []

                # Find a free slot using the scheduler
                slot = scheduler.find_next_available_slot(
                    task_type="noise",
                    urgency="normal",
                    duration=duration_minutes,
                    existing_events=day_events,
                    reference_time=datetime.combine(target_date.date(), time(9, 0)),
                )

                # Create calendar event
                event = gcal.create_event(
                    title=task["title"],
                    start=slot["start"],
                    end=slot["end"],
                    description=f"[EasyFlow:source=gantt,task_id={task['id']}]",
                )
                created_events.append(event)

        return {"synced": len(created_events), "events": created_events}

    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Gantt Templates ---

@app.get("/api/gantt/templates")
def list_gantt_templates():
    return {"categories": gantt_templates.get_templates()}


@app.post("/api/gantt/templates/{template_id}/apply")
def apply_gantt_template(template_id: str):
    template = gantt_templates.get_template_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template non trovato")

    from datetime import timedelta

    phase_colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"]

    if template.get("format") == "v2" or "phases" in template:
        # V2: one section, phases become parent tasks, phase tasks become children
        section = gantt_store.add_section(template["name"])
        section_id = section["id"]
        cumulative_offset = 0

        for pi, phase in enumerate(template["phases"]):
            color = phase.get("color") or phase_colors[pi % len(phase_colors)]
            phase_duration = sum(t["duration"] for t in phase["tasks"]) or 1
            phase_start = (datetime.now() + timedelta(days=cumulative_offset)).strftime("%Y-%m-%d")

            parent_task = gantt_store.add_task(section_id, phase["title"], phase_duration, phase_start, color)
            if not parent_task:
                continue

            task_offset = cumulative_offset
            for task_def in phase["tasks"]:
                task_start = (datetime.now() + timedelta(days=task_offset)).strftime("%Y-%m-%d")
                gantt_store.add_subtask(section_id, parent_task["id"], task_def["title"], task_def["duration"], task_start, color)
                task_offset += task_def["duration"]

            cumulative_offset += phase_duration

        return {"applied": True, "sections": [section]}
    else:
        # V1 (legacy): each section becomes a Gantt section with flat tasks
        created_sections = []
        for tpl_section in template["sections"]:
            section = gantt_store.add_section(tpl_section["title"])
            section_id = section["id"]
            for tpl_task in tpl_section["tasks"]:
                start = (datetime.now() + timedelta(days=tpl_task["offset"])).strftime("%Y-%m-%d")
                gantt_store.add_task(section_id, tpl_task["title"], tpl_task["duration"], start)
            created_sections.append(section)
        return {"applied": True, "sections": created_sections}


@app.get("/api/gantt/templates/{template_id}")
def get_gantt_template_detail(template_id: str):
    template = gantt_templates.get_template_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template non trovato")
    return template


@app.post("/api/gantt/templates")
def create_gantt_template(body: GanttTemplateCreate):
    if body.phases is not None:
        phases = [
            {"title": p.title, "color": p.color, "tasks": [{"title": t.title, "duration": t.duration} for t in p.tasks]}
            for p in body.phases
        ]
        return gantt_templates.create_template(
            body.name, body.category, body.description,
            phases=phases, fmt="v2"
        )
    sections = [
        {"title": s.title, "tasks": [{"title": t.title, "duration": t.duration, "offset": t.offset} for t in s.tasks]}
        for s in (body.sections or [])
    ]
    return gantt_templates.create_template(body.name, body.category, body.description, sections=sections)


@app.patch("/api/gantt/templates/{template_id}")
def update_gantt_template(template_id: str, body: GanttTemplateUpdateModel):
    updates = body.dict(exclude_none=True)
    if body.phases is not None:
        updates["phases"] = [
            {"title": p.title, "color": p.color, "tasks": [{"title": t.title, "duration": t.duration} for t in p.tasks]}
            for p in body.phases
        ]
        updates["format"] = "v2"
        updates.pop("sections", None)
    elif body.sections is not None:
        updates["sections"] = [
            {"title": s.title, "tasks": [{"title": t.title, "duration": t.duration, "offset": t.offset} for t in s.tasks]}
            for s in body.sections
        ]
    result = gantt_templates.update_template(template_id, updates)
    if not result:
        raise HTTPException(status_code=404, detail="Template non trovato")
    return result


@app.delete("/api/gantt/templates/{template_id}")
def delete_gantt_template(template_id: str):
    if not gantt_templates.delete_template(template_id):
        raise HTTPException(status_code=404, detail="Template non trovato o non eliminabile")
    return {"deleted": True}


# --- Shopify ---

@app.get("/api/shopify/status")
def shopify_status():
    """Verifica se Shopify è configurato e raggiungibile."""
    configured = shopify.is_configured()
    if configured:
        try:
            info = shopify.get_shop_info()
            return {"configured": True, "shop_name": info.get("name", ""), "shop_url": info.get("domain", "")}
        except Exception:
            return {"configured": True, "shop_name": "", "error": "Impossibile raggiungere l'API Shopify"}
    return {"configured": False}


@app.get("/api/shopify/dashboard")
def shopify_dashboard(days: int = Query(30, description="Numero di giorni da analizzare")):
    """Dati aggregati per la dashboard Shopify."""
    if not shopify.is_configured():
        raise HTTPException(status_code=400, detail="Shopify non configurato")
    try:
        return shopify.get_dashboard_summary(days=days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/shopify/orders")
def shopify_orders(
    days: int = Query(30),
    status: str = Query("any"),
    financial_status: Optional[str] = Query(None),
):
    """Lista ordini recenti."""
    if not shopify.is_configured():
        raise HTTPException(status_code=400, detail="Shopify non configurato")
    try:
        from datetime import timedelta as td
        created_min = (datetime.now() - td(days=days)).isoformat()
        orders = shopify.get_orders(status=status, created_at_min=created_min, financial_status=financial_status)
        return {"orders": orders, "count": len(orders)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/shopify/products")
def shopify_products():
    """Prodotti con info inventario."""
    if not shopify.is_configured():
        raise HTTPException(status_code=400, detail="Shopify non configurato")
    try:
        products = shopify.get_products()
        return {"products": products}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/shopify/trends")
def shopify_trends(
    current_days: int = Query(7),
    comparison_days: int = Query(7),
):
    """Analisi trend vendite per suggerimenti AI."""
    if not shopify.is_configured():
        raise HTTPException(status_code=400, detail="Shopify non configurato")
    try:
        return shopify.get_sales_trend_analysis(current_days, comparison_days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ShopifyGanttSuggestionRequest(BaseModel):
    message: str


# --- Inventory / BOM Models (recursive tree) ---

class BomProductCreate(BaseModel):
    name: str


class BomProductUpdate(BaseModel):
    name: Optional[str] = None
    collapsed: Optional[bool] = None
    desired_stock: Optional[int] = None


class RestockTaskDef(BaseModel):
    id: Optional[str] = None
    name: str
    duration_days: int = 1
    duration_type: str = "fixed"
    per_unit_duration_days: Optional[float] = None
    min_duration_days: Optional[int] = None
    max_duration_days: Optional[int] = None


class RestockPhaseDef(BaseModel):
    id: Optional[str] = None
    name: str
    color: Optional[str] = "#3B82F6"
    tasks: List[RestockTaskDef] = []


class RestockWorkflowDef(BaseModel):
    phases: List[RestockPhaseDef] = []


class BomItemCreate(BaseModel):
    name: str
    quantity: int = 1
    supplier: str = ""
    unit_cost: float = 0
    moq: int = 1
    sku: str = ""
    restock_workflow: Optional[RestockWorkflowDef] = None


class BomItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[int] = None
    supplier: Optional[str] = None
    unit_cost: Optional[float] = None
    quantity_in_stock: Optional[int] = None
    collapsed: Optional[bool] = None
    moq: Optional[int] = None
    sku: Optional[str] = None
    restock_workflow: Optional[RestockWorkflowDef] = None


class ProductionCheckRequest(BaseModel):
    product_id: str
    quantity: int = 1


class SupplierCreate(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    contact_person: str = ""
    channel_type: str = "email"
    notes: str = ""
    default_lead_time: Optional[int] = None
    default_moq: Optional[int] = None


class SupplierUpdate(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    contact_person: Optional[str] = None
    channel_type: Optional[str] = None
    notes: Optional[str] = None
    default_lead_time: Optional[int] = None
    default_moq: Optional[int] = None


class RestockTemplateCreate(BaseModel):
    name: str
    phases: List[RestockPhaseDef] = []


class RestockTemplateUpdate(BaseModel):
    name: Optional[str] = None
    phases: Optional[List[RestockPhaseDef]] = None


@app.post("/api/chat/shopify-suggest")
def shopify_gantt_suggestions(body: ShopifyGanttSuggestionRequest):
    """
    AI analizza trend Shopify e progetto Gantt corrente,
    restituisce suggerimenti per modifiche durate task.
    L'utente applica manualmente.
    """
    if not shopify.is_configured():
        raise HTTPException(status_code=400, detail="Shopify non configurato")
    try:
        trends = shopify.get_sales_trend_analysis()
        gantt_project = gantt_store.load_project()
        return shopify_analyzer.generate_suggestions(
            user_message=body.message,
            trends=trends,
            gantt_project=gantt_project,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Inventory / BOM (recursive tree) ---

@app.get("/api/inventory")
def get_inventory():
    """All products with full recursive BOM tree."""
    return inventory.load_data()


@app.post("/api/inventory/products")
def create_bom_product(body: BomProductCreate):
    return inventory.add_product(name=body.name)


@app.patch("/api/inventory/products/{product_id}")
def patch_bom_product(product_id: str, body: BomProductUpdate):
    updates = body.dict(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    result = inventory.update_product(product_id, updates)
    if not result:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    return result


@app.delete("/api/inventory/products/{product_id}")
def delete_bom_product(product_id: str):
    if not inventory.delete_product(product_id):
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    return {"deleted": True}


@app.post("/api/inventory/products/{product_id}/items/{parent_id}/children")
def add_bom_child(product_id: str, parent_id: str, body: BomItemCreate):
    workflow_dict = None
    if body.restock_workflow:
        workflow_dict = body.restock_workflow.dict()
    result = inventory.add_child(
        product_id=product_id,
        parent_id=parent_id,
        name=body.name,
        quantity=body.quantity,
        supplier=body.supplier,
        unit_cost=body.unit_cost,
        moq=body.moq,
        sku=body.sku,
        restock_workflow=workflow_dict,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Prodotto o parent non trovato")
    return result


@app.patch("/api/inventory/products/{product_id}/items/{item_id}")
def patch_bom_item(product_id: str, item_id: str, body: BomItemUpdate):
    updates = body.dict(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    result = inventory.update_item(product_id, item_id, updates)
    if not result:
        raise HTTPException(status_code=404, detail="Item non trovato")
    return result


@app.delete("/api/inventory/products/{product_id}/items/{item_id}")
def delete_bom_item(product_id: str, item_id: str):
    if not inventory.delete_item(product_id, item_id):
        raise HTTPException(status_code=404, detail="Item non trovato")
    return {"deleted": True}


@app.post("/api/inventory/production-check")
def production_check(body: ProductionCheckRequest):
    return inventory.calculate_production_needs(body.product_id, body.quantity)


@app.get("/api/inventory/products/{product_id}/max-producible")
def get_max_producible(product_id: str):
    return inventory.calculate_max_producible(product_id)


@app.get("/api/inventory/shopify-stock")
def get_shopify_stock_for_bom():
    if not shopify.is_configured():
        return {"configured": False, "products": []}
    try:
        stock = shopify.get_all_product_stock()
        return {"configured": True, "products": stock}
    except Exception as e:
        return {"configured": True, "products": [], "error": str(e)}


# --- Suppliers ---

@app.get("/api/inventory/suppliers")
def list_suppliers():
    return {"suppliers": inventory.get_suppliers()}


@app.post("/api/inventory/suppliers")
def add_supplier(body: SupplierCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome fornitore obbligatorio")
    return {"suppliers": inventory.add_supplier(
        name, body.phone, body.email,
        contact_person=body.contact_person,
        channel_type=body.channel_type,
        notes=body.notes,
        default_lead_time=body.default_lead_time,
        default_moq=body.default_moq,
    )}


@app.patch("/api/inventory/suppliers/{name}")
def update_supplier(name: str, body: SupplierUpdate):
    updates = body.dict(exclude_none=True)
    return {"suppliers": inventory.update_supplier(name, updates)}


@app.delete("/api/inventory/suppliers/{name}")
def remove_supplier(name: str):
    return {"suppliers": inventory.delete_supplier(name)}


# --- Restock Templates ---

@app.get("/api/inventory/restock-templates")
def list_restock_templates():
    return {"templates": inventory.get_restock_templates()}


@app.post("/api/inventory/restock-templates")
def create_restock_template(body: RestockTemplateCreate):
    import uuid as _uuid
    phases = [
        {
            "id": str(_uuid.uuid4())[:8],
            "name": p.name,
            "color": p.color or "#3B82F6",
            "tasks": [
                {
                    "id": str(_uuid.uuid4())[:8],
                    "name": t.name,
                    "duration_days": t.duration_days,
                    "duration_type": t.duration_type or "fixed",
                    "per_unit_duration_days": t.per_unit_duration_days,
                    "min_duration_days": t.min_duration_days,
                    "max_duration_days": t.max_duration_days,
                }
                for t in p.tasks
            ],
        }
        for p in body.phases
    ]
    return inventory.create_restock_template(body.name, phases)


@app.patch("/api/inventory/restock-templates/{template_id}")
def patch_restock_template(template_id: str, body: RestockTemplateUpdate):
    import uuid as _uuid
    updates = {}  # type: Dict[str, object]
    if body.name is not None:
        updates["name"] = body.name
    if body.phases is not None:
        updates["phases"] = [
            {
                "id": p.id or str(_uuid.uuid4())[:8],
                "name": p.name,
                "color": p.color or "#3B82F6",
                "tasks": [
                    {
                        "id": t.id or str(_uuid.uuid4())[:8],
                        "name": t.name,
                        "duration_days": t.duration_days,
                        "duration_type": t.duration_type or "fixed",
                        "per_unit_duration_days": t.per_unit_duration_days,
                        "min_duration_days": t.min_duration_days,
                        "max_duration_days": t.max_duration_days,
                    }
                    for t in p.tasks
                ],
            }
            for p in body.phases
        ]
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    result = inventory.update_restock_template(template_id, updates)
    if not result:
        raise HTTPException(status_code=404, detail="Template non trovato")
    return result


@app.delete("/api/inventory/restock-templates/{template_id}")
def delete_restock_template(template_id: str):
    if not inventory.delete_restock_template(template_id):
        raise HTTPException(status_code=404, detail="Template non trovato")
    return {"deleted": True}


# --- Restock Engine ---

@app.get("/api/restock/recommendations")
def get_restock_recommendations():
    """Genera raccomandazioni di restock per tutti i prodotti BOM."""
    try:
        recommendations = restock_engine.get_recommendations()
        return {"recommendations": recommendations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RestockConfirmRequest(BaseModel):
    product_id: str
    reorder_qty: int
    components: Optional[List[dict]] = None


@app.post("/api/restock/confirm")
def confirm_restock(body: RestockConfirmRequest):
    """Conferma un restock: genera progetto Gantt con task per ogni fase componente."""
    try:
        result = restock_engine.generate_restock_project(
            product_id=body.product_id,
            reorder_qty=body.reorder_qty,
            components=body.components,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Settings ---

class SettingsUpdate(BaseModel):
    safety_stock_days: Optional[int] = None
    demand_window_days: Optional[int] = None
    spike_threshold_k: Optional[float] = None
    deep_work_start: Optional[str] = None
    deep_work_end: Optional[str] = None
    noise_start: Optional[str] = None
    noise_end: Optional[str] = None
    onboarding_completed: Optional[bool] = None


@app.get("/api/restock/settings")
def get_restock_settings():
    """Leggi impostazioni restock e scheduling."""
    return settings_store.load_settings()


@app.post("/api/restock/settings")
def update_restock_settings(body: SettingsUpdate):
    """Aggiorna impostazioni restock e scheduling."""
    updates = body.dict(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    return settings_store.update_settings(updates)


# --- Onboarding ---

@app.get("/api/settings/onboarding-status")
def get_onboarding_status():
    """Verifica stato onboarding: ha prodotti, supplier, settings completato."""
    settings = settings_store.load_settings()
    inv_data = inventory.load_data()
    has_products = len(inv_data.get("products", [])) > 0
    has_suppliers = len(inv_data.get("suppliers", [])) > 0
    return {
        "completed": settings.get("onboarding_completed", False),
        "has_products": has_products,
        "has_suppliers": has_suppliers,
    }
