"""
be/finance/routers/categories.py
Router for Transaction Categories (Phase 0).
Full CRUD (with deactivation for delete) gated with RBAC:
- finance.account.read (list, get)
- finance.account.write (create, update, deactivate)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import CategoryCreate, CategoryUpdate, CategoryResponse
from finance.services.categories_service import CategoriesService
from finance.deps import get_categories_service

router = APIRouter(prefix="/api/finance/categories", tags=["Finance - Transaction Categories"])


@router.get("", response_model=List[CategoryResponse])
def list_categories(
    kind: Optional[str] = Query(None, description="Filter by category kind"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: CategoriesService = Depends(get_categories_service),
):
    """Lists transaction categories."""
    return service.list_categories(kind=kind, is_active=is_active)


@router.get("/{category_id}", response_model=CategoryResponse)
def get_category(
    category_id: int,
    current_user: dict = Depends(require_permission("finance.account.read")),
    service: CategoriesService = Depends(get_categories_service),
):
    """Fetches a specific category by ID."""
    return service.get_category(category_id)


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: CategoriesService = Depends(get_categories_service),
):
    """Creates a new transaction category."""
    return service.create_category(payload)


@router.patch("/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: CategoriesService = Depends(get_categories_service),
):
    """Updates an existing category (e.g. rename, sort_order, is_petty, is_active)."""
    return service.update_category(category_id, payload)


@router.delete("/{category_id}", response_model=CategoryResponse)
def deactivate_category(
    category_id: int,
    current_user: dict = Depends(require_permission("finance.account.write")),
    service: CategoriesService = Depends(get_categories_service),
):
    """Deactivates a category (soft-delete)."""
    return service.deactivate_category(category_id)
