"""
Integrazione Shopify Admin REST API.
Gestisce connessione, lettura ordini, prodotti, clienti e inventario.
"""
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests

import inventory_store

# Configurazione da .env
SHOP_URL = os.getenv("SHOPIFY_SHOP_URL", "")
ACCESS_TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2024-10")


def _base_url() -> str:
    return f"https://{SHOP_URL}/admin/api/{API_VERSION}"


def _headers() -> Dict[str, str]:
    return {
        "X-Shopify-Access-Token": ACCESS_TOKEN,
        "Content-Type": "application/json",
    }


def _check_rate_limit(response: requests.Response) -> None:
    """Controlla il rate limit e aspetta se necessario."""
    limit_header = response.headers.get("X-Shopify-Shop-Api-Call-Limit", "")
    if limit_header:
        parts = limit_header.split("/")
        if len(parts) == 2:
            used, total = int(parts[0]), int(parts[1])
            if used >= total - 2:
                time.sleep(1.0)


def _parse_link_header(header: str) -> Optional[str]:
    """Estrae l'URL 'next' dal header Link per la paginazione."""
    if not header:
        return None
    for part in header.split(","):
        part = part.strip()
        match = re.match(r'<([^>]+)>;\s*rel="next"', part)
        if match:
            return match.group(1)
    return None


