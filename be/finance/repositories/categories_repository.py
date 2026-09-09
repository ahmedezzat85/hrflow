"""
be/finance/repositories/categories_repository.py
SQLAlchemy-backed repository for Transaction Categories (Phase 0).
"""
from typing import List, Optional
from sqlalchemy.orm import Session

from finance.models import TransactionCategoryDB


class CategoriesRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_all(
        self,
        kind: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> List[TransactionCategoryDB]:
        query = self.db.query(TransactionCategoryDB)
        if kind is not None:
            query = query.filter(TransactionCategoryDB.kind == kind)
        if is_active is not None:
            query = query.filter(TransactionCategoryDB.is_active == is_active)
        return query.order_by(TransactionCategoryDB.sort_order.asc(), TransactionCategoryDB.name.asc()).all()

    def get_by_id(self, category_id: int) -> Optional[TransactionCategoryDB]:
        return self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.id == category_id).first()

    def get_by_name(self, name: str) -> Optional[TransactionCategoryDB]:
        return self.db.query(TransactionCategoryDB).filter(
            TransactionCategoryDB.name.ilike(name.strip())
        ).first()

    def create(self, data: dict) -> TransactionCategoryDB:
        category = TransactionCategoryDB(
            name=data["name"].strip(),
            kind=data.get("kind", "other"),
            is_active=bool(data.get("is_active", True)),
            sort_order=int(data.get("sort_order", 0)),
            is_petty=bool(data.get("is_petty", False)),
        )
        self.db.add(category)
        self.db.commit()
        self.db.refresh(category)
        return category

    def update(self, category_id: int, data: dict) -> Optional[TransactionCategoryDB]:
        cat = self.get_by_id(category_id)
        if not cat:
            return None

        if "name" in data and data["name"] is not None:
            cat.name = data["name"].strip()
        if "kind" in data and data["kind"] is not None:
            cat.kind = data["kind"]
        if "is_active" in data and data["is_active"] is not None:
            cat.is_active = bool(data["is_active"])
        if "sort_order" in data and data["sort_order"] is not None:
            cat.sort_order = int(data["sort_order"])
        if "is_petty" in data and data["is_petty"] is not None:
            cat.is_petty = bool(data["is_petty"])

        self.db.commit()
        self.db.refresh(cat)
        return cat

    def deactivate(self, category_id: int) -> Optional[TransactionCategoryDB]:
        return self.update(category_id, {"is_active": False})
