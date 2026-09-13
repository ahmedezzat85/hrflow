"""
be/finance/routers/vendors.py
Production router for Finance Vendors.
Full CRUD wired to VendorsService and gated with RBAC permissions:
- finance.vendor.read (list, get)
- finance.vendor.write (create, update, deactivate)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status

from core.permissions import require_permission
from finance.schemas import (
    VendorCreate,
    VendorUpdate,
    VendorResponse,
)
from finance.services.vendors_service import VendorsService
from finance.deps import get_vendors_service

router = APIRouter(prefix="/api/finance/vendors", tags=["Finance - Vendors"])


@router.get("", response_model=List[VendorResponse])
def list_vendors(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    category: Optional[str] = Query(None, description="Filter by category"),
    search: Optional[str] = Query(None, description="Search by name, email, category, or tax ID"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Lists finance vendors."""
    return service.list_vendors(is_active=is_active, category=category, search=search, limit=limit, offset=offset)


@router.get("/{vendor_id}", response_model=VendorResponse)
def get_vendor(
    vendor_id: int,
    current_user: dict = Depends(require_permission("finance.vendor.read")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Fetches a specific vendor by ID."""
    return service.get_vendor(vendor_id)


@router.post("", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
def create_vendor(
    payload: VendorCreate,
    current_user: dict = Depends(require_permission("finance.vendor.write")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Creates a new vendor."""
    return service.create_vendor(payload)


@router.put("/{vendor_id}", response_model=VendorResponse)
def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    current_user: dict = Depends(require_permission("finance.vendor.write")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Updates an existing vendor."""
    return service.update_vendor(vendor_id, payload)


@router.delete("/{vendor_id}", response_model=VendorResponse)
def deactivate_vendor(
    vendor_id: int,
    current_user: dict = Depends(require_permission("finance.vendor.write")),
    service: VendorsService = Depends(get_vendors_service),
):
    """Deactivates (soft-deletes) an existing vendor."""
    return service.soft_delete_vendor(vendor_id)
