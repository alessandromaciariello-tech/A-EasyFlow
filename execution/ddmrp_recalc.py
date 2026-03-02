"""
DDMRP Recalc — Client CLI per il sistema DDMRP Control Tower.
Chiama le API routes Next.js via HTTP (il DDMRP engine è in TypeScript/Prisma).
Richiede: Next.js dev server attivo su http://localhost:3000
"""
from __future__ import annotations

import argparse
import json
import urllib.request
import urllib.error

from common import write_json, ensure_tmp_dir


DDMRP_BASE = "http://localhost:3000/api/ddmrp"


def _api_call(method: str, path: str, data: dict | None = None) -> dict:
    """Chiama un endpoint DDMRP e ritorna la risposta JSON."""
    url = f"{DDMRP_BASE}/{path}"
    headers = {"Content-Type": "application/json"}

    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
    else:
        req = urllib.request.Request(url, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"Errore HTTP {e.code}: {body}")
        raise
    except urllib.error.URLError as e:
        print(f"Errore connessione: {e.reason}")
        print("Assicurati che il server Next.js sia attivo: cd frontend && npm run dev")
        raise


def trigger_recalc() -> dict:
    """Triggera il ricalcolo di tutti i profili DDMRP."""
    print("Ricalcolo profili DDMRP in corso...")
    result = _api_call("POST", "recalc")
    print(f"Ricalcolati: {result.get('recalculated', 0)} prodotti")
    return result


def trigger_shopify_sync() -> dict:
    """Triggera la sincronizzazione completa da Shopify (4 fasi)."""
    print("Sync Shopify → DDMRP in corso (4 fasi)...")
    result = _api_call("POST", "sync-shopify")

    products = result.get("products", {})
    sales = result.get("sales", {})
    inventory = result.get("inventory", {})

    print(f"  Prodotti: {products.get('imported', 0)} importati, {products.get('updated', 0)} aggiornati")
    print(f"  Vendite: {sales.get('imported', 0)} record ({sales.get('days', 0)} giorni)")
    print(f"  Inventario: {inventory.get('imported', 0)} snapshot")
    print(f"  Profili ricalcolati: {result.get('recalculated', 0)}")

    return result


def export_summary(output_path: str | None = None) -> list:
    """Esporta il summary DDMRP Control Tower in JSON."""
    summary = _api_call("GET", "summary")
    if output_path is None:
        output_path = str(ensure_tmp_dir() / "ddmrp_summary.json")
    write_json(summary, output_path)
    return summary


def alert_red_items() -> None:
    """Stampa i prodotti in status 'red' (buffer critico)."""
    summary = _api_call("GET", "summary")

    if not isinstance(summary, list):
        print("Formato summary inatteso")
        return

    red_items = [p for p in summary if p.get("status") == "red"]

    if not red_items:
        print("Nessun prodotto in status RED — tutto nella norma")
        return

    print(f"\n--- ALERT: {len(red_items)} prodotti in RED ---\n")
    print(f"{'SKU':<15} {'Prodotto':<25} {'NFP':>8} {'Red Zone':>10} {'Riordino':>10} {'Stockout':>12}")
    print("-" * 85)

    for p in red_items:
        sku = p.get("sku", "?")
        name = p.get("name", "?")[:24]
        nfp = p.get("netFlowPosition", 0)
        red_zone = p.get("zones", {}).get("red", 0) if isinstance(p.get("zones"), dict) else 0
        reorder = p.get("recommendedOrderQty", 0) or 0
        stockout = p.get("riskStockoutDate", "-") or "-"

        print(f"{sku:<15} {name:<25} {nfp:>8.0f} {red_zone:>10.0f} {reorder:>10.0f} {stockout:>12}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DDMRP Control Tower CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("recalc", help="Ricalcola tutti i profili DDMRP")
    sub.add_parser("sync-shopify", help="Sync completo Shopify → DDMRP (4 fasi)")

    ep = sub.add_parser("export-summary", help="Esporta summary Control Tower")
    ep.add_argument("--output", help="Path file di output")

    sub.add_parser("alert-red", help="Mostra prodotti in status RED")

    args = parser.parse_args()

    if args.command == "recalc":
        trigger_recalc()
    elif args.command == "sync-shopify":
        trigger_shopify_sync()
    elif args.command == "export-summary":
        export_summary(args.output)
    elif args.command == "alert-red":
        alert_red_items()
