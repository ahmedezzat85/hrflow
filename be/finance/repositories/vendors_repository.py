"""
be/finance/repositories/vendors_repository.py
SQLAlchemy-backed repository for finance vendors.
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from finance.models import VendorDB


class VendorsRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_all(
        self,
        is_active: Optional[bool] = None,
        category: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[VendorDB]:
        query = self.db.query(VendorDB)
        if is_active is not None:
            query = query.filter(VendorDB.is_active == is_active)
        if category:
            query = query.filter(VendorDB.category == category.strip())
        if search:
            s = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    VendorDB.name.ilike(s),
                    VendorDB.contact_email.ilike(s),
                    VendorDB.category.ilike(s),
                    VendorDB.tax_id.ilike(s),
                )
            )
        return query.order_by(VendorDB.name.asc()).offset(offset).limit(limit).all()

    def get_by_id(self, vendor_id: int) -> Optional[VendorDB]:
        return self.db.query(VendorDB).filter(VendorDB.id == vendor_id).first()

    def get_by_name(self, name: str) -> Optional[VendorDB]:
        return self.db.query(VendorDB).filter(VendorDB.name.ilike(name.strip())).first()

    def create(self, data: dict) -> VendorDB:
        vendor = VendorDB(
            name=data["name"].strip(),
            contact_email=data.get("contact_email", "").strip() if data.get("contact_email") else None,
            contact_phone=data.get("contact_phone", "").strip() if data.get("contact_phone") else None,
            tax_id=data.get("tax_id", "").strip() if data.get("tax_id") else None,
            category=data.get("category", "General").strip() if data.get("category") else "General",
            notes=data.get("notes", "").strip() if data.get("notes") else None,
            is_active=bool(data.get("is_active", True)),
        )
        self.db.add(vendor)
        self.db.commit()
        self.db.refresh(vendor)
        return vendor

    def update(self, vendor_id: int, data: dict) -> Optional[VendorDB]:
        vendor = self.get_by_id(vendor_id)
        if not vendor:
            return None

        if "name" in data and data["name"] is not None:
            vendor.name = data["name"].strip()
        if "contact_email" in data:
            vendor.contact_email = data["contact_email"].strip() if data["contact_email"] else None
        if "contact_phone" in data:
            vendor.contact_phone = data["contact_phone"].strip() if data["contact_phone"] else None
        if "tax_id" in data:
            vendor.tax_id = data["tax_id"].strip() if data["tax_id"] else None
        if "category" in data and data["category"] is not None:
            vendor.category = data["category"].strip()
        if "notes" in data:
            vendor.notes = data["notes"].strip() if data["notes"] else None
        if "is_active" in data and data["is_active"] is not None:
            vendor.is_active = bool(data["is_active"])

        self.db.commit()
        self.db.refresh(vendor)
        return vendor

    def soft_delete(self, vendor_id: int) -> Optional[VendorDB]:
        return self.update(vendor_id, {"is_active": False})
