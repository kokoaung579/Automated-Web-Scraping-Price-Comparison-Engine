"""Shared category helpers for product/category consistency.

Categories are name-keyed documents in the ``categories`` collection and
products reference them with the same name string in both the top-level
``category`` field and the embedded ``adminProduct.category`` field. These
helpers keep that reference consistent and backward compatible without adding
a new product field or changing the deferred unified product schema.
"""

from datetime import datetime, timezone


def category_name(document: dict) -> str:
    """Return the canonical name of a category document."""
    return str(document.get("name") or document.get("_id") or "")


def _plural_variants(name: str) -> set[str]:
    normalized = name.strip()
    variants = {normalized.casefold()}
    if normalized.lower().endswith("s") and len(normalized) > 1:
        variants.add(normalized[:-1].casefold())
    else:
        variants.add(f"{normalized}s".casefold())
    return variants


def _resolve(requested: str, names: list[str]) -> str | None:
    """Resolve a stored category spelling, including legacy case/plural values."""
    value = str(requested or "").strip()
    if not value or not names:
        return None
    if value in names:
        return value
    variants = _plural_variants(value)
    for candidate in names:
        if _plural_variants(candidate) & variants:
            return candidate
    return None


async def stored_category_names(database) -> list[str]:
    categories = getattr(database, "categories", None)
    if categories is None:
        return []
    documents = await categories.find().to_list(length=None)
    return [name for name in (category_name(doc) for doc in documents) if name]


async def canonical_category_name(database, name: str) -> str | None:
    """Resolve a product category value to a real category record.

    Returns ``None`` when the collection has no categories (legacy bootstrap)
    or when the value does not match any stored category.
    """
    return _resolve(name, await stored_category_names(database))


async def count_products_using_category(database, name: str) -> int:
    """Count products referencing a category in either category field."""
    products = getattr(database, "products", None)
    if products is None:
        return 0
    documents = await products.find().to_list(length=None)
    count = 0
    for document in documents:
        if str(document.get("category") or "") == name:
            count += 1
            continue
        admin_product = document.get("adminProduct")
        if isinstance(admin_product, dict) and str(
            admin_product.get("category") or ""
        ) == name:
            count += 1
    return count


async def sync_product_category_name(
    database,
    old_name: str,
    new_name: str,
    updated_at: str,
) -> int:
    """Rewrite both product category fields after a category rename."""
    products = getattr(database, "products", None)
    if products is None or old_name == new_name:
        return 0
    documents = await products.find().to_list(length=None)
    changed = 0
    for document in documents:
        updates: dict = {}
        if str(document.get("category") or "") == old_name:
            updates["category"] = new_name
        admin_product = document.get("adminProduct")
        if (
            isinstance(admin_product, dict)
            and str(admin_product.get("category") or "") == old_name
        ):
            updates["adminProduct"] = {**admin_product, "category": new_name}
        if updates:
            updates["updatedAt"] = updated_at
            await products.update_one({"_id": document["_id"]}, {"$set": updates})
            changed += 1
    return changed


async def ensure_product_categories(database) -> dict:
    """Give every existing product category a real category record.

    Safe one-time migration:

    * creates a category for genuinely missing values (e.g. ``Gaming``),
    * normalizes near-duplicate values to the stored spelling
      (e.g. ``Phones`` -> ``Phone``),
    * never deletes products/categories or reassigns ``Uncategorized``,
    * only touches the category fields on a product document.
    """
    categories = getattr(database, "categories", None)
    products = getattr(database, "products", None)
    if categories is None or products is None:
        return {"created": [], "normalized": 0}

    names = await stored_category_names(database)
    created: list[str] = []
    normalized = 0

    async def ensure(name: str) -> str:
        resolved = _resolve(name, names)
        if resolved is not None:
            return resolved
        now = datetime.now(timezone.utc).isoformat()
        document = {
            "_id": name,
            "name": name,
            "description": f"Products in the {name} category.",
            "status": "Active",
            "created_at": now,
            "updated_at": now,
        }
        await categories.insert_one(document)
        names.append(name)
        created.append(name)
        return name

    for document in await products.find().to_list(length=None):
        updates: dict = {}
        top_level = document.get("category")
        if isinstance(top_level, str) and top_level.strip():
            canonical = await ensure(top_level)
            if canonical != top_level:
                updates["category"] = canonical
        admin_product = document.get("adminProduct")
        if isinstance(admin_product, dict):
            nested = admin_product.get("category")
            if isinstance(nested, str) and nested.strip():
                canonical = await ensure(nested)
                if canonical != nested:
                    updates["adminProduct"] = {**admin_product, "category": canonical}
        if updates:
            await products.update_one({"_id": document["_id"]}, {"$set": updates})
            normalized += 1

    return {"created": created, "normalized": normalized}
