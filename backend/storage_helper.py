"""
Persistent storage layer for EasyFlow.

If DATABASE_URL is set → uses Supabase PostgreSQL (JSONB document store).
Otherwise → falls back to local JSON files (dev mode).
"""
import os
import json

DATABASE_URL = os.getenv("DATABASE_URL")

# --- PostgreSQL backend ---

_conn = None


def _get_conn():
    global _conn
    if _conn is None or _conn.closed:
        import psycopg2
        _conn = psycopg2.connect(DATABASE_URL)
        _conn.autocommit = False
    return _conn


def _ensure_table():
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS app_data (
                key TEXT PRIMARY KEY,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
    conn.commit()


# Auto-init on first import
try:
    if DATABASE_URL:
        _ensure_table()
except Exception:
    pass


def load_json(key, default=None):
    """Read a JSONB document from the DB. Returns default if not found."""
    if not DATABASE_URL:
        return _load_file(key, default)
    try:
        conn = _get_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM app_data WHERE key = %s", (key,))
            row = cur.fetchone()
            return row[0] if row else default
    except Exception:
        global _conn
        _conn = None
        return _load_file(key, default)


def save_json(key, data):
    """Upsert a JSONB document into the DB."""
    if not DATABASE_URL:
        return _save_file(key, data)
    try:
        from psycopg2.extras import Json
        conn = _get_conn()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO app_data (key, data, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
            """, (key, Json(data)))
        conn.commit()
    except Exception:
        global _conn
        _conn = None
        _save_file(key, data)


# --- File fallback (local dev without DB) ---

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_FILE_MAP = {
    "gantt": "gantt_data.json",
    "inventory": "inventory_data.json",
    "settings": "settings.json",
    "templates": "gantt_custom_templates.json",
    "hidden": "gantt_hidden_templates.json",
}


def _load_file(key, default=None):
    filename = _FILE_MAP.get(key)
    if not filename:
        return default
    path = os.path.join(_BASE_DIR, filename)
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def _save_file(key, data):
    filename = _FILE_MAP.get(key)
    if not filename:
        return
    path = os.path.join(_BASE_DIR, filename)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
