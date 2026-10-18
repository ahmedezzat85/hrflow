"""
be/finance/repositories/products_repository.py
SQLAlchemy-backed repository for the product catalog (X3, D-030).
"""
from typing import List, Optional
from sqlalchemy.orm import Session, joinedload

from finance.models import ProductDB


class ProductsRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_all(self, is_active: Optional[bool] = None) -> List[ProductDB]:
        q = self.db.query(ProductDB).options(joinedload(ProductDB.default_receiving_account))
        if is_active is not None:
            q = q.filter(ProductDB.is_active == is_active)
        return q.order_by(ProductDB.name.asc(), ProductDB.id.asc()).all()

    def get_by_id(self, product_id: int) -> Optional[ProductDB]:
        return self.db.query(ProductDB).filter(ProductDB.id == product_id).first()

    def get_by_code(self, code: str) -> Optional[ProductDB]:
        return self.db.query(ProductDB).filter(ProductDB.code == code.strip().upper()).first()

    def create(self, data: dict, created_by: Optional[str] = None) -> ProductDB:
        p = ProductDB(
            name=data["name"].strip(),
            code=data["code"].strip().upper(),
            product_type=data.get("product_type") or "other",
            default_currency=(data.get("default_currency") or "USD").upper(),
            default_price=data.get("default_price"),
            default_receiving_account_id=data.get("default_receiving_account_id"),
            is_active=bool(data.get("is_active", True)),
            created_by=created_by,
        )
        self.db.add(p)
        self.db.commit()
        self.db.refresh(p)
        return p

    def update(self, product_id: int, data: dict) -> Optional[ProductDB]:
        p = self.get_by_id(product_id)
        if not p:
            return None
        for key in ("name", "product_type", "default_price", "default_receiving_account_id", "is_active"):
            if key in data:
                setattr(p, key, data[key].strip() if key == "name" and data[key] else data[key])
        if data.get("code"):
            p.code = data["code"].strip().upper()
        if data.get("default_currency"):
            p.default_currency = data["default_currency"].upper()
        self.db.commit()
        self.db.refresh(p)
        return p
