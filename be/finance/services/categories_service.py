"""
be/finance/services/categories_service.py
Business logic and validation for Transaction Categories.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.categories_repository import CategoriesRepository
from finance.schemas import CategoryCreate, CategoryUpdate, CategoryResponse
from finance.models import TransactionCategoryDB


class CategoriesService:
    def __init__(self, repo: CategoriesRepository):
        self.repo = repo

    def to_response(self, cat: TransactionCategoryDB) -> CategoryResponse:
        return CategoryResponse(
            id=cat.id,
            name=cat.name,
            kind=cat.kind,
            is_active=cat.is_active,
            sort_order=cat.sort_order,
            is_petty=cat.is_petty,
            created_at=cat.created_at,
        )

    def list_categories(
        self,
        kind: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> List[CategoryResponse]:
        cats = self.repo.list_all(kind=kind, is_active=is_active)
        return [self.to_response(c) for c in cats]

    def get_category(self, category_id: int) -> CategoryResponse:
        cat = self.repo.get_by_id(category_id)
        if not cat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with ID {category_id} not found",
            )
        return self.to_response(cat)

    def create_category(self, payload: CategoryCreate) -> CategoryResponse:
        existing = self.repo.get_by_name(payload.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A category with name '{payload.name}' already exists",
            )
        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        cat = self.repo.create(data)
        return self.to_response(cat)

    def update_category(self, category_id: int, payload: CategoryUpdate) -> CategoryResponse:
        cat = self.repo.get_by_id(category_id)
        if not cat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with ID {category_id} not found",
            )
        if payload.name and payload.name.lower() != cat.name.lower():
            clash = self.repo.get_by_name(payload.name)
            if clash and clash.id != category_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"A category with name '{payload.name}' already exists",
                )
        data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        updated = self.repo.update(category_id, data)
        return self.to_response(updated)

    def deactivate_category(self, category_id: int) -> CategoryResponse:
        cat = self.repo.get_by_id(category_id)
        if not cat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with ID {category_id} not found",
            )
        deactivated = self.repo.deactivate(category_id)
        return self.to_response(deactivated)
