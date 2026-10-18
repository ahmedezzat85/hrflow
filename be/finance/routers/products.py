"""
be/finance/routers/products.py
Router for the product catalog (X3, D-030).
- finance.product.read (list, get); finance.invoice.write may also list, to fill the invoice line product picker
- finance.product.write (create, update, deactivate)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.permissions import AccessContext, get_access_context, require_permission
from finance.schemas import ProductCreate, ProductUpdate, ProductResponse
from finance.services.products_service import ProductsService
from finance.deps import get_products_service

router = APIRouter(prefix="/api/finance/products", tags=["Finance - Products"])


def _products_read_guard(access: AccessContext = Depends(get_access_context)) -> AccessContext:
    perms = access.permissions
    if access.is_super_admin or "finance.product.read" in perms or "finance.invoice.write" in perms:
        return access
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: 'finance.product.read' required")


_products_read_guard.hrflow_permission = "finance.product.read"


@router.get("", response_model=List[ProductResponse])
def list_products(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    access: AccessContext = Depends(_products_read_guard),
    service: ProductsService = Depends(get_products_service),
):
    return service.list_products(is_active=is_active)


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: int,
    access: AccessContext = Depends(_products_read_guard),
    service: ProductsService = Depends(get_products_service),
):
    return service.get_product(product_id)


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    current_user: dict = Depends(require_permission("finance.product.write")),
    service: ProductsService = Depends(get_products_service),
):
    user_email = (current_user.get("email") or current_user.get("sub")) if isinstance(current_user, dict) else "user"
    return service.create_product(payload, created_by=user_email)


@router.patch("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    current_user: dict = Depends(require_permission("finance.product.write")),
    service: ProductsService = Depends(get_products_service),
):
    """Updates a product. Deactivate with is_active=false; products are never deleted (invoice lines keep the link)."""
    return service.update_product(product_id, payload)