def _paginated_get(url: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Esegue GET paginato, seguendo i Link header fino all'ultima pagina."""
    all_items = []  # type: List[Dict[str, Any]]
    headers = _headers()

    while url:
        resp = requests.get(url, headers=headers, params=params)
        resp.raise_for_status()
        _check_rate_limit(resp)

        data = resp.json()
        # La risposta Shopify ha una chiave root (es. "orders", "products", "customers")
        for key in data:
            if isinstance(data[key], list):
                all_items.extend(data[key])
                break

        # Dopo la prima richiesta, i params sono già nell'URL del link
        params = None
        next_url = _parse_link_header(resp.headers.get("Link", ""))
        url = next_url  # type: ignore[assignment]

    return all_items


# --- Configurazione ---

def is_configured() -> bool:
    """Verifica se le credenziali Shopify sono presenti."""
    return bool(SHOP_URL) and bool(ACCESS_TOKEN) and SHOP_URL != "your-store.myshopify.com"


def get_shop_info() -> Dict[str, Any]:
    """Recupera le informazioni base del negozio."""
    resp = requests.get(f"{_base_url()}/shop.json", headers=_headers())
    resp.raise_for_status()
    return resp.json().get("shop", {})


# --- Ordini ---

def get_orders(
    status: str = "any",
    created_at_min: Optional[str] = None,
    created_at_max: Optional[str] = None,
    limit: int = 250,
    financial_status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Recupera gli ordini con paginazione."""
    params = {
        "status": status,
        "limit": min(limit, 250),
    }  # type: Dict[str, Any]
    if created_at_min:
        params["created_at_min"] = created_at_min
    if created_at_max:
        params["created_at_max"] = created_at_max
    if financial_status:
        params["financial_status"] = financial_status

    return _paginated_get(f"{_base_url()}/orders.json", params)


def get_orders_count(
    status: str = "any",
    created_at_min: Optional[str] = None,
    created_at_max: Optional[str] = None,
    financial_status: Optional[str] = None,
) -> int:
    """Conteggio ordini (leggero, senza paginazione)."""
    params = {"status": status}  # type: Dict[str, Any]
    if created_at_min:
        params["created_at_min"] = created_at_min
    if created_at_max:
        params["created_at_max"] = created_at_max
    if financial_status:
        params["financial_status"] = financial_status

    resp = requests.get(f"{_base_url()}/orders/count.json", headers=_headers(), params=params)
    resp.raise_for_status()
    return resp.json().get("count", 0)


# --- Prodotti ---

def get_products(limit: int = 250) -> List[Dict[str, Any]]:
    """Recupera tutti i prodotti con paginazione."""
    return _paginated_get(f"{_base_url()}/products.json", {"limit": min(limit, 250)})


# --- Inventario ---

def get_locations() -> List[Dict[str, Any]]:
    """Recupera tutte le location di inventario."""
    resp = requests.get(f"{_base_url()}/locations.json", headers=_headers())
    resp.raise_for_status()
    return resp.json().get("locations", [])


def get_inventory_levels(location_id: int, inventory_item_ids: List[int]) -> List[Dict[str, Any]]:
    """Recupera i livelli di inventario per gli item specificati."""
    all_levels = []  # type: List[Dict[str, Any]]
    # Shopify accetta max 50 item_ids per richiesta
    for i in range(0, len(inventory_item_ids), 50):
        batch = inventory_item_ids[i:i + 50]
        ids_str = ",".join(str(x) for x in batch)
        resp = requests.get(
            f"{_base_url()}/inventory_levels.json",
            headers=_headers(),
            params={"location_ids": location_id, "inventory_item_ids": ids_str},
        )
        resp.raise_for_status()
        _check_rate_limit(resp)
        all_levels.extend(resp.json().get("inventory_levels", []))
    return all_levels


def get_all_product_stock() -> List[Dict[str, Any]]:
    """Tutti i prodotti Shopify con stock totale sommato su tutte le location."""
    products = get_products()
    locations = get_locations()
    if not locations:
        return []

    item_map: Dict[int, Tuple[int, str]] = {}
    product_agg: Dict[int, Dict[str, Any]] = {}
    all_ids: List[int] = []

    for pi, product in enumerate(products):
        product_agg[pi] = {"id": product.get("id"), "title": product.get("title", ""), "total_available": 0}
        for variant in product.get("variants", []):
            inv_id = variant.get("inventory_item_id")
            if inv_id:
                all_ids.append(inv_id)
                item_map[inv_id] = (pi, variant.get("title", "Default"))

    if not all_ids:
        return []

    for loc in locations:
        levels = get_inventory_levels(loc["id"], all_ids)
        for level in levels:
            inv_id = level.get("inventory_item_id")
            qty = level.get("available") or 0
            if inv_id in item_map:
                pi, _ = item_map[inv_id]
                product_agg[pi]["total_available"] += qty

    return list(product_agg.values())


# --- Clienti ---

def get_customers(
    created_at_min: Optional[str] = None,
    created_at_max: Optional[str] = None,
    limit: int = 250,
) -> List[Dict[str, Any]]:
    """Recupera i clienti con paginazione."""
    params = {"limit": min(limit, 250)}  # type: Dict[str, Any]
    if created_at_min:
        params["created_at_min"] = created_at_min
    if created_at_max:
        params["created_at_max"] = created_at_max
    return _paginated_get(f"{_base_url()}/customers.json", params)


def get_customers_count(
    created_at_min: Optional[str] = None,
    created_at_max: Optional[str] = None,
) -> int:
    """Conteggio clienti."""
    params = {}  # type: Dict[str, Any]
    if created_at_min:
        params["created_at_min"] = created_at_min
    if created_at_max:
        params["created_at_max"] = created_at_max
    resp = requests.get(f"{_base_url()}/customers/count.json", headers=_headers(), params=params)
    resp.raise_for_status()
    return resp.json().get("count", 0)


# --- Helpers ---

def _build_bom_cost_map() -> Dict[str, float]:
    """Costruisce mappa product_name (lowercase) → unit_cost dalle foglie BOM."""
    cost_map = {}  # type: Dict[str, float]
    try:
        data = inventory_store._load_data()
        for product in data.get("products", []):
            name = product.get("name", "")
            if name:
                # Usa unit_cost del prodotto se è una foglia, altrimenti somma i figli
                uc = product.get("unit_cost", 0)
                if uc and uc > 0:
                    cost_map[name.lower()] = float(uc)
                # Cerca anche nei figli diretti (componenti)
                for child in product.get("children", []):
                    child_name = child.get("name", "")
                    child_cost = child.get("unit_cost", 0)
                    if child_name and child_cost and child_cost > 0:
                        cost_map[child_name.lower()] = float(child_cost)
    except Exception:
        pass
    return cost_map


# --- Aggregazioni per Dashboard ---

def get_dashboard_summary(days: int = 30) -> Dict[str, Any]:
    """
    Calcola un riepilogo completo per la dashboard Shopify:
    - total_revenue, order_count, avg_order_value
    - orders_by_day [{date, count, revenue}]
    - pending_orders, completed_orders
    - top_products [{title, quantity_sold, revenue}]
    - low_stock_products [{title, variant, inventory_quantity}]
    - new_customers, returning_customers
    """
    now = datetime.now()
    start = (now - timedelta(days=days)).isoformat()

    # Ordini nel periodo
    orders = get_orders(status="any", created_at_min=start)

    # Mappa costi BOM: product_name (lowercase) → unit_cost
    bom_cost_map = _build_bom_cost_map()

    # Revenue e conteggi
    total_revenue = 0.0
    total_cost = 0.0
    pending_count = 0
    completed_count = 0
    new_customer_orders = 0
    returning_customer_orders = 0
    orders_by_day = defaultdict(lambda: {"count": 0, "revenue": 0.0})  # type: defaultdict
    product_sales = defaultdict(lambda: {"quantity": 0, "revenue": 0.0})  # type: defaultdict

    for order in orders:
        price = float(order.get("total_price", 0))
        total_revenue += price

        # Stato finanziario
        fin_status = order.get("financial_status", "")
        if fin_status == "paid":
            completed_count += 1
        elif fin_status in ("pending", "authorized", "partially_paid"):
            pending_count += 1

        # New vs Returning: orders_count == 1 al momento dell'ordine → nuovo cliente
        customer = order.get("customer") or {}
        customer_orders_count = customer.get("orders_count", 0)
        if customer_orders_count <= 1:
            new_customer_orders += 1
        else:
            returning_customer_orders += 1

        # Ordini per giorno
        created = order.get("created_at", "")[:10]
        if created:
            orders_by_day[created]["count"] += 1
            orders_by_day[created]["revenue"] += price

        # Vendite per prodotto + costo per gross profit
        for item in order.get("line_items", []):
            title = item.get("title", "Unknown")
            qty = item.get("quantity", 0)
            item_revenue = float(item.get("price", 0)) * qty
            product_sales[title]["quantity"] += qty
            product_sales[title]["revenue"] += item_revenue
            # Costo da BOM (match case-insensitive)
            unit_cost = bom_cost_map.get(title.lower(), 0.0)
            total_cost += unit_cost * qty

    order_count = len(orders)
    avg_order_value = total_revenue / order_count if order_count > 0 else 0.0
    gross_profit = total_revenue - total_cost

    # Ordina per data
    sorted_days = sorted(orders_by_day.items())
    orders_by_day_list = [
        {"date": d, "count": v["count"], "revenue": round(v["revenue"], 2)}
        for d, v in sorted_days
    ]

    # Top 10 prodotti
    sorted_products = sorted(product_sales.items(), key=lambda x: x[1]["revenue"], reverse=True)
    top_products = [
        {"title": title, "quantity_sold": data["quantity"], "revenue": round(data["revenue"], 2)}
        for title, data in sorted_products[:10]
    ]

    # Revenue per prodotto (tutti, per pie chart)
    revenue_by_product = [
        {"title": title, "quantity_sold": data["quantity"], "revenue": round(data["revenue"], 2)}
        for title, data in sorted_products
    ]

    # Prodotti con stock basso
    low_stock = _get_low_stock_products()

    # Clienti (conteggio totale, mantenuto per retrocompatibilità)
    new_customers = get_customers_count(created_at_min=start)
    total_customers_with_orders = len(set(
        order.get("customer", {}).get("id") for order in orders
        if order.get("customer")
    ))
    returning_customers = max(0, total_customers_with_orders - new_customers)

    return {
        "total_revenue": round(total_revenue, 2),
        "order_count": order_count,
        "avg_order_value": round(avg_order_value, 2),
        "gross_profit": round(gross_profit, 2),
        "pending_orders": pending_count,
        "completed_orders": completed_count,
        "new_customer_orders": new_customer_orders,
        "returning_customer_orders": returning_customer_orders,
        "orders_by_day": orders_by_day_list,
        "top_products": top_products,
        "revenue_by_product": revenue_by_product,
        "low_stock_products": low_stock,
        "new_customers": new_customers,
        "returning_customers": returning_customers,
    }


def _get_low_stock_products(threshold: int = 10) -> List[Dict[str, Any]]:
    """Trova prodotti con inventario sotto la soglia."""
    low_stock = []  # type: List[Dict[str, Any]]
    try:
        products = get_products()
        locations = get_locations()
        if not locations:
            return low_stock
        location_id = locations[0]["id"]

        # Raccoglie tutti gli inventory_item_id
        item_map = {}  # type: Dict[int, Tuple[str, str]]
        item_ids = []  # type: List[int]
        for product in products:
            for variant in product.get("variants", []):
                inv_id = variant.get("inventory_item_id")
                if inv_id:
                    item_ids.append(inv_id)
                    item_map[inv_id] = (product.get("title", ""), variant.get("title", "Default"))

        if not item_ids:
            return low_stock

        levels = get_inventory_levels(location_id, item_ids)
        for level in levels:
            qty = level.get("available", 0)
            if qty is not None and qty < threshold:
                inv_id = level.get("inventory_item_id")
                if inv_id and inv_id in item_map:
                    product_title, variant_title = item_map[inv_id]
                    low_stock.append({
                        "title": product_title,
                        "variant": variant_title,
                        "inventory_quantity": qty or 0,
                    })

        low_stock.sort(key=lambda x: x["inventory_quantity"])
    except Exception:
        # Se l'inventario non è accessibile, ritorna lista vuota
        pass

    return low_stock


def get_sales_trend_analysis(
    current_days: int = 7,
    comparison_days: int = 7,
) -> Dict[str, Any]:
    """
    Confronta il periodo corrente con il precedente:
    - order_count_current, order_count_previous, order_count_change_pct
    - revenue_current, revenue_previous, revenue_change_pct
    - avg_order_value_current, avg_order_value_previous, avg_order_value_change_pct
    - top_growing_products, top_declining_products
    """
    now = datetime.now()
    current_start = (now - timedelta(days=current_days)).isoformat()
    previous_start = (now - timedelta(days=current_days + comparison_days)).isoformat()
    previous_end = (now - timedelta(days=current_days)).isoformat()

    current_orders = get_orders(status="any", created_at_min=current_start)
    previous_orders = get_orders(status="any", created_at_min=previous_start, created_at_max=previous_end)

    def _analyze_orders(orders: List[Dict[str, Any]]) -> Tuple[float, int, Dict[str, int]]:
        revenue = sum(float(o.get("total_price", 0)) for o in orders)
        count = len(orders)
        product_qty = defaultdict(int)  # type: defaultdict
        for o in orders:
            for item in o.get("line_items", []):
                product_qty[item.get("title", "Unknown")] += item.get("quantity", 0)
        return revenue, count, dict(product_qty)

    curr_rev, curr_count, curr_products = _analyze_orders(current_orders)
    prev_rev, prev_count, prev_products = _analyze_orders(previous_orders)

    def _pct_change(current: float, previous: float) -> float:
        if previous == 0:
            return 100.0 if current > 0 else 0.0
        return round(((current - previous) / previous) * 100, 1)

    curr_aov = curr_rev / curr_count if curr_count > 0 else 0.0
    prev_aov = prev_rev / prev_count if prev_count > 0 else 0.0

    # Prodotti in crescita e in declino
    all_product_names = set(list(curr_products.keys()) + list(prev_products.keys()))
    product_changes = []
    for name in all_product_names:
        curr_qty = curr_products.get(name, 0)
        prev_qty = prev_products.get(name, 0)
        change = curr_qty - prev_qty
        product_changes.append({"title": name, "current_qty": curr_qty, "previous_qty": prev_qty, "change": change})

    product_changes.sort(key=lambda x: x["change"], reverse=True)
    top_growing = product_changes[:5]
    top_declining = sorted(product_changes, key=lambda x: x["change"])[:5]

    return {
        "period": {"current_days": current_days, "comparison_days": comparison_days},
        "order_count_current": curr_count,
        "order_count_previous": prev_count,
        "order_count_change_pct": _pct_change(float(curr_count), float(prev_count)),
        "revenue_current": round(curr_rev, 2),
        "revenue_previous": round(prev_rev, 2),
        "revenue_change_pct": _pct_change(curr_rev, prev_rev),
        "avg_order_value_current": round(curr_aov, 2),
        "avg_order_value_previous": round(prev_aov, 2),
        "avg_order_value_change_pct": _pct_change(curr_aov, prev_aov),
        "top_growing_products": top_growing,
        "top_declining_products": top_declining,
    }
