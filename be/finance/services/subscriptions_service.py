"""
be/finance/services/subscriptions_service.py
Business logic for Subscriptions, Variable/Recurring Charges, and Private Finance Attachments.
"""
import os
import uuid
from typing import List, Optional
from fastapi import HTTPException, status, UploadFile

from finance.repositories.subscriptions_repository import SubscriptionsRepository
from finance.schemas import (
    SubscriptionCreate,
    SubscriptionUpdate,
    SubscriptionResponse,
    SubscriptionChargeCreate,
    SubscriptionChargeResponse,
    FinanceAttachmentResponse,
)
from finance.models import SubscriptionDB, SubscriptionChargeDB, FinanceAttachmentDB

FINANCE_UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads", "finance_attachments")


class SubscriptionsService:
    def __init__(self, repo: SubscriptionsRepository):
        self.repo = repo
        os.makedirs(FINANCE_UPLOADS_DIR, exist_ok=True)

    def _attachment_to_response(self, att: FinanceAttachmentDB) -> FinanceAttachmentResponse:
        return FinanceAttachmentResponse(
            id=att.id,
            subscription_charge_id=att.subscription_charge_id,
            statement_import_id=att.statement_import_id,
            ledger_transaction_id=att.ledger_transaction_id,
            file_name=att.file_name,
            file_size=att.file_size or 0,
            mime_type=att.mime_type or "application/octet-stream",
            storage_ref=att.storage_ref,
            uploaded_at=att.uploaded_at,
            uploaded_by=att.uploaded_by,
        )

    def _charge_to_response(self, charge: SubscriptionChargeDB) -> SubscriptionChargeResponse:
        sub_name = charge.subscription.name if charge.subscription else None
        vendor_name = charge.subscription.vendor.name if charge.subscription and charge.subscription.vendor else None
        attachments = [self._attachment_to_response(a) for a in (charge.attachments or [])]

        return SubscriptionChargeResponse(
            id=charge.id,
            subscription_id=charge.subscription_id,
            subscription_name=sub_name,
            vendor_name=vendor_name,
            billing_date=charge.billing_date,
            amount=charge.amount,
            currency=charge.currency,
            linked_transaction_id=charge.linked_transaction_id,
            note=charge.note or "",
            created_at=charge.created_at,
            created_by=charge.created_by,
            attachments=attachments,
        )

    def _sub_to_response(self, sub: SubscriptionDB) -> SubscriptionResponse:
        vendor_name = sub.vendor.name if sub.vendor else None
        charges = sub.charges or []
        last_charge = None
        if charges:
            sorted_charges = sorted(charges, key=lambda c: c.billing_date, reverse=True)
            last_charge = sorted_charges[0]

        return SubscriptionResponse(
            id=sub.id,
            vendor_id=sub.vendor_id,
            vendor_name=vendor_name,
            name=sub.name,
            amount=sub.amount,
            currency=sub.currency,
            billing_cycle=sub.billing_cycle,
            next_renewal_date=sub.next_renewal_date,
            auto_generate_bill=sub.auto_generate_bill,
            is_active=sub.is_active,
            created_at=sub.created_at,
            charges_count=len(charges),
            last_charge_date=last_charge.billing_date if last_charge else None,
            last_charge_amount=last_charge.amount if last_charge else None,
        )

    def list_subscriptions(
        self,
        is_active: Optional[bool] = None,
        vendor_id: Optional[int] = None,
    ) -> List[SubscriptionResponse]:
        subs = self.repo.list_subscriptions(is_active=is_active, vendor_id=vendor_id)
        return [self._sub_to_response(s) for s in subs]

    def get_subscription(self, subscription_id: int) -> SubscriptionResponse:
        sub = self.repo.get_by_id(subscription_id)
        if not sub:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subscription with ID {subscription_id} not found",
            )
        return self._sub_to_response(sub)

    def create_subscription(self, data: SubscriptionCreate) -> SubscriptionResponse:
        # Validate billing_cycle
        if data.billing_cycle not in {"monthly", "quarterly", "yearly"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="billing_cycle must be one of: monthly, quarterly, yearly",
            )
        sub = self.repo.create_subscription(data)
        return self._sub_to_response(sub)

    def update_subscription(
        self, subscription_id: int, data: SubscriptionUpdate
    ) -> SubscriptionResponse:
        if data.billing_cycle and data.billing_cycle not in {"monthly", "quarterly", "yearly"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="billing_cycle must be one of: monthly, quarterly, yearly",
            )
        sub = self.repo.update_subscription(subscription_id, data)
        if not sub:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subscription with ID {subscription_id} not found",
            )
        return self._sub_to_response(sub)

    def list_charges(self, subscription_id: Optional[int] = None) -> List[SubscriptionChargeResponse]:
        charges = self.repo.list_charges(subscription_id=subscription_id)
        return [self._charge_to_response(c) for c in charges]

    def get_charge(self, charge_id: int) -> SubscriptionChargeResponse:
        charge = self.repo.get_charge_by_id(charge_id)
        if not charge:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subscription charge with ID {charge_id} not found",
            )
        return self._charge_to_response(charge)

    async def log_charge(
        self,
        data: SubscriptionChargeCreate,
        file: Optional[UploadFile] = None,
        created_by: Optional[str] = None,
    ) -> SubscriptionChargeResponse:
        try:
            charge = self.repo.create_charge(data, created_by=created_by)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        if file and file.filename:
            # Save file locally into private finance uploads
            safe_filename = os.path.basename(file.filename)
            unique_name = f"{uuid.uuid4().hex}_{safe_filename}"
            file_path = os.path.join(FINANCE_UPLOADS_DIR, unique_name)

            content = await file.read()
            file_size = len(content)
            with open(file_path, "wb") as f:
                f.write(content)

            self.repo.add_attachment(
                subscription_charge_id=charge.id,
                file_name=safe_filename,
                file_size=file_size,
                mime_type=file.content_type or "application/octet-stream",
                storage_ref=file_path,
                uploaded_by=created_by,
            )

        # Refresh charge response
        return self.get_charge(charge.id)

    def get_attachment(self, attachment_id: int) -> FinanceAttachmentDB:
        att = self.repo.get_attachment_by_id(attachment_id)
        if not att:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Attachment with ID {attachment_id} not found",
            )
        return att
