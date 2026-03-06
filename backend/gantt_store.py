"""
Gantt Data Store - JSON file persistence for Gantt chart data.
"""
import os
import json
import uuid
from typing import Dict, List, Optional, Tuple
from storage_helper import get_data_path

GANTT_FILE = get_data_path("gantt_data.json")


def _generate_id() -> str:
    return str(uuid.uuid4())[:8]


def _default_project() -> Dict:
    return {
        "id": _generate_id(),
        "name": "My Project",
        "sections": []
    }


# --- Migration & Recursive Helpers ---

def _migrate_task(task: Dict) -> Dict:
    """Ensure task has children, collapsed and dependencies fields (backward compat)."""
    if "children" not in task:
        task["children"] = []
    if "collapsed" not in task:
        task["collapsed"] = False
    if "dependencies" not in task:
        task["dependencies"] = []
    for child in task["children"]:
        _migrate_task(child)
    return task


def _find_task_recursive(tasks: List[Dict], task_id: str) -> Optional[Dict]:
    """Find a task by ID anywhere in the tree."""
    for task in tasks:
        if task["id"] == task_id:
            return task
        found = _find_task_recursive(task.get("children", []), task_id)
        if found is not None:
            return found
    return None


def _find_task_and_parent_list(tasks: List[Dict], task_id: str) -> Optional[Tuple[List[Dict], Dict]]:
    """Returns (parent_list, task) where parent_list is the list containing the task."""
    for task in tasks:
        if task["id"] == task_id:
            return (tasks, task)
        result = _find_task_and_parent_list(task.get("children", []), task_id)
        if result is not None:
            return result
    return None


def _deep_copy_task(task: Dict, is_root: bool = True) -> Dict:
    """Deep-copy a task, generating new IDs for it and all descendants."""
    new_task = dict(task)
    new_task["id"] = _generate_id()
    if is_root:
        new_task["title"] = task["title"] + " (copy)"
    new_task["children"] = [_deep_copy_task(child, is_root=False) for child in task.get("children", [])]
    return new_task


# --- Load / Save ---

def load_project() -> Dict:
    if not os.path.exists(GANTT_FILE):
        project = _default_project()
        save_project(project)
        return project
    with open(GANTT_FILE, "r") as f:
        project = json.load(f)
    # Migrate all tasks to include children/collapsed
    for section in project.get("sections", []):
        for task in section.get("tasks", []):
            _migrate_task(task)
    return project


def save_project(project: Dict) -> None:
    with open(GANTT_FILE, "w") as f:
        json.dump(project, f, indent=2)


# --- Section CRUD ---

def add_section(title: str) -> Dict:
    project = load_project()
    section = {
        "id": _generate_id(),
        "title": title,
        "collapsed": False,
        "tasks": []
    }
    project["sections"].append(section)
    save_project(project)
    return section


def update_section(section_id: str, updates: Dict) -> Optional[Dict]:
    project = load_project()
    for section in project["sections"]:
        if section["id"] == section_id:
            section.update(updates)
            save_project(project)
            return section
    return None


def delete_section(section_id: str) -> bool:
    project = load_project()
    original_len = len(project["sections"])
    project["sections"] = [s for s in project["sections"] if s["id"] != section_id]
    if len(project["sections"]) < original_len:
        save_project(project)
        return True
    return False


# --- Task CRUD ---

def add_task(section_id: str, title: str, duration: int, start_date: str, color: str = "#3B82F6", daily_hours: float = 0) -> Optional[Dict]:
    project = load_project()
    for section in project["sections"]:
        if section["id"] == section_id:
            task = {
                "id": _generate_id(),
                "title": title,
                "duration": duration,
                "progress": 0,
                "color": color,
                "startDate": start_date,
                "children": [],
                "collapsed": False,
                "dependencies": [],
                "daily_hours": daily_hours,
            }
            section["tasks"].append(task)
            save_project(project)
            return task
    return None


def add_subtask(section_id: str, parent_task_id: str, title: str, duration: int, start_date: str, color: str = "#3B82F6", daily_hours: float = 0) -> Optional[Dict]:
    """Add a child task to any task at any depth within a section."""
    project = load_project()
    for section in project["sections"]:
        if section["id"] == section_id:
            parent = _find_task_recursive(section["tasks"], parent_task_id)
            if parent is None:
                return None
            subtask = {
                "id": _generate_id(),
                "title": title,
                "duration": duration,
                "progress": 0,
                "color": color,
                "startDate": start_date,
                "children": [],
                "collapsed": False,
                "dependencies": [],
                "daily_hours": daily_hours,
            }
            parent["children"].append(subtask)
            save_project(project)
            return subtask
    return None


def update_task(section_id: str, task_id: str, updates: Dict) -> Optional[Dict]:
    project = load_project()
    for section in project["sections"]:
        if section["id"] == section_id:
            task = _find_task_recursive(section["tasks"], task_id)
            if task is not None:
                task.update(updates)
                save_project(project)
                return task
    return None


def delete_task(section_id: str, task_id: str) -> bool:
    project = load_project()
    for section in project["sections"]:
        if section["id"] == section_id:
            result = _find_task_and_parent_list(section["tasks"], task_id)
            if result is not None:
                parent_list, task = result
                parent_list.remove(task)
                save_project(project)
                return True
    return False


def duplicate_task(section_id: str, task_id: str) -> Optional[Dict]:
    project = load_project()
    for section in project["sections"]:
        if section["id"] == section_id:
            result = _find_task_and_parent_list(section["tasks"], task_id)
            if result is not None:
                parent_list, task = result
                new_task = _deep_copy_task(task)
                parent_list.append(new_task)
                save_project(project)
                return new_task
    return None
