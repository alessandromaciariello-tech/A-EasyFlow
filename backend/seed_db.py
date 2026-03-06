"""Seed the Supabase database with existing JSON data files."""
import os
import sys

# Ensure .env is loaded
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from storage_helper import save_json, _load_file, DATABASE_URL

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set. Check .env file.")
    sys.exit(1)

print(f"Seeding database: {DATABASE_URL[:40]}...")

for key in ["gantt", "inventory", "settings", "templates", "hidden"]:
    data = _load_file(key)
    if data is not None:
        save_json(key, data)
        print(f"  Seeded: {key}")
    else:
        print(f"  Skipped: {key} (no local file)")

print("Done!")
