"""
be/finance/services/vendors_service.py
Business logic and validation for Finance Vendors.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.vendors_repository import VendorsRepository
from finance.schemas import VendorCreate, VendorUpdate, VendorResponse
from finance.models import VendorDB


class VendorsService:
    def __init__(self, repo: VendorsRepository):
        self.repo = repo

    def to_response(self, vendor: VendorDB) -> VendorResponse:
        return VendorResponse(
            id=vendor.id,
            name=vendor.name,
            contact_email=vendor.contact_email,
            contact_phone=vendor.contact_phone,
            tax_id=vendor.tax_id,
            category=vendor.category,
            notes=vendor.notes,
            is_active=vendor.is_active,
            created_at=vendor.created_at,
        )

    def list_vendors(
        self,
        is_active: Optional[bool] = None,
        category: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[VendorResponse]:
        vendors = self.repo.list_all(is_active=is_active, category=category, search=search, limit=limit, offset=offset)
        return [self.to_response(v) for v in vendors]

    def get_vendor(self, vendor_id: int) -> VendorResponse:
        vendor = self.repo.get_by_id(vendor_id)
        if not vendor:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Vendor with ID {vendor_id} not found",
            )
        return self.to_response(vendor)

    def create_vendor(self, payload: VendorCreate) -> VendorResponse:
        existing = self.repo.get_by_name(payload.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A vendor with name '{payload.name}' already exists",
            )
        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        created = self.repo.create(data)
        return self.to_response(created)

    def update_vendor(self, vendor_id: int, payload: VendorUpdate) -> VendorResponse:
        vendor = self.repo.get_by_id(vendor_id)
        if not vendor:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Vendor with ID {vendor_id} not found",
            )

        if payload.name and payload.name.strip().lower() != vendor.name.lower():
            existing = self.repo.get_by_name(payload.name)
            if existing and existing.id != vendor_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"A vendor with name '{payload.name}' already exists",
                )

        data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        updated = self.repo.update(vendor_id, data)
        return self.to_response(updated)

    def soft_delete_vendor(self, vendor_id: int) -> VendorResponse:
        vendor = self.repo.get_by_id(vendor_id)
        if not vendor:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Vendor with ID {vendor_id} not found",
            )
        deactivated = self.repo.soft_delete(vendor_id)
        return self.to_response(deactivated)
