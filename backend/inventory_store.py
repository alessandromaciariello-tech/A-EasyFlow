"""
Inventory Data Store - persistence for products with recursive BOM tree.
Pattern: identical to gantt_store.py (recursive children[], find, add, delete).
Includes: supplier list, restock workflow templates, per-item restock workflows.
"""
import json
import uuid
from typing import Dict, List, Optional, Tuple
from storage_helper import load_json, save_json


def _generate_id() -> str:
    return str(uuid.uuid4())[:8]


def _default_data() -> Dict:
    return {"products": [], "suppliers": [], "restock_templates": []}


# --- Recursive Helpers ---

def _find_item_recursive(items: List[Dict], item_id: str) -> Optional[Dict]:
    """Find a BOM item by ID anywhere in the tree."""
    for item in items:
        if item["id"] == item_id:
            return item
        found = _find_item_recursive(item.get("children", []), item_id)
        if found is not None:
            return found
    return None


def _find_item_and_parent_list(items: List[Dict], item_id: str) -> Optional[Tuple[List[Dict], Dict]]:
    """Returns (parent_list, item) where parent_list is the list containing the item."""
    for item in items:
        if item["id"] == item_id:
            return (items, item)
        result = _find_item_and_parent_list(item.get("children", []), item_id)
        if result is not None:
            return result
    return None


# --- Lead Time Computation ---

def _compute_lead_time(workflow: Optional[Dict]) -> int:
    """Compute lead_time_days from a restock workflow.
    Phases are parallel; tasks within a phase are sequential.
    Lead time = max across phases of sum of task durations."""
    if not workflow or not workflow.get("phases"):
        return 0
    max_phase = 0
    for phase in workflow["phases"]:
        phase_total = sum(
            t.get("duration_days", 0)
            for t in phase.get("tasks", [])
            if t.get("duration_type", "fixed") == "fixed"
        )
        if phase_total > max_phase:
            max_phase = phase_total
    return max_phase


# --- Load / Save ---

def load_data() -> Dict:
    data = load_json("inventory")
    if data is None:
        data = _default_data()
        save_data(data)
        return data
    # Migration: ensure new keys exist
    if "suppliers" not in data:
        data["suppliers"] = []
    if "restock_templates" not in data:
        data["restock_templates"] = []
    # Migration: suppliers string[] -> object[]
    suppliers = data.get("suppliers", [])
    if suppliers and isinstance(suppliers[0], str):
        data["suppliers"] = [{"name": s, "phone": "", "email": ""} for s in suppliers]
        save_data(data)
    # Migration: ensure new supplier fields
    migrated = False
    for s in data.get("suppliers", []):
        if isinstance(s, dict):
            for key, default in [("contact_person", ""), ("channel_type", "email"), ("notes", ""), ("default_lead_time", None), ("default_moq", None)]:
                if key not in s:
                    s[key] = default
                    migrated = True
    # Migration: ensure desired_stock field on all products
    for p in data.get("products", []):
        if "desired_stock" not in p:
            p["desired_stock"] = None
            migrated = True
    # Migration: ensure moq and sku on all BOM items
    def _migrate_items(items: list) -> bool:
        changed = False
        for item in items:
            if isinstance(item, dict):
                if "moq" not in item:
                    item["moq"] = 1
                    changed = True
                if "sku" not in item:
                    item["sku"] = ""
                    changed = True
                if "gantt_section_id" not in item:
                    item["gantt_section_id"] = None
                    changed = True
                if item.get("children"):
                    if _migrate_items(item["children"]):
                        changed = True
        return changed
    for p in data.get("products", []):
        if _migrate_items(p.get("children", [])):
            migrated = True
    if migrated:
        save_data(data)
    return data


def save_data(data: Dict) -> None:
    save_json("inventory", data)


# --- Product CRUD (root level) ---

def add_product(name: str, shopify_id: Optional[int] = None) -> Dict:
    data = load_data()
    product: Dict = {
        "id": _generate_id(),
        "name": name,
        "collapsed": False,
        "desired_stock": None,
        "children": [],
    }
    if shopify_id is not None:
        product["shopify_id"] = shopify_id
    data["products"].append(product)
    save_data(data)
    return product


def update_product(product_id: str, updates: Dict) -> Optional[Dict]:
    data = load_data()
    for prod in data["products"]:
        if prod["id"] == product_id:
            updates.pop("id", None)
            prod.update(updates)
            save_data(data)
            return prod
    return None


