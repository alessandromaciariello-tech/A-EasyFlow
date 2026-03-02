"""
Shopify Sync — Estrazione dati e sincronizzazione Shopify da CLI.
Reusa: backend/shopify_client.py, backend/inventory_store.py
"""
from __future__ import annotations

import argparse

from common import setup_backend_path, load_env, write_json, write_csv, ensure_tmp_dir

load_env()
setup_backend_path()

import shopify_client  # noqa: E402
import inventory_store  # noqa: E402


def export_dashboard(days: int = 30, output_path: str | None = None) -> dict | None:
    """Esporta il summary della dashboard Shopify in JSON."""
    if not shopify_client.is_configured():
        print("Errore: Shopify non configurato. Imposta SHOPIFY_SHOP_URL e SHOPIFY_ACCESS_TOKEN in .env")
        return None

    summary = shopify_client.get_dashboard_summary(days)
    if output_path is None:
        output_path = str(ensure_tmp_dir() / "shopify_dashboard.json")
    write_json(summary, output_path)
    return summary


def export_orders(days: int = 30, output_path: str | None = None) -> None:
    """Esporta gli ordini Shopify in JSON."""
    if not shopify_client.is_configured():
        print("Errore: Shopify non configurato")
        return

    from datetime import datetime, timedelta
    since = (datetime.now() - timedelta(days=days)).isoformat()
    orders = shopify_client.get_orders(created_at_min=since)

    if output_path is None:
        output_path = str(ensure_tmp_dir() / "shopify_orders.json")
    write_json(orders, output_path)
    print(f"  {len(orders)} ordini esportati")


def check_low_stock(threshold: int = 5) -> None:
    """Stampa i prodotti Shopify con stock sotto la soglia."""
    if not shopify_client.is_configured():
        print("Errore: Shopify non configurato")
        return

    stock = shopify_client.get_all_product_stock()

    low = [(name, qty) for name, qty in stock.items() if qty <= threshold]
    low.sort(key=lambda x: x[1])

    if not low:
        print(f"Nessun prodotto sotto la soglia di {threshold} unità")
        return

    print(f"\n--- Prodotti con stock <= {threshold} ---\n")
    print(f"{'Prodotto':<40} {'Stock':>8}")
    print("-" * 50)

    for name, qty in low:
        print(f"{name:<40} {qty:>8}")


def sync_to_inventory() -> None:
    """Sincronizza i prodotti Shopify nell'inventario BOM (auto-import)."""
    if not shopify_client.is_configured():
        print("Errore: Shopify non configurato")
        return

    products = shopify_client.get_products()
    inv_data = inventory_store.load_data()

    # Normalizzazione nomi per matching
    existing_names = {
        p["name"].strip().lower(): p["id"]
        for p in inv_data["products"]
    }

    imported = 0
    for sp in products:
        name = sp.get("title", "").strip()
        if not name:
            continue
        normalized = name.lower()
        if normalized not in existing_names:
            inventory_store.add_product(name)
            imported += 1
            print(f"  Importato: {name}")

    print(f"\nSync completato: {imported} nuovi prodotti importati nel BOM")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Shopify Sync CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    dp = sub.add_parser("dashboard", help="Esporta dashboard summary")
    dp.add_argument("--days", type=int, default=30, help="Periodo in giorni (default: 30)")
    dp.add_argument("--output", help="Path file di output")

    op = sub.add_parser("orders", help="Esporta ordini")
    op.add_argument("--days", type=int, default=30, help="Periodo in giorni")
    op.add_argument("--output", help="Path file di output")

    lp = sub.add_parser("low-stock", help="Alert prodotti con stock basso")
    lp.add_argument("--threshold", type=int, default=5, help="Soglia stock (default: 5)")

    sub.add_parser("sync-inventory", help="Sync prodotti Shopify → BOM inventario")

    args = parser.parse_args()

    if args.command == "dashboard":
        export_dashboard(args.days, args.output)
    elif args.command == "orders":
        export_orders(args.days, args.output)
    elif args.command == "low-stock":
        check_low_stock(args.threshold)
    elif args.command == "sync-inventory":
        sync_to_inventory()
