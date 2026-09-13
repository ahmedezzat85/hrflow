"""
be/finance/services/vendors_service.py
Business logic and validation for Finance Vendors.
"""
from datetime import datetime
from typing import List, Optional
from fastapi import HTTPException, status

from models_db import AuditLogDB
from finance.repositories.vendors_repository import VendorsRepository
from finance.schemas import (
    VendorCreate,
    VendorUpdate,
    VendorResponse,
    VendorPaymentInstructionCreate,
    VendorPaymentInstructionUpdate,
    VendorPaymentInstructionResponse,
    VendorPaymentInstructionVerifyRequest,
    VendorDuplicateCheckRequest,
    VendorDuplicateCandidate,
    VendorSpendMetric,
    Vendor360Response,
)
from finance.models import VendorDB, VendorPaymentInstructionDB


def _mask_account(acc: str) -> str:
    if not acc:
        return ""
    if len(acc) <= 4:
        return "******"
    return "*" * (len(acc) - 4) + acc[-4:]


def _mask_iban(iban: Optional[str]) -> Optional[str]:
    if not iban:
        return None
    if len(iban) <= 8:
        return "******"
    return f"{iban[:4]}******{iban[-4:]}"


class VendorsService:
    def __init__(self, repo: VendorsRepository):
        self.repo = repo

    def to_response(self, vendor: VendorDB) -> VendorResponse:
        return VendorResponse(
            id=vendor.id,
            name=vendor.name,
            legal_name=vendor.legal_name,
            contact_name=vendor.contact_name,
            contact_email=vendor.contact_email,
            contact_phone=vendor.contact_phone,
            tax_id=vendor.tax_id,
            remit_address=vendor.remit_address,
            country=vendor.country,
            payment_terms_days=vendor.payment_terms_days,
            default_currency=vendor.default_currency,
            category=vendor.category,
            default_department=vendor.default_department,
            tax_treatment=vendor.tax_treatment,
            withholding_tax_rate=vendor.withholding_tax_rate,
            onboarding_status=vendor.onboarding_status,
            notes=vendor.notes,
            is_active=vendor.is_active,
            created_at=vendor.created_at,
        )

    def to_instruction_response(
        self, instr: VendorPaymentInstructionDB, reveal: bool = False
    ) -> VendorPaymentInstructionResponse:
        acc = instr.account_number if reveal else _mask_account(instr.account_number)
        iban = instr.iban if reveal else _mask_iban(instr.iban)
        routing = (
            instr.routing_number
            if reveal
            else (f"***{instr.routing_number[-3:]}" if instr.routing_number and len(instr.routing_number) > 3 else (instr.routing_number and "***"))
        )

        return VendorPaymentInstructionResponse(
            id=instr.id,
            vendor_id=instr.vendor_id,
            payment_method=instr.payment_method,
            bank_name=instr.bank_name,
            account_holder_name=instr.account_holder_name,
            account_number=acc,
            routing_number=routing,
            swift_code=instr.swift_code,
            iban=iban,
            verification_status=instr.verification_status,
            verified_by=instr.verified_by,
            verified_at=instr.verified_at,
            is_active=instr.is_active,
            effective_date=instr.effective_date,
            notes=instr.notes,
            created_at=instr.created_at,
            updated_at=instr.updated_at,
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

    def check_duplicates(self, payload: VendorDuplicateCheckRequest) -> List[VendorDuplicateCandidate]:
        candidates = self.repo.check_duplicate(
            name=payload.name,
            tax_id=payload.tax_id,
            contact_email=payload.contact_email,
            exclude_id=payload.exclude_id,
        )
        return [VendorDuplicateCandidate(**c) for c in candidates]

    # ==========================================
    # Payment Instructions
    # ==========================================
    def list_payment_instructions(
        self, vendor_id: int, reveal: bool = False
    ) -> List[VendorPaymentInstructionResponse]:
        vendor = self.repo.get_by_id(vendor_id)
        if not vendor:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Vendor {vendor_id} not found")

        instructions = self.repo.list_payment_instructions(vendor_id)
        return [self.to_instruction_response(i, reveal=reveal) for i in instructions]

    def create_payment_instruction(
        self, vendor_id: int, payload: VendorPaymentInstructionCreate, current_user_email: str
    ) -> VendorPaymentInstructionResponse:
        vendor = self.repo.get_by_id(vendor_id)
        if not vendor:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Vendor {vendor_id} not found")

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        instr = self.repo.create_payment_instruction(vendor_id, data)

        # Audit log entry
        audit = AuditLogDB(
            timestamp=datetime.utcnow().isoformat(),
            actor_email=current_user_email,
            action="vendor_payment_instruction_created",
            target_type="vendor_payment_instruction",
            target_id=str(instr.id),
            details=f"Created payment instruction for vendor {vendor.name} (Method: {instr.payment_method}, Acct: {_mask_account(instr.account_number)})",
        )
        self.repo.db.add(audit)
        self.repo.db.commit()

        return self.to_instruction_response(instr, reveal=False)

    def update_payment_instruction(
        self, vendor_id: int, instruction_id: int, payload: VendorPaymentInstructionUpdate, current_user_email: str
    ) -> VendorPaymentInstructionResponse:
        instr = self.repo.get_payment_instruction(instruction_id)
        if not instr or instr.vendor_id != vendor_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment instruction {instruction_id} not found for vendor {vendor_id}",
            )

        data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        updated = self.repo.update_payment_instruction(instruction_id, data)

        # Audit log entry
        audit = AuditLogDB(
            timestamp=datetime.utcnow().isoformat(),
            actor_email=current_user_email,
            action="vendor_payment_instruction_updated",
            target_type="vendor_payment_instruction",
            target_id=str(instruction_id),
            details=f"Updated payment instruction {instruction_id} for vendor {vendor_id}. Verification reset to unverified.",
        )
        self.repo.db.add(audit)
        self.repo.db.commit()

        return self.to_instruction_response(updated, reveal=False)

    def verify_payment_instruction(
        self,
        vendor_id: int,
        instruction_id: int,
        payload: VendorPaymentInstructionVerifyRequest,
        current_user_email: str,
    ) -> VendorPaymentInstructionResponse:
        instr = self.repo.get_payment_instruction(instruction_id)
        if not instr or instr.vendor_id != vendor_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payment instruction {instruction_id} not found for vendor {vendor_id}",
            )

        decision = payload.decision.lower().strip()
        if decision not in ("verified", "rejected"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Decision must be 'verified' or 'rejected'",
            )

        verified = self.repo.verify_payment_instruction(
            instruction_id, decision=decision, verified_by=current_user_email, comment=payload.comment
        )

        audit = AuditLogDB(
            timestamp=datetime.utcnow().isoformat(),
            actor_email=current_user_email,
            action=f"vendor_payment_instruction_{decision}",
            target_type="vendor_payment_instruction",
            target_id=str(instruction_id),
            details=f"Payment instruction {instruction_id} marked as {decision} by {current_user_email}. Comment: {payload.comment or 'None'}",
        )
        self.repo.db.add(audit)
        self.repo.db.commit()

        return self.to_instruction_response(verified, reveal=False)

    # ==========================================
    # Vendor 360 Profile
    # ==========================================
    def get_vendor_360(self, vendor_id: int, reveal: bool = False) -> Vendor360Response:
        vendor = self.repo.get_by_id(vendor_id)
        if not vendor:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Vendor {vendor_id} not found")

        instructions = self.repo.list_payment_instructions(vendor_id)
        metrics = self.repo.get_vendor_metrics(vendor_id)

        recent_bills = [
            {
                "id": b.id,
                "bill_number": b.bill_number,
                "issue_date": b.issue_date,
                "due_date": b.due_date,
                "status": b.status,
                "total": b.total,
                "amount_paid": b.amount_paid or 0.0,
                "currency": b.currency,
            }
            for b in vendor.bills
            if b.status != "void"
        ]

        return Vendor360Response(
            vendor=self.to_response(vendor),
            payment_instructions=[self.to_instruction_response(i, reveal=reveal) for i in instructions],
            metrics=VendorSpendMetric(**metrics),
            recent_bills=recent_bills,
        )

