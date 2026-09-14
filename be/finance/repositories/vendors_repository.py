"""
be/finance/repositories/vendors_repository.py
SQLAlchemy-backed repository for finance vendors.
"""
import re
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_

from finance.models import (
    VendorDB,
    VendorPaymentInstructionDB,
    BillDB,
    PaymentDB,
    SubscriptionDB,
)


def _normalize_name(name: str) -> str:
    """Normalizes vendor name by removing common legal suffixes and punctuation."""
    if not name:
        return ""
    clean = re.sub(r"[^\w\s]", "", name.lower())
    for suffix in ["llc", "inc", "corp", "corporation", "ltd", "limited", "company", "co", "gmbh", "sae"]:
        clean = re.sub(rf"\b{suffix}\b", "", clean)
    return " ".join(clean.split())


def _normalize_tax_id(tax_id: str) -> str:
    """Strips punctuation/whitespace from tax identifiers."""
    if not tax_id:
        return ""
    return re.sub(r"[\W_]+", "", tax_id.lower())


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
                    VendorDB.legal_name.ilike(s),
                    VendorDB.contact_email.ilike(s),
                    VendorDB.contact_name.ilike(s),
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
            legal_name=data.get("legal_name", "").strip() if data.get("legal_name") else None,
            contact_name=data.get("contact_name", "").strip() if data.get("contact_name") else None,
            contact_email=data.get("contact_email", "").strip() if data.get("contact_email") else None,
            contact_phone=data.get("contact_phone", "").strip() if data.get("contact_phone") else None,
            tax_id=data.get("tax_id", "").strip() if data.get("tax_id") else None,
            remit_address=data.get("remit_address", "").strip() if data.get("remit_address") else None,
            country=data.get("country", "Egypt") or "Egypt",
            payment_terms_days=int(data.get("payment_terms_days", 30)),
            default_currency=data.get("default_currency", "EGP") or "EGP",
            category=data.get("category", "General").strip() if data.get("category") else "General",
            default_department=data.get("default_department", "").strip() if data.get("default_department") else None,
            tax_treatment=data.get("tax_treatment", "standard") or "standard",
            withholding_tax_rate=float(data.get("withholding_tax_rate", 0.0) or 0.0),
            onboarding_status=data.get("onboarding_status", "active") or "active",
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
        if "legal_name" in data:
            vendor.legal_name = data["legal_name"].strip() if data["legal_name"] else None
        if "contact_name" in data:
            vendor.contact_name = data["contact_name"].strip() if data["contact_name"] else None
        if "contact_email" in data:
            vendor.contact_email = data["contact_email"].strip() if data["contact_email"] else None
        if "contact_phone" in data:
            vendor.contact_phone = data["contact_phone"].strip() if data["contact_phone"] else None
        if "tax_id" in data:
            vendor.tax_id = data["tax_id"].strip() if data["tax_id"] else None
        if "remit_address" in data:
            vendor.remit_address = data["remit_address"].strip() if data["remit_address"] else None
        if "country" in data and data["country"] is not None:
            vendor.country = data["country"].strip()
        if "payment_terms_days" in data and data["payment_terms_days"] is not None:
            vendor.payment_terms_days = int(data["payment_terms_days"])
        if "default_currency" in data and data["default_currency"] is not None:
            vendor.default_currency = data["default_currency"].strip()
        if "category" in data and data["category"] is not None:
            vendor.category = data["category"].strip()
        if "default_department" in data:
            vendor.default_department = data["default_department"].strip() if data["default_department"] else None
        if "tax_treatment" in data and data["tax_treatment"] is not None:
            vendor.tax_treatment = data["tax_treatment"].strip()
        if "withholding_tax_rate" in data and data["withholding_tax_rate"] is not None:
            vendor.withholding_tax_rate = float(data["withholding_tax_rate"])
        if "onboarding_status" in data and data["onboarding_status"] is not None:
            vendor.onboarding_status = data["onboarding_status"].strip()
        if "notes" in data:
            vendor.notes = data["notes"].strip() if data["notes"] else None
        if "is_active" in data and data["is_active"] is not None:
            vendor.is_active = bool(data["is_active"])

        self.db.commit()
        self.db.refresh(vendor)
        return vendor

    def soft_delete(self, vendor_id: int) -> Optional[VendorDB]:
        return self.update(vendor_id, {"is_active": False})

    def check_duplicate(
        self,
        name: Optional[str] = None,
        tax_id: Optional[str] = None,
        contact_email: Optional[str] = None,
        exclude_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Matches vendor records by normalized name, tax ID, or contact email."""
        candidates = []
        all_vendors = self.db.query(VendorDB).all()
        norm_name = _normalize_name(name) if name else None
        norm_tax = _normalize_tax_id(tax_id) if tax_id else None
        norm_email = contact_email.strip().lower() if contact_email else None

        for v in all_vendors:
            if exclude_id and v.id == exclude_id:
                continue

            # 1. Name match
            if norm_name:
                v_norm = _normalize_name(v.name)
                v_legal = _normalize_name(v.legal_name or "")
                if (v_norm and norm_name == v_norm) or (v_legal and norm_name == v_legal):
                    candidates.append({
                        "id": v.id,
                        "name": v.name,
                        "tax_id": v.tax_id,
                        "contact_email": v.contact_email,
                        "matched_field": "name",
                        "matching_value": v.name,
                    })
                    continue

            # 2. Tax ID match
            if norm_tax and v.tax_id:
                if norm_tax == _normalize_tax_id(v.tax_id):
                    candidates.append({
                        "id": v.id,
                        "name": v.name,
                        "tax_id": v.tax_id,
                        "contact_email": v.contact_email,
                        "matched_field": "tax_id",
                        "matching_value": v.tax_id,
                    })
                    continue

            # 3. Contact Email match
            if norm_email and v.contact_email:
                if norm_email == v.contact_email.strip().lower():
                    candidates.append({
                        "id": v.id,
                        "name": v.name,
                        "tax_id": v.tax_id,
                        "contact_email": v.contact_email,
                        "matched_field": "contact_email",
                        "matching_value": v.contact_email,
                    })
                    continue

        return candidates

    # ==========================================
    # Payment Instructions
    # ==========================================
    def list_payment_instructions(
        self, vendor_id: int, is_active: Optional[bool] = None
    ) -> List[VendorPaymentInstructionDB]:
        query = self.db.query(VendorPaymentInstructionDB).filter(
            VendorPaymentInstructionDB.vendor_id == vendor_id
        )
        if is_active is not None:
            query = query.filter(VendorPaymentInstructionDB.is_active == is_active)
        return query.order_by(VendorPaymentInstructionDB.id.desc()).all()

    def get_payment_instruction(self, instruction_id: int) -> Optional[VendorPaymentInstructionDB]:
        return (
            self.db.query(VendorPaymentInstructionDB)
            .filter(VendorPaymentInstructionDB.id == instruction_id)
            .first()
        )

    def create_payment_instruction(self, vendor_id: int, data: dict) -> VendorPaymentInstructionDB:
        instr = VendorPaymentInstructionDB(
            vendor_id=vendor_id,
            payment_method=data.get("payment_method", "bank_transfer"),
            bank_name=data.get("bank_name"),
            account_holder_name=data.get("account_holder_name"),
            account_number=data["account_number"].strip(),
            routing_number=data.get("routing_number"),
            swift_code=data.get("swift_code"),
            iban=data.get("iban"),
            verification_status="unverified",
            is_active=bool(data.get("is_active", True)),
            effective_date=data.get("effective_date"),
            notes=data.get("notes"),
        )
        self.db.add(instr)
        self.db.commit()
        self.db.refresh(instr)
        return instr

    def update_payment_instruction(self, instruction_id: int, data: dict) -> Optional[VendorPaymentInstructionDB]:
        instr = self.get_payment_instruction(instruction_id)
        if not instr:
            return None

        for k in ["payment_method", "bank_name", "account_holder_name", "account_number", "routing_number", "swift_code", "iban", "effective_date", "notes", "is_active"]:
            if k in data and data[k] is not None:
                setattr(instr, k, data[k])

        # Sensitive change sets verification back to unverified
        instr.verification_status = "unverified"
        instr.verified_by = None
        instr.verified_at = None

        self.db.commit()
        self.db.refresh(instr)
        return instr

    def verify_payment_instruction(
        self, instruction_id: int, decision: str, verified_by: str, comment: Optional[str] = None
    ) -> Optional[VendorPaymentInstructionDB]:
        instr = self.get_payment_instruction(instruction_id)
        if not instr:
            return None

        instr.verification_status = "verified" if decision == "verified" else "rejected"
        instr.verified_by = verified_by
        instr.verified_at = datetime.utcnow()
        if comment:
            instr.notes = f"{instr.notes or ''}\n[Verification: {comment}]".strip()

        self.db.commit()
        self.db.refresh(instr)
        return instr

    # ==========================================
    # Spend Metrics
    # ==========================================
    def get_vendor_metrics(self, vendor_id: int) -> dict:
        bills = self.db.query(BillDB).filter(BillDB.vendor_id == vendor_id, BillDB.status != "void").all()
        bill_ids = [b.id for b in bills]

        open_statuses = {"ready_to_pay", "scheduled", "needs_approval", "inbox", "needs_coding", "unpaid", "partially_paid"}
        open_bills = [b for b in bills if b.status in open_statuses]
        open_bills_count = len(open_bills)
        open_bills_total = round(sum(b.total - (b.amount_paid or 0.0) for b in open_bills), 2)

        payments = []
        if bill_ids:
            payments = (
                self.db.query(PaymentDB)
                .filter(PaymentDB.related_bill_id.in_(bill_ids), PaymentDB.is_reversed == False)
                .all()
            )

        total_spend = round(sum(p.amount for p in payments), 2)
        last_payment = None
        if payments:
            sorted_payments = sorted(payments, key=lambda p: (p.payment_date or "", p.id), reverse=True)
            last_payment = sorted_payments[0]

        active_subs = (
            self.db.query(SubscriptionDB)
            .filter(SubscriptionDB.vendor_id == vendor_id, SubscriptionDB.is_active == True)
            .count()
        )

        return {
            "total_spend": total_spend,
            "open_bills_count": open_bills_count,
            "open_bills_total": open_bills_total,
            "last_payment_date": last_payment.payment_date if last_payment else None,
            "last_payment_amount": last_payment.amount if last_payment else None,
            "active_subscriptions_count": active_subs,
        }

