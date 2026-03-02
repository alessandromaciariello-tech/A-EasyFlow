"""
Restock Engine - Rule-based restock recommendation system.

Implements spec 3.8: recommends WHEN and HOW MUCH to reorder based on:
- Current inventory (BOM leaf components)
- Sales velocity from Shopify orders
- Component lead times from micro-Gantt workflows
- MOQ per component
- Safety stock days (user setting)

Algorithm (per product):
  demand_rate = avg daily sales over N days
  demand_std = stddev daily sales over N days
  spike = last 3 days avg > demand_rate + k * std
  days_of_cover = current_stock / max(demand_rate, 0.001)
  target_cover = lead_time + safety_stock + spike_buffer
  needs_reorder = days_of_cover < target_cover
  reorder_qty = ceil((target_cover - days_of_cover) * demand_rate)
  component_qty = reorder_qty * qty_per_unit, rounded up to MOQ
"""
import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import inventory_store
import settings_store

try:
    import shopify_client as shopify
except ImportError:
    shopify = None  # type: ignore[assignment]


def _get_daily_sales(days: int = 14) -> Dict[str, List[float]]:
    """
    Fetch Shopify orders and compute daily sales qty per product title.
    Returns {product_title: [day0_qty, day1_qty, ...]} for the last N days.
    """
    if shopify is None or not shopify.is_configured():
        return {}

    now = datetime.now()
    start = (now - timedelta(days=days)).isoformat()

    try:
        orders = shopify.get_orders(status="any", created_at_min=start)
    except Exception:
        return {}

    # Bucket sales by day offset (0 = oldest, days-1 = most recent)
    sales_by_day: Dict[str, Dict[int, float]] = defaultdict(lambda: defaultdict(float))
    base_date = (now - timedelta(days=days)).date()

    for order in orders:
        created = order.get("created_at", "")[:10]
        if not created:
            continue
        try:
            order_date = datetime.strptime(created, "%Y-%m-%d").date()
        except ValueError:
            continue
        day_index = (order_date - base_date).days
        if day_index < 0 or day_index >= days:
            continue

        for item in order.get("line_items", []):
            title = item.get("title", "")
            qty = item.get("quantity", 0)
            if title and qty > 0:
                sales_by_day[title][day_index] += qty

    # Convert to lists (fill zeros for days without sales)
    result: Dict[str, List[float]] = {}
    for title, day_map in sales_by_day.items():
        daily = [day_map.get(i, 0.0) for i in range(days)]
        result[title] = daily

    return result


def _compute_demand_stats(daily_sales: List[float]) -> Dict[str, float]:
    """Compute demand rate, stddev, and spike detection."""
    n = len(daily_sales)
    if n == 0:
        return {"demand_rate": 0, "demand_std": 0, "spike": False}

    avg = sum(daily_sales) / n
    variance = sum((x - avg) ** 2 for x in daily_sales) / max(n, 1)
    std = math.sqrt(variance)

    # Spike detection: last 3 days avg > overall avg + k * std
    last_3 = daily_sales[-3:] if len(daily_sales) >= 3 else daily_sales
    last_3_avg = sum(last_3) / len(last_3) if last_3 else 0

    settings = settings_store.load_settings()
    k = settings.get("spike_threshold_k", 1.5)
    spike = last_3_avg > avg + k * std if std > 0 else False

    return {"demand_rate": avg, "demand_std": std, "spike": spike}


def _compute_variable_lead_time(workflow: Optional[Dict], quantity: int = 1) -> int:
    """
    Compute lead time considering variable phase durations.
    Phases are parallel; tasks within a phase are sequential.
    For variable tasks: duration = duration_days + per_unit_duration * qty (clamped).
    """
    if not workflow or not workflow.get("phases"):
        return 0

    max_phase = 0
    for phase in workflow["phases"]:
        phase_total = 0
        for task in phase.get("tasks", []):
            dtype = task.get("duration_type", "fixed")
            base = task.get("duration_days", 0)
            if dtype == "variable":
                per_unit = task.get("per_unit_duration_days", 0)
                duration = base + per_unit * quantity
                min_d = task.get("min_duration_days")
                max_d = task.get("max_duration_days")
                if min_d is not None:
                    duration = max(duration, min_d)
                if max_d is not None:
                    duration = min(duration, max_d)
                phase_total += duration
            else:
                phase_total += base
        max_phase = max(max_phase, phase_total)

    return int(math.ceil(max_phase))


