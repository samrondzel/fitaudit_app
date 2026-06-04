import json
import re
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request, abort


DATA_FILE = Path(__file__).with_name("fitaudit_cache.jsonl")

app = Flask(__name__)


def nice_label(raw: str) -> str:
    """vitamin_витамин_c_amount -> Витамин C"""
    label = raw.replace("_", " ").strip()
    replacements = {
        "витамин a": "Витамин A",
        "витамин b1": "Витамин B1",
        "витамин b2": "Витамин B2",
        "витамин b3": "Витамин B3",
        "витамин b4": "Витамин B4",
        "витамин b5": "Витамин B5",
        "витамин b6": "Витамин B6",
        "витамин b9": "Витамин B9",
        "витамин b12": "Витамин B12",
        "витамин c": "Витамин C",
        "витамин d": "Витамин D",
        "витамин d2": "Витамин D2",
        "витамин d3": "Витамин D3",
        "витамин e": "Витамин E",
        "витамин k": "Витамин K",
    }
    return replacements.get(label.lower(), label[:1].upper() + label[1:])


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower().replace("ё", "е")).strip()


def load_foods() -> list[dict[str, Any]]:
    foods = []
    seen = set()

    if not DATA_FILE.exists():
        raise FileNotFoundError(f"Не найден файл {DATA_FILE}")

    with DATA_FILE.open("r", encoding="utf-8") as f:
        for line_number, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue

            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                print(f"Skip bad JSON line {line_number}")
                continue

            food_id = str(item.get("food_id") or item.get("url", "").rstrip("/").split("/")[-1])
            if not food_id or food_id in seen:
                continue

            item["food_id"] = food_id
            item["_search"] = normalize(" ".join([
                str(item.get("name") or ""),
                str(item.get("title") or ""),
                str(food_id),
            ]))

            foods.append(item)
            seen.add(food_id)

    return foods


FOODS = load_foods()
FOODS_BY_ID = {food["food_id"]: food for food in FOODS}


def group_prefixed_fields(food: dict[str, Any], prefix: str) -> list[dict[str, Any]]:
    """
    Собирает поля:
    vitamin_витамин_c_amount
    vitamin_витамин_c_unit
    vitamin_витамин_c_daily_percent

    в список объектов для таблицы.
    """
    groups: dict[str, dict[str, Any]] = {}

    for key, value in food.items():
        if not key.startswith(prefix + "_"):
            continue

        rest = key[len(prefix) + 1:]

        for suffix in ("_amount", "_unit", "_daily_percent"):
            if rest.endswith(suffix):
                nutrient_key = rest[:-len(suffix)]
                field = suffix[1:]
                groups.setdefault(nutrient_key, {})[field] = value
                break

    rows = []
    for nutrient_key, values in groups.items():
        amount = values.get("amount")
        unit = values.get("unit")
        daily = values.get("daily_percent")

        # Не показываем полностью пустые строки.
        if amount is None and unit is None and daily in (None, 0, 0.0):
            continue

        rows.append({
            "name": nice_label(nutrient_key),
            "amount": amount,
            "unit": unit,
            "daily_percent": daily,
        })

    return sorted(rows, key=lambda x: x["name"].lower())


def macro_value(food: dict[str, Any], field: str, fallback_field: str | None = None):
    value = food.get(field)
    if value is None and fallback_field:
        value = food.get(fallback_field)
    return value


MACRO_DEFS = {
    "calories_kcal": {"name": "Калории", "unit": "ккал"},
    "protein_g": {"name": "Белки", "unit": "г"},
    "fat_g": {"name": "Жиры", "unit": "г"},
    "carbs_g": {"name": "Углеводы", "unit": "г"},
    "water_g": {"name": "Вода", "unit": "г"},
    "fiber_g": {"name": "Клетчатка", "unit": "г"},
}


