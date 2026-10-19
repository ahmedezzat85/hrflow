"""
be/finance/services/products_service.py
Business logic for the product catalog (X3, D-030).
"""
from typing import List, Optional
from fastapi import HTTPException

from finance.models import ProductDB, FinanceBankAccountDB
from finance.repositories.products_repository import ProductsRepository
from finance.schemas import PRODUCT_TYPES, ProductCreate, ProductUpdate, ProductResponse


class ProductsService:
    def __init__(self, repo: ProductsRepository):
        self.repo = repo

    @staticmethod
    def _to_response(p: ProductDB) -> ProductResponse:
        acc = p.default_receiving_account
        return ProductResponse(
            id=p.id,
            name=p.name,
            code=p.code,
            product_type=p.product_type,
            default_currency=p.default_currency,
            default_price=p.default_price,
            default_receiving_account_id=p.default_receiving_account_id,
            default_receiving_account_name=acc.account_name if acc else None,
            is_active=p.is_active,
            created_at=p.created_at,
        )

    def _validate(self, data: dict) -> None:
        if data.get("product_type") is not None and data["product_type"] not in PRODUCT_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid product_type. Must be one of: {', '.join(PRODUCT_TYPES)}")
        acc_id = data.get("default_receiving_account_id")
        if acc_id:
            acc = self.repo.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == acc_id).first()
            if not acc:
                raise HTTPException(status_code=404, detail=f"Receiving account {acc_id} not found")
            currency = (data.get("default_currency") or "").upper()
            if currency and (acc.currency or "").upper() != currency:
                raise HTTPException(status_code=400, detail={
                    "code": "currency_mismatch",
                    "message": f"The default receiving account is in {acc.currency}, but the product currency is {currency}.",
                })

    def list_products(self, is_active: Optional[bool] = None) -> List[ProductResponse]:
        return [self._to_response(p) for p in self.repo.list_all(is_active=is_active)]

    def get_product(self, product_id: int) -> ProductResponse:
        p = self.repo.get_by_id(product_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
        return self._to_response(p)

    def create_product(self, payload: ProductCreate, created_by: Optional[str] = None) -> ProductResponse:
        data = payload.model_dump()
        self._validate(data)
        if self.repo.get_by_code(data["code"]):
            raise HTTPException(status_code=400, detail=f"Product code '{data['code'].strip().upper()}' already exists")
        return self._to_response(self.repo.create(data, created_by=created_by))

    def update_product(self, product_id: int, payload: ProductUpdate) -> ProductResponse:
        current = self.repo.get_by_id(product_id)
        if not current:
            raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
        data = payload.model_dump(exclude_unset=True)
        eff_acc = data.get("default_receiving_account_id", current.default_receiving_account_id)
        eff_cur = data.get("default_currency") or current.default_currency
        self._validate({"product_type": data.get("product_type"), "default_currency": eff_cur, "default_receiving_account_id": eff_acc})
        if data.get("code"):
            other = self.repo.get_by_code(data["code"])
            if other and other.id != product_id:
                raise HTTPException(status_code=400, detail=f"Product code '{data['code'].strip().upper()}' already exists")
        return self._to_response(self.repo.update(product_id, data))
