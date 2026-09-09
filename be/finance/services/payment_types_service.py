"""
be/finance/services/payment_types_service.py
Business logic and validation for Payment Types.
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.payment_types_repository import PaymentTypesRepository
from finance.schemas import PaymentTypeCreate, PaymentTypeUpdate, PaymentTypeResponse
from finance.models import PaymentTypeDB


class PaymentTypesService:
    def __init__(self, repo: PaymentTypesRepository):
        self.repo = repo

    def to_response(self, pt: PaymentTypeDB) -> PaymentTypeResponse:
        return PaymentTypeResponse(
            id=pt.id,
            name=pt.name,
            code=pt.code,
            requires_cheque_number=pt.requires_cheque_number,
            requires_bank_fee_flag=pt.requires_bank_fee_flag,
            is_active=pt.is_active,
            created_at=pt.created_at,
        )

    def list_payment_types(
        self,
        is_active: Optional[bool] = None,
    ) -> List[PaymentTypeResponse]:
        pts = self.repo.list_all(is_active=is_active)
        return [self.to_response(p) for p in pts]

    def get_payment_type(self, pt_id: int) -> PaymentTypeResponse:
        pt = self.repo.get_by_id(pt_id)
        if not pt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment type with ID {pt_id} not found",
            )
        return self.to_response(pt)

    def create_payment_type(self, payload: PaymentTypeCreate) -> PaymentTypeResponse:
        code_upper = payload.code.strip().upper()
        existing = self.repo.get_by_code(code_upper)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A payment type with code '{code_upper}' already exists",
            )
        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["code"] = code_upper
        pt = self.repo.create(data)
        return self.to_response(pt)

    def update_payment_type(self, pt_id: int, payload: PaymentTypeUpdate) -> PaymentTypeResponse:
        pt = self.repo.get_by_id(pt_id)
        if not pt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment type with ID {pt_id} not found",
            )
        data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        updated = self.repo.update(pt_id, data)
        return self.to_response(updated)

    def deactivate_payment_type(self, pt_id: int) -> PaymentTypeResponse:
        pt = self.repo.get_by_id(pt_id)
        if not pt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment type with ID {pt_id} not found",
            )
        deactivated = self.repo.deactivate(pt_id)
        return self.to_response(deactivated)
