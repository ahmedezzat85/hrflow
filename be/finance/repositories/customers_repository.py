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
            contact_email=data.get("contact_email", "").strip() if data.get("contact_email") else None,
            contact_phone=data.get("contact_phone", "").strip() if data.get("contact_phone") else None,
            tax_id=data.get("tax_id", "").strip() if data.get("tax_id") else None,
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
        if "contact_email" in data:
            customer.contact_email = data["contact_email"].strip() if data["contact_email"] else None
        if "contact_phone" in data:
            customer.contact_phone = data["contact_phone"].strip() if data["contact_phone"] else None
        if "tax_id" in data:
            customer.tax_id = data["tax_id"].strip() if data["tax_id"] else None
        if "notes" in data:
            customer.notes = data["notes"].strip() if data["notes"] else None
        if "is_active" in data and data["is_active"] is not None:
            customer.is_active = bool(data["is_active"])

        self.db.commit()
        self.db.refresh(customer)
        return customer

    def soft_delete(self, customer_id: int) -> Optional[CustomerDB]:
        return self.update(customer_id, {"is_active": False})
