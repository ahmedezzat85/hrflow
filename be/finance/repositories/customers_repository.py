"""
be/finance/repositories/customers_repository.py
SQLAlchemy-backed repository for finance customers.
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from finance.models import CustomerDB


class CustomersRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_all(
        self,
        is_active: Optional[bool] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[CustomerDB]:
        query = self.db.query(CustomerDB)
        if is_active is not None:
            query = query.filter(CustomerDB.is_active == is_active)
        if search:
            s = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    CustomerDB.name.ilike(s),
                    CustomerDB.contact_email.ilike(s),
                    CustomerDB.tax_id.ilike(s),
                )
            )
        return query.order_by(CustomerDB.name.asc()).offset(offset).limit(limit).all()

    def get_by_id(self, customer_id: int) -> Optional[CustomerDB]:
        return self.db.query(CustomerDB).filter(CustomerDB.id == customer_id).first()

    def get_by_name(self, name: str) -> Optional[CustomerDB]:
        return self.db.query(CustomerDB).filter(CustomerDB.name.ilike(name.strip())).first()

    def create(self, data: dict) -> CustomerDB:
        customer = CustomerDB(
            name=data["name"].strip(),
            legal_name=data.get("legal_name", "").strip() if data.get("legal_name") else None,
            contact_email=data.get("contact_email", "").strip() if data.get("contact_email") else None,
            contact_phone=data.get("contact_phone", "").strip() if data.get("contact_phone") else None,
            tax_id=data.get("tax_id", "").strip() if data.get("tax_id") else None,
            billing_address=data.get("billing_address", "").strip() if data.get("billing_address") else None,
            country=data.get("country", "Egypt").strip() if data.get("country") else "Egypt",
            default_currency=data.get("default_currency", "USD").strip() if data.get("default_currency") else "USD",
            payment_terms_days=int(data.get("payment_terms_days", 30)) if data.get("payment_terms_days") is not None else 30,
            owner=data.get("owner", "").strip() if data.get("owner") else None,
            notes=data.get("notes", "").strip() if data.get("notes") else None,
            is_active=bool(data.get("is_active", True)),
        )
        self.db.add(customer)
        self.db.commit()
        self.db.refresh(customer)
        return customer

    def update(self, customer_id: int, data: dict) -> Optional[CustomerDB]:
        customer = self.get_by_id(customer_id)
        if not customer:
            return None

        if "name" in data and data["name"] is not None:
            customer.name = data["name"].strip()
        if "legal_name" in data:
            customer.legal_name = data["legal_name"].strip() if data["legal_name"] else None
        if "contact_email" in data:
            customer.contact_email = data["contact_email"].strip() if data["contact_email"] else None
        if "contact_phone" in data:
            customer.contact_phone = data["contact_phone"].strip() if data["contact_phone"] else None
        if "tax_id" in data:
            customer.tax_id = data["tax_id"].strip() if data["tax_id"] else None
        if "billing_address" in data:
            customer.billing_address = data["billing_address"].strip() if data["billing_address"] else None
        if "country" in data and data["country"] is not None:
            customer.country = data["country"].strip()
        if "default_currency" in data and data["default_currency"] is not None:
            customer.default_currency = data["default_currency"].strip()
        if "payment_terms_days" in data and data["payment_terms_days"] is not None:
            customer.payment_terms_days = int(data["payment_terms_days"])
        if "owner" in data:
            customer.owner = data["owner"].strip() if data["owner"] else None
        if "notes" in data:
            customer.notes = data["notes"].strip() if data["notes"] else None
        if "is_active" in data and data["is_active"] is not None:
            customer.is_active = bool(data["is_active"])

        self.db.commit()
        self.db.refresh(customer)
        return customer

    def soft_delete(self, customer_id: int) -> Optional[CustomerDB]:
        return self.update(customer_id, {"is_active": False})

    def find_duplicate_candidates(
        self,
        name: Optional[str] = None,
        legal_name: Optional[str] = None,
        tax_id: Optional[str] = None,
        contact_email: Optional[str] = None,
        exclude_id: Optional[int] = None,
    ) -> List[dict]:
        import re

        def _clean_str(v: Optional[str]) -> str:
            if not v:
                return ""
            s = v.lower().strip()
            for sfx in [r"\binc\b", r"\bllc\b", r"\bcorp\b", r"\bcorporation\b", r"\bltd\b", r"\blimited\b", r"\bco\b", r"\bpartners\b"]:
                s = re.sub(sfx, "", s)
            return re.sub(r"[^a-z0-9]", "", s)

        def _clean_tax(v: Optional[str]) -> str:
            if not v:
                return ""
            return re.sub(r"[^a-z0-9]", "", v.lower().strip())

        norm_name = _clean_str(name)
        norm_legal = _clean_str(legal_name)
        norm_tax = _clean_tax(tax_id)
        norm_email = (contact_email or "").lower().strip()

        all_customers = self.db.query(CustomerDB).all()
        candidates = []
        seen_ids = set()

        for c in all_customers:
            if exclude_id and c.id == exclude_id:
                continue

            c_name = _clean_str(c.name)
            c_legal = _clean_str(c.legal_name)
            c_tax = _clean_tax(c.tax_id)
            c_email = (c.contact_email or "").lower().strip()

            matched_field = None
            if norm_name and (norm_name == c_name or (c_legal and norm_name == c_legal)):
                matched_field = "name"
            elif norm_legal and ((c_legal and norm_legal == c_legal) or norm_legal == c_name):
                matched_field = "legal_name"
            elif norm_tax and c_tax and norm_tax == c_tax:
                matched_field = "tax_id"
            elif norm_email and c_email and norm_email == c_email:
                matched_field = "contact_email"

            if matched_field and c.id not in seen_ids:
                seen_ids.add(c.id)
                candidates.append({
                    "id": c.id,
                    "name": c.name,
                    "legal_name": c.legal_name,
                    "tax_id": c.tax_id,
                    "contact_email": c.contact_email,
                    "matched_field": matched_field,
                    "is_active": c.is_active,
                })

        return candidates
