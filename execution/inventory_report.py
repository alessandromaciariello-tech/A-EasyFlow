"""
Inventory Report — Report produzione, restock e fornitori da CLI.
Reusa: backend/inventory_store.py
"""
from __future__ import annotations

import argparse

from common import setup_backend_path, write_json, ensure_tmp_dir

setup_backend_path()

import inventory_store  # noqa: E402


def production_report(product_name: str, quantity: int) -> dict | None:
    """Calcola e stampa le necessità di produzione per un prodotto."""
    data = inventory_store.load_data()
    product = None
    for p in data["products"]:
        if p["name"].lower() == product_name.lower():
            product = p
            break

    if not product:
        print(f"Prodotto non trovato: {product_name}")
        print("Prodotti disponibili:")
        for p in data["products"]:
            print(f"  - {p['name']}")
        return None

    result = inventory_store.calculate_production_needs(product["id"], quantity)

    print(f"\n--- Production Report: {product['name']} x{quantity} ---")
    print(f"Producibile: {'Si' if result['producible'] else 'No'}")
    print(f"Costo componenti mancanti: EUR {result['total_missing_cost']:.2f}")
    print(f"Lead time max: {result['max_lead_time_days']} giorni\n")

    if result["lines"]:
        print(f"{'Componente':<25} {'Necessari':>10} {'In Stock':>10} {'Mancanti':>10} {'Costo':>10} {'Fornitore':<20}")
        print("-" * 95)
        for line in result["lines"]:
            print(
                f"{line['name']:<25} {line['needed']:>10.1f} {line['in_stock']:>10.1f} "
                f"{line['missing']:>10.1f} {line['missing_cost']:>10.2f} {line['supplier']:<20}"
            )

    return result


def max_producible_report() -> None:
    """Per ogni prodotto, mostra le unità max producibili e il bottleneck."""
    data = inventory_store.load_data()
    products = data.get("products", [])

    if not products:
        print("Nessun prodotto in inventario")
        return

    print(f"\n--- Max Producible Report ---\n")
    print(f"{'Prodotto':<30} {'Max Unità':>10} {'Bottleneck':<30}")
    print("-" * 75)

    for product in products:
        result = inventory_store.calculate_max_producible(product["id"])
        bottleneck = result.get("bottleneck") or "-"
        print(f"{product['name']:<30} {result['max_producible']:>10} {bottleneck:<30}")


def restock_needed_report() -> None:
    """Mostra i componenti che necessitano di restock (catch-up mode)."""
    data = inventory_store.load_data()
    products = data.get("products", [])

    if not products:
        print("Nessun prodotto in inventario")
        return

    print(f"\n--- Restock Needed Report ---\n")

    for product in products:
        # Calcola per 1 unità per vedere chi è sotto
        result = inventory_store.calculate_production_needs(product["id"], 1)
        missing_lines = [l for l in result["lines"] if l["missing"] > 0]

        if missing_lines:
            print(f"\n{product['name']}:")
            for line in missing_lines:
                print(
                    f"  - {line['name']}: mancano {line['missing']:.0f} pz "
                    f"(in stock: {line['in_stock']:.0f}, costo: EUR {line['missing_cost']:.2f}, "
                    f"fornitore: {line['supplier'] or 'N/A'}, lead time: {line['lead_time_days']}gg)"
                )
        else:
            print(f"\n{product['name']}: tutto disponibile")


def supplier_summary() -> None:
    """Riepilogo di tutti i fornitori con i loro contatti."""
    suppliers = inventory_store.get_suppliers()

    if not suppliers:
        print("Nessun fornitore registrato")
        return

    print(f"\n--- Fornitori ({len(suppliers)}) ---\n")
    print(f"{'Nome':<25} {'Telefono':<20} {'Email':<30}")
    print("-" * 75)

    for s in suppliers:
        print(f"{s['name']:<25} {s.get('phone', ''):<20} {s.get('email', ''):<30}")


def export_bom_tree(product_name: str, output_path: str | None = None) -> None:
    """Esporta l'albero BOM completo di un prodotto in JSON."""
    data = inventory_store.load_data()
    product = None
    for p in data["products"]:
        if p["name"].lower() == product_name.lower():
            product = p
            break

    if not product:
        print(f"Prodotto non trovato: {product_name}")
        return

    if output_path is None:
        safe_name = product["name"].replace(" ", "_").lower()
        output_path = str(ensure_tmp_dir() / f"bom_{safe_name}.json")

    write_json(product, output_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Inventory Report CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    pp = sub.add_parser("production", help="Report necessità produzione")
    pp.add_argument("product", help="Nome del prodotto")
    pp.add_argument("quantity", type=int, help="Quantità da produrre")

    sub.add_parser("max-producible", help="Max unità producibili per ogni prodotto")
    sub.add_parser("restock", help="Componenti che necessitano restock")
    sub.add_parser("suppliers", help="Riepilogo fornitori")

    bp = sub.add_parser("export-bom", help="Esporta albero BOM in JSON")
    bp.add_argument("product", help="Nome del prodotto")
    bp.add_argument("--output", help="Path file di output")

    args = parser.parse_args()

    if args.command == "production":
        production_report(args.product, args.quantity)
    elif args.command == "max-producible":
        max_producible_report()
    elif args.command == "restock":
        restock_needed_report()
    elif args.command == "suppliers":
        supplier_summary()
    elif args.command == "export-bom":
        export_bom_tree(args.product, args.output)