def delete_product(product_id: str) -> bool:
    data = load_data()
    original_len = len(data["products"])
    data["products"] = [p for p in data["products"] if p["id"] != product_id]
    if len(data["products"]) < original_len:
        save_data(data)
        return True
    return False


# --- BOM Item CRUD (recursive, any depth) ---

def add_child(
    product_id: str,
    parent_id: str,
    name: str,
    quantity: int = 1,
    supplier: str = "",
    unit_cost: float = 0,
    moq: int = 1,
    sku: str = "",
    restock_workflow: Optional[Dict] = None,
) -> Optional[Dict]:
    """Add a child item to any node at any depth within a product."""
    data = load_data()
    for prod in data["products"]:
        if prod["id"] == product_id:
            # parent_id can be the product itself or any descendant
            if parent_id == product_id:
                parent = prod
            else:
                parent = _find_item_recursive(prod["children"], parent_id)
            if parent is None:
                return None
            child = {
                "id": _generate_id(),
                "name": name,
                "quantity": quantity,
                "supplier": supplier,
                "unit_cost": unit_cost,
                "quantity_in_stock": 0,
                "collapsed": False,
                "moq": moq,
                "sku": sku,
                "restock_workflow": restock_workflow,
                "gantt_section_id": None,
                "children": [],
            }
            parent["children"].append(child)
            save_data(data)
            return child
    return None


def update_item(product_id: str, item_id: str, updates: Dict) -> Optional[Dict]:
    """Update any BOM item at any depth."""
    data = load_data()
    for prod in data["products"]:
        if prod["id"] == product_id:
            item = _find_item_recursive(prod["children"], item_id)
            if item is not None:
                updates.pop("id", None)
                item.update(updates)
                save_data(data)
                return item
    return None


def delete_item(product_id: str, item_id: str) -> bool:
    """Delete a BOM item and its entire subtree."""
    data = load_data()
    for prod in data["products"]:
        if prod["id"] == product_id:
            result = _find_item_and_parent_list(prod["children"], item_id)
            if result is not None:
                parent_list, item = result
                parent_list.remove(item)
                save_data(data)
                return True
    return False


# --- Supplier CRUD ---

def get_suppliers() -> List[Dict]:
    data = load_data()
    return data.get("suppliers", [])


def add_supplier(
    name: str,
    phone: str = "",
    email: str = "",
    contact_person: str = "",
    channel_type: str = "email",
    notes: str = "",
    default_lead_time: Optional[int] = None,
    default_moq: Optional[int] = None,
) -> List[Dict]:
    data = load_data()
    suppliers = data.get("suppliers", [])
    if not any(s["name"] == name for s in suppliers):
        suppliers.append({
            "name": name,
            "phone": phone,
            "email": email,
            "contact_person": contact_person,
            "channel_type": channel_type,
            "notes": notes,
            "default_lead_time": default_lead_time,
            "default_moq": default_moq,
        })
        suppliers.sort(key=lambda s: s["name"].lower())
        data["suppliers"] = suppliers
        save_data(data)
    return data["suppliers"]


def update_supplier(name: str, updates: Dict) -> List[Dict]:
    data = load_data()
    allowed = {"phone", "email", "contact_person", "channel_type", "notes", "default_lead_time", "default_moq"}
    for s in data.get("suppliers", []):
        if s["name"] == name:
            for key, value in updates.items():
                if key in allowed:
                    s[key] = value
            break
    save_data(data)
    return data["suppliers"]


def delete_supplier(name: str) -> List[Dict]:
    data = load_data()
    data["suppliers"] = [s for s in data.get("suppliers", []) if s["name"] != name]
    save_data(data)
    return data["suppliers"]


# --- Restock Template CRUD ---

def get_restock_templates() -> List[Dict]:
    data = load_data()
    return data.get("restock_templates", [])


def create_restock_template(name: str, phases: List[Dict]) -> Dict:
    data = load_data()
    template = {
        "id": _generate_id(),
        "name": name,
        "phases": phases,
    }
    data.setdefault("restock_templates", []).append(template)
    save_data(data)
    return template


def update_restock_template(template_id: str, updates: Dict) -> Optional[Dict]:
    data = load_data()
    for t in data.get("restock_templates", []):
        if t["id"] == template_id:
            updates.pop("id", None)
            t.update(updates)
            save_data(data)
            return t
    return None


def delete_restock_template(template_id: str) -> bool:
    data = load_data()
    templates = data.get("restock_templates", [])
    original_len = len(templates)
    data["restock_templates"] = [t for t in templates if t["id"] != template_id]
    if len(data["restock_templates"]) < original_len:
        save_data(data)
        return True
    return False


