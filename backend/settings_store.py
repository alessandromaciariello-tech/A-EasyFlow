"""
Settings Store - JSON file persistence for user preferences.
Includes: restock parameters, working hours, onboarding state.
"""
import os
import json
from typing import Dict
from storage_helper import get_data_path

SETTINGS_FILE = get_data_path("settings.json")


def _default_settings() -> Dict:
    return {
        "safety_stock_days": 7,
        "demand_window_days": 14,
        "spike_threshold_k": 1.5,
        "deep_work_start": "09:00",
        "deep_work_end": "13:30",
        "noise_start": "14:30",
        "noise_end": "20:00",
        "onboarding_completed": False,
    }


def load_settings() -> Dict:
    if not os.path.exists(SETTINGS_FILE):
        settings = _default_settings()
        save_settings(settings)
        return settings
    with open(SETTINGS_FILE, "r") as f:
        settings = json.load(f)
    # Migration: ensure all keys exist
    defaults = _default_settings()
    migrated = False
    for key, value in defaults.items():
        if key not in settings:
            settings[key] = value
            migrated = True
    if migrated:
        save_settings(settings)
    return settings


def save_settings(settings: Dict) -> None:
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)


def update_settings(updates: Dict) -> Dict:
    settings = load_settings()
    allowed_keys = set(_default_settings().keys())
    for key, value in updates.items():
        if key in allowed_keys:
            settings[key] = value
    save_settings(settings)
    return settings
