import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.routers.auth import require_admin
from app.routers.audit import record_audit_log, request_ip
from app.services.category_catalog import (
    canonical_category_name,
    count_products_using_category,
    sync_product_category_name,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/categories",
    tags=["Category Management"],
)


class CategoryInput(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""
    status: Literal["Active", "Inactive"] = "Active"


def _category_payload(document: dict) -> dict:
    return {
        "name": document.get("name") or document.get("_id"),
        "description": document.get("description") or "",
        "status": document.get("status") or "Active",
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _audit(
    database,
    request: Request,
    admin: dict,
    *,
    action: str,
    description: str,
    target_record_id: str,
    event_status: str = "SUCCESS",
) -> None:
    try:
        await record_audit_log(
            database,
            user_id=str(admin["_id"]),
            user_email=str(admin["email"]),
            action=action,
            module="CATEGORY_MANAGEMENT",
            description=description,
            ip_address=request_ip(request),
            status=event_status,
            target_record_id=target_record_id,
            actor_role=str(admin.get("role") or "Admin"),
        )
    except Exception as exc:
        logger.warning("Unable to write category audit event: %s", exc)


@router.get("")
async def list_categories(request: Request, admin: dict = Depends(require_admin)):
    database = request.app.state.database
    documents = await database.categories.find().to_list(length=None)

    if not documents:
        # Categories previously lived only in the browser. Derive the initial
        # taxonomy from real catalog records without fabricating audit history.
        products = await database.products.find().to_list(length=None)
        grouped: dict[str, dict] = {}
        for product in products:
            name = str(product.get("category") or "").strip()
            if not name:
                continue
            current = grouped.get(name)
            created_at = product.get("created_at")
            if current is None:
                grouped[name] = {"created_at": created_at, "count": 1}
            else:
                current["count"] += 1
                if created_at and (
                    not current["created_at"] or created_at < current["created_at"]
                ):
                    current["created_at"] = created_at
        documents = [
            {
                "_id": name,
                "name": name,
                "description": f"Products in the {name} category.",
                "status": "Active",
                "created_at": data["created_at"] or _now(),
                "updated_at": data["created_at"] or _now(),
            }
            for name, data in sorted(grouped.items())
        ]

    return [_category_payload(document) for document in documents]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_category(
    category: CategoryInput,
    request: Request,
    admin: dict = Depends(require_admin),
):
    database = request.app.state.database
    name = category.name.strip()
    # Case-insensitive and singular/plural variants are the same category.
    # Creating "Phones" when "Phone" exists would split product references.
    if await canonical_category_name(database, name) is not None:
        await _audit(
            database,
            request,
            admin,
            action="CREATE",
            description=f"Failed to create category {name}: name already exists.",
            target_record_id=name,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A category with this name already exists.",
        )

    now = _now()
    document = {
        "_id": name,
        "name": name,
        "description": category.description.strip(),
        "status": category.status,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await database.categories.insert_one(document)
    except DuplicateKeyError:
        await _audit(
            database,
            request,
            admin,
            action="CREATE",
            description=f"Failed to create category {name}: name already exists.",
            target_record_id=name,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A category with this name already exists.",
        ) from None

    await _audit(
        database,
        request,
        admin,
        action="CREATE",
        description=f"Created category {name}.",
        target_record_id=name,
    )
    return _category_payload(document)


@router.put("/{category_name}")
async def update_category(
    category_name: str,
    category: CategoryInput,
    request: Request,
    admin: dict = Depends(require_admin),
):
    database = request.app.state.database
    name = category.name.strip()
    existing = await database.categories.find_one({"_id": category_name})
    if existing is None:
        await _audit(
            database,
            request,
            admin,
            action="UPDATE",
            description=f"Failed to update category {category_name}: not found.",
            target_record_id=category_name,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )

    documents = await database.categories.find().to_list(length=None)
    if any(
        str(item.get("_id")) != category_name
        and str(item.get("name") or item.get("_id")).casefold() == name.casefold()
        for item in documents
    ):
        await _audit(
            database,
            request,
            admin,
            action="UPDATE",
            description=f"Failed to update category {category_name}: name already exists.",
            target_record_id=category_name,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A category with this name already exists.",
        )

    now = _now()
    document = {
        "_id": name,
        "name": name,
        "description": category.description.strip(),
        "status": category.status,
        "created_at": existing.get("created_at") or now,
        "updated_at": now,
    }
    if name != category_name:
        await database.categories.insert_one(document)
        await database.categories.delete_one({"_id": category_name})
        # The admin API and dashboard read the embedded adminProduct copy, so
        # both category fields must move with the renamed record.
        await sync_product_category_name(database, category_name, name, now)
    else:
        await database.categories.update_one({"_id": category_name}, {"$set": document})

    status_changed = existing.get("status") != category.status
    action = "STATUS_CHANGE" if status_changed and name == category_name else "UPDATE"
    description = (
        f"Changed category {name} status to {category.status}."
        if action == "STATUS_CHANGE"
        else f"Updated category {name}."
    )
    await _audit(
        database,
        request,
        admin,
        action=action,
        description=description,
        target_record_id=name,
    )
    return _category_payload(document)


@router.delete("/{category_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_name: str,
    request: Request,
    admin: dict = Depends(require_admin),
):
    database = request.app.state.database
    existing = await database.categories.find_one({"_id": category_name})
    if existing is None:
        await _audit(
            database,
            request,
            admin,
            action="DELETE",
            description=f"Failed to delete category {category_name}: not found.",
            target_record_id=category_name,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )

    product_count = await count_products_using_category(database, category_name)
    if product_count > 0:
        await _audit(
            database,
            request,
            admin,
            action="DELETE",
            description=(
                f"Failed to delete category {category_name}: "
                f"used by {product_count} products."
            ),
            target_record_id=category_name,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cannot delete a category assigned to {product_count} products."
            ),
        )

    await database.categories.delete_one({"_id": category_name})
    await _audit(
        database,
        request,
        admin,
        action="DELETE",
        description=f"Deleted category {category_name}.",
        target_record_id=category_name,
    )
    return None
