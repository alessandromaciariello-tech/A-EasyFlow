"""
Vercel-compatible file path resolver.

On Vercel, the deployment bundle is read-only. This helper copies data files
to /tmp on first access so they can be read and written normally.
Data persists while the serverless function stays warm.
"""
import os
import shutil

_VERCEL = bool(os.getenv("VERCEL"))
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_TMP_DIR = "/tmp/easyflow"


def get_data_path(filename: str) -> str:
    """Return writable path to a JSON data file."""
    if not _VERCEL:
        return os.path.join(_BASE_DIR, filename)

    os.makedirs(_TMP_DIR, exist_ok=True)
    tmp_path = os.path.join(_TMP_DIR, filename)

    if not os.path.exists(tmp_path):
        src = os.path.join(_BASE_DIR, filename)
        if os.path.exists(src):
            shutil.copy2(src, tmp_path)

    return tmp_path