# --- Production Check (recursive leaf collection) ---

def _collect_leaves(children: List[Dict], parent_qty: float = 1) -> Dict[str, Dict]:
    """Recursively collect leaf nodes with cumulative quantities."""
    leaves = {}  # type: Dict[str, Dict]
    for item in children:
        item_qty = item.get("quantity", 1) * parent_qty
        if not item.get("children"):
            # Leaf node
            iid = item["id"]
            if iid in leaves:
                leaves[iid]["needed"] += item_qty
            else:
                leaves[iid] = {
                    "id": iid,
                    "name": item["name"],
                    "needed": item_qty,
                    "quantity_in_stock": item.get("quantity_in_stock", 0),
                    "unit": "pezzi",
                    "unit_cost": item.get("unit_cost", 0),
                    "supplier": item.get("supplier", ""),
                    "lead_time_days": _compute_lead_time(item.get("restock_workflow")),
                    "moq": item.get("moq", 1),
                }
        else:
            # Intermediate node: recurse
            sub_leaves = _collect_leaves(item["children"], item_qty)
            for k, v in sub_leaves.items():
                if k in leaves:
                    leaves[k]["needed"] += v["needed"]
                else:
                    leaves[k] = v
    return leaves


def calculate_production_needs(product_id: str, quantity: int) -> Dict:
    """Calculate what's needed to produce `quantity` units of a product."""
    data = load_data()

    product = None
    for p in data["products"]:
        if p["id"] == product_id:
            product = p
            break
    if not product:
        return {"product_id": product_id, "quantity": quantity, "producible": False, "total_missing_cost": 0, "max_lead_time_days": 0, "lines": []}

    leaves = _collect_leaves(product["children"], quantity)

    lines = []
    total_cost = 0.0
    max_lead_time = 0
    all_available = True

    for leaf in leaves.values():
        needed = leaf["needed"]
        in_stock = leaf["quantity_in_stock"]
        missing = max(0, needed - in_stock)
        missing_cost = missing * leaf["unit_cost"]
        total_cost += missing_cost

        if missing > 0:
            all_available = False
            if leaf["lead_time_days"] > max_lead_time:
                max_lead_time = leaf["lead_time_days"]

        lines.append({
            "component_id": leaf["id"],
            "name": leaf["name"],
            "needed": needed,
            "in_stock": in_stock,
            "missing": missing,
            "unit": leaf["unit"],
            "unit_cost": leaf["unit_cost"],
            "missing_cost": missing_cost,
            "supplier": leaf["supplier"],
            "lead_time_days": leaf["lead_time_days"],
        })

    return {
        "product_id": product_id,
        "quantity": quantity,
        "producible": all_available,
        "total_missing_cost": total_cost,
        "max_lead_time_days": max_lead_time,
        "lines": lines,
    }


def calculate_max_producible(product_id: str) -> Dict:
    """Calculate the maximum number of units producible from current stock."""
    data = load_data()

    product = None
    for p in data["products"]:
        if p["id"] == product_id:
            product = p
            break
    if not product or not product.get("children"):
        return {"product_id": product_id, "max_producible": 0, "bottleneck": None, "leaves": []}

    # Collect leaves for quantity=1 (per-unit needs)
    leaves = _collect_leaves(product["children"], 1)
    if not leaves:
        return {"product_id": product_id, "max_producible": 0, "bottleneck": None, "leaves": []}

    max_producible = float("inf")
    bottleneck = None
    leaf_details = []

    for leaf in leaves.values():
        needed_per_unit = leaf["needed"]
        in_stock = leaf["quantity_in_stock"]

        if needed_per_unit <= 0:
            continue

        units_from_this = int(in_stock // needed_per_unit)

        leaf_details.append({
            "id": leaf["id"],
            "name": leaf["name"],
            "needed_per_unit": needed_per_unit,
            "in_stock": in_stock,
            "max_units": units_from_this,
            "supplier": leaf["supplier"],
            "unit_cost": leaf["unit_cost"],
            "lead_time_days": leaf["lead_time_days"],
        })

        if units_from_this < max_producible:
            max_producible = units_from_this
            bottleneck = leaf["name"]

    if max_producible == float("inf"):
        max_producible = 0

    return {
        "product_id": product_id,
        "max_producible": int(max_producible),
        "bottleneck": bottleneck,
        "leaves": leaf_details,
    }