def get_recommendations() -> List[Dict[str, Any]]:
    """
    Generate restock recommendations for all BOM products.
    Returns list sorted by urgency (red first, then yellow, then green).
    """
    settings = settings_store.load_settings()
    safety_stock_days = settings.get("safety_stock_days", 7)
    demand_window = settings.get("demand_window_days", 14)

    inv_data = inventory_store.load_data()
    products = inv_data.get("products", [])

    if not products:
        return []

    # Get Shopify sales data
    daily_sales_map = _get_daily_sales(days=demand_window)

    recommendations: List[Dict[str, Any]] = []

    for product in products:
        product_name = product.get("name", "")
        product_id = product.get("id", "")
        children = product.get("children", [])

        if not children:
            continue

        # Match product to Shopify sales (case-insensitive)
        daily_sales = daily_sales_map.get(product_name, [])
        # Try case-insensitive match
        if not daily_sales:
            for title, sales in daily_sales_map.items():
                if title.lower() == product_name.lower():
                    daily_sales = sales
                    break

        stats = _compute_demand_stats(daily_sales)
        demand_rate = stats["demand_rate"]
        demand_std = stats["demand_std"]
        spike = stats["spike"]

        # Collect leaf components
        leaves = inventory_store._collect_leaves(children, 1)
        if not leaves:
            continue

        # Max lead time across all components (for this product)
        max_lead_time = 0
        for leaf in leaves.values():
            lt = leaf.get("lead_time_days", 0)
            if lt > max_lead_time:
                max_lead_time = lt

        # Calculate finished-product-level metrics
        # Use max-producible as current stock proxy
        max_prod = inventory_store.calculate_max_producible(product_id)
        current_stock = max_prod.get("max_producible", 0)

        # Days of cover
        days_of_cover = current_stock / max(demand_rate, 0.001) if demand_rate > 0 else 999

        # Target cover
        spike_buffer = 3 if spike else 0
        target_cover = max_lead_time + safety_stock_days + spike_buffer

        # Urgency classification
        needs_reorder = days_of_cover < target_cover
        if days_of_cover <= max_lead_time:
            urgency = "red"
        elif days_of_cover <= target_cover:
            urgency = "yellow"
        else:
            urgency = "green"

        # Recommended reorder quantity (in finished units)
        reorder_qty = 0
        if needs_reorder and demand_rate > 0:
            reorder_qty = math.ceil((target_cover - days_of_cover) * demand_rate)
            reorder_qty = max(reorder_qty, 1)

        # Per-component breakdown
        component_recommendations: List[Dict[str, Any]] = []
        for leaf in leaves.values():
            needed_per_unit = leaf["needed"]
            raw_qty = reorder_qty * needed_per_unit
            moq = leaf.get("moq", 1) or 1
            # Round up to MOQ multiple
            component_qty = math.ceil(raw_qty / moq) * moq if moq > 1 else math.ceil(raw_qty)

            component_recommendations.append({
                "component_id": leaf["id"],
                "name": leaf["name"],
                "needed_per_unit": needed_per_unit,
                "raw_qty": raw_qty,
                "moq": moq,
                "order_qty": component_qty,
                "supplier": leaf.get("supplier", ""),
                "unit_cost": leaf.get("unit_cost", 0),
                "total_cost": round(component_qty * leaf.get("unit_cost", 0), 2),
                "lead_time_days": leaf.get("lead_time_days", 0),
                "in_stock": leaf.get("quantity_in_stock", 0),
            })

        # Recommended order date = today (if urgent) or days_of_cover - target_cover days from now
        today = datetime.now().date()
        if urgency == "red":
            order_date = today.isoformat()
        elif needs_reorder:
            days_until_order = max(0, int(days_of_cover - max_lead_time - safety_stock_days))
            order_date = (today + timedelta(days=days_until_order)).isoformat()
        else:
            order_date = None

        total_cost = sum(c["total_cost"] for c in component_recommendations)

        recommendations.append({
            "product_id": product_id,
            "product_name": product_name,
            "urgency": urgency,
            "needs_reorder": needs_reorder,
            "current_stock": current_stock,
            "demand_rate": round(demand_rate, 2),
            "demand_std": round(demand_std, 2),
            "spike_detected": spike,
            "days_of_cover": round(days_of_cover, 1) if days_of_cover < 999 else None,
            "target_cover_days": target_cover,
            "max_lead_time_days": max_lead_time,
            "reorder_qty": reorder_qty,
            "order_date": order_date,
            "total_cost": round(total_cost, 2),
            "components": component_recommendations,
        })

    # Sort: red first, then yellow, then green
    urgency_order = {"red": 0, "yellow": 1, "green": 2}
    recommendations.sort(key=lambda r: (urgency_order.get(r["urgency"], 3), -(r.get("demand_rate") or 0)))

    return recommendations