def food_to_api(food: dict[str, Any]) -> dict[str, Any]:
    vitamins = group_prefixed_fields(food, "vitamin")
    minerals = group_prefixed_fields(food, "mineral")

    macros = {
        "calories_kcal": food.get("calories_kcal"),
        "protein_g": macro_value(food, "protein_g", "vitamin_белки_amount"),
        "fat_g": macro_value(food, "fat_g", "vitamin_жиры_amount"),
        "carbs_g": food.get("vitamin_углеводы_amount") if food.get("vitamin_углеводы_amount") is not None else food.get("carbs_g"),
        "water_g": food.get("water_g"),
        "fiber_g": food.get("fiber_g"),
    }

    return {
        "food_id": food["food_id"],
        "name": food.get("name"),
        "title": food.get("title"),
        "url": food.get("url"),
        "macros": macros,
        "vitamins": vitamins,
        "minerals": minerals,
    }


def nutrient_options() -> list[dict[str, Any]]:
    seen = {}

    for key, meta in MACRO_DEFS.items():
        seen[f"macro::{key}"] = {
            "id": f"macro::{key}",
            "group": "macro",
            "key": key,
            "name": meta["name"],
            "unit": meta["unit"],
            "label": meta["name"],
        }

    for food in FOODS:
        api_food_obj = food_to_api(food)
        for group, rows_name, label_prefix in [
            ("vitamin", "vitamins", "Витамин"),
            ("mineral", "minerals", "Минерал"),
        ]:
            for row in api_food_obj[rows_name]:
                name = row.get("name")
                if not name:
                    continue
                key = f"{group}::{normalize(name)}::{row.get('unit') or ''}"
                if key not in seen:
                    seen[key] = {
                        "id": key,
                        "group": group,
                        "key": normalize(name),
                        "name": name,
                        "unit": row.get("unit"),
                        "label": f"{name} ({label_prefix})",
                    }

    return sorted(seen.values(), key=lambda x: normalize(x["label"]))


@app.get("/")
def index():
    return render_template("index.html", foods_count=len(FOODS))


@app.get("/api/search")
def api_search():
    q = normalize(request.args.get("q", ""))
    limit = int(request.args.get("limit", 10))

    if not q:
        return jsonify([])

    matches = []

    for food in FOODS:
        name = food.get("name") or food.get("title") or ""
        title = food.get("title") or ""
        search = food.get("_search", "")

        if q in search:
            matches.append({
                "id": food["food_id"],
                "name": name,
                "title": title,
                "url": food.get("url"),
            })

        if len(matches) >= limit:
            break

    return jsonify(matches)


@app.get("/api/food/<food_id>")
def api_food(food_id: str):
    food = FOODS_BY_ID.get(food_id)
    if not food:
        abort(404)
    return jsonify(food_to_api(food))


@app.get("/api/nutrients")
def api_nutrients():
    q = normalize(request.args.get("q", ""))
    limit = int(request.args.get("limit", 20))
    items = nutrient_options()

    if q:
        items = [item for item in items if q in normalize(item["label"])]

    return jsonify(items[:limit])


@app.get("/api/top-nutrient")
def api_top_nutrient():
    group = request.args.get("group", "")
    name = request.args.get("name", "")
    key = request.args.get("key", "")
    limit = int(request.args.get("limit", 20))

    results = []

    for food in FOODS:
        item = food_to_api(food)
        amount = None
        unit = None
        daily_percent = None

        if group == "macro":
            amount = item["macros"].get(key)
            unit = MACRO_DEFS.get(key, {}).get("unit")
        elif group in {"vitamin", "mineral"}:
            rows_name = "vitamins" if group == "vitamin" else "minerals"
            for row in item[rows_name]:
                if normalize(row.get("name", "")) == normalize(name):
                    amount = row.get("amount")
                    unit = row.get("unit")
                    daily_percent = row.get("daily_percent")
                    break

        if amount is None:
            continue

        try:
            amount_num = float(amount)
        except (TypeError, ValueError):
            continue

        if amount_num <= 0:
            continue

        results.append({
            "food_id": item["food_id"],
            "name": item.get("name"),
            "title": item.get("title"),
            "url": item.get("url"),
            "amount_per_100g": amount_num,
            "unit": unit,
            "daily_percent_per_100g": daily_percent,
        })

    results.sort(key=lambda x: x["amount_per_100g"], reverse=True)
    return jsonify(results[:limit])


app.run(debug=True)