def generate_restock_project(
    product_id: str,
    reorder_qty: int,
    components: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    """
    Generate a Gantt restock project with tasks for each component phase.
    Called when user confirms a restock recommendation.

    Creates:
    1. A Gantt section "Restock: {product_name} - {date}"
    2. For each component: parent task with subtasks per workflow phase/task

    Returns the created Gantt section dict.
    """
    import gantt_store

    inv_data = inventory_store.load_data()
    product = None
    for p in inv_data.get("products", []):
        if p["id"] == product_id:
            product = p
            break

    if not product:
        raise ValueError(f"Product {product_id} not found")

    product_name = product.get("name", "Unknown")
    today = datetime.now()
    section_title = f"Restock: {product_name} - {today.strftime('%d/%m/%Y')}"

    section = gantt_store.add_section(section_title)
    section_id = section["id"]

    # Collect leaves for per-component processing
    leaves = inventory_store._collect_leaves(product.get("children", []), 1)

    # Build component override map from user input
    comp_overrides: Dict[str, int] = {}
    if components:
        for c in components:
            cid = c.get("component_id", "")
            qty = c.get("order_qty", 0)
            if cid and qty:
                comp_overrides[cid] = qty

    phase_colors = ["#2D6A4F", "#5E8C6A", "#A0785A", "#C4956A", "#8B6F5A", "#6B8F71", "#D4A574", "#7BA38C"]
    color_idx = 0

    # Find actual BOM items with workflows
    def _find_items_with_workflow(children: List[Dict]) -> List[Dict]:
        result: List[Dict] = []
        for item in children:
            if item.get("restock_workflow") and item["restock_workflow"].get("phases"):
                result.append(item)
            result.extend(_find_items_with_workflow(item.get("children", [])))
        return result

    items_with_workflow = _find_items_with_workflow(product.get("children", []))

    cumulative_offset = 0
    for item in items_with_workflow:
        item_id = item["id"]
        item_name = item.get("name", "Component")
        workflow = item.get("restock_workflow", {})

        # Determine order quantity for this component
        leaf_data = leaves.get(item_id)
        needed_per_unit = leaf_data["needed"] if leaf_data else item.get("quantity", 1)
        order_qty = comp_overrides.get(item_id, math.ceil(reorder_qty * needed_per_unit))

        # Apply MOQ
        moq = item.get("moq", 1) or 1
        if moq > 1:
            order_qty = math.ceil(order_qty / moq) * moq

        color = phase_colors[color_idx % len(phase_colors)]
        color_idx += 1

        # Create parent task for this component
        component_lead_time = _compute_variable_lead_time(workflow, order_qty)
        comp_start = (today + timedelta(days=cumulative_offset)).strftime("%Y-%m-%d")

        parent_task = gantt_store.add_task(
            section_id,
            f"{item_name} (x{order_qty})",
            component_lead_time,
            comp_start,
            color,
        )
        if not parent_task:
            continue

        # Create subtasks for each phase's tasks
        task_offset = cumulative_offset
        for phase in workflow.get("phases", []):
            for task_def in phase.get("tasks", []):
                dtype = task_def.get("duration_type", "fixed")
                base = task_def.get("duration_days", 1)

                if dtype == "variable":
                    per_unit = task_def.get("per_unit_duration_days", 0)
                    duration = base + per_unit * order_qty
                    min_d = task_def.get("min_duration_days")
                    max_d = task_def.get("max_duration_days")
                    if min_d is not None:
                        duration = max(duration, min_d)
                    if max_d is not None:
                        duration = min(duration, max_d)
                    duration = math.ceil(duration)
                else:
                    duration = base

                task_start = (today + timedelta(days=task_offset)).strftime("%Y-%m-%d")
                gantt_store.add_subtask(
                    section_id,
                    parent_task["id"],
                    task_def.get("name", "Task"),
                    duration,
                    task_start,
                    color,
                )
                task_offset += duration

        cumulative_offset += component_lead_time

    return {
        "section": section,
        "product_id": product_id,
        "product_name": product_name,
        "reorder_qty": reorder_qty,
        "total_lead_time_days": cumulative_offset,
        "expected_completion": (today + timedelta(days=cumulative_offset)).strftime("%Y-%m-%d"),
    }
