"""
be/finance/repositories/subscriptions_repository.py
SQLAlchemy-backed repository for Subscriptions, Charges, and Finance Attachments.
"""
from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc

from finance.models import (
    SubscriptionDB,
    SubscriptionChargeDB,
    FinanceAttachmentDB,
    VendorDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
)
from finance.repositories.ledger_repository import LedgerRepository
from finance.schemas import (
    SubscriptionCreate,
    SubscriptionUpdate,
    SubscriptionChargeCreate,
)


class SubscriptionsRepository:
    def __init__(self, db: Session):
        self.db = db
        self.ledger_repo = LedgerRepository(db)

    def get_by_id(self, subscription_id: int) -> Optional[SubscriptionDB]:
        return (
            self.db.query(SubscriptionDB)
            .options(
                joinedload(SubscriptionDB.vendor),
                joinedload(SubscriptionDB.charges).joinedload(SubscriptionChargeDB.attachments),
            )
            .filter(SubscriptionDB.id == subscription_id)
            .first()
        )

    def list_subscriptions(
        self,
        is_active: Optional[bool] = None,
        vendor_id: Optional[int] = None,
    ) -> List[SubscriptionDB]:
        query = (
            self.db.query(SubscriptionDB)
            .options(
                joinedload(SubscriptionDB.vendor),
                joinedload(SubscriptionDB.charges),
            )
        )
        if is_active is not None:
            query = query.filter(SubscriptionDB.is_active == is_active)
        if vendor_id is not None:
            query = query.filter(SubscriptionDB.vendor_id == vendor_id)

        return query.order_by(SubscriptionDB.next_renewal_date.asc(), SubscriptionDB.name.asc()).all()

    def create_subscription(self, data: SubscriptionCreate) -> SubscriptionDB:
        sub = SubscriptionDB(
            vendor_id=data.vendor_id,
            name=data.name.strip(),
            amount=data.amount,
            currency=data.currency.upper(),
            billing_cycle=data.billing_cycle,
            next_renewal_date=data.next_renewal_date,
            auto_generate_bill=data.auto_generate_bill,
            is_active=data.is_active,
            created_at=datetime.utcnow(),
        )
        self.db.add(sub)
        self.db.commit()
        self.db.refresh(sub)
        return self.get_by_id(sub.id)

    def update_subscription(
        self, subscription_id: int, data: SubscriptionUpdate
    ) -> Optional[SubscriptionDB]:
        sub = self.db.query(SubscriptionDB).filter(SubscriptionDB.id == subscription_id).first()
        if not sub:
            return None

        update_dict = data.dict(exclude_unset=True)
        for key, val in update_dict.items():
            if key == "name" and val:
                val = val.strip()
            elif key == "currency" and val:
                val = val.upper()
            setattr(sub, key, val)

        self.db.commit()
        return self.get_by_id(subscription_id)

    def get_charge_by_id(self, charge_id: int) -> Optional[SubscriptionChargeDB]:
        return (
            self.db.query(SubscriptionChargeDB)
            .options(
                joinedload(SubscriptionChargeDB.subscription).joinedload(SubscriptionDB.vendor),
                joinedload(SubscriptionChargeDB.attachments),
                joinedload(SubscriptionChargeDB.linked_transaction),
            )
            .filter(SubscriptionChargeDB.id == charge_id)
            .first()
        )

    def list_charges(
        self, subscription_id: Optional[int] = None
    ) -> List[SubscriptionChargeDB]:
        query = (
            self.db.query(SubscriptionChargeDB)
            .options(
                joinedload(SubscriptionChargeDB.subscription).joinedload(SubscriptionDB.vendor),
                joinedload(SubscriptionChargeDB.attachments),
                joinedload(SubscriptionChargeDB.linked_transaction),
            )
        )
        if subscription_id is not None:
            query = query.filter(SubscriptionChargeDB.subscription_id == subscription_id)

        return query.order_by(desc(SubscriptionChargeDB.billing_date), desc(SubscriptionChargeDB.id)).all()

    def create_charge(
        self,
        data: SubscriptionChargeCreate,
        created_by: Optional[str] = None,
    ) -> SubscriptionChargeDB:
        sub = self.db.query(SubscriptionDB).filter(SubscriptionDB.id == data.subscription_id).first()
        if not sub:
            raise ValueError(f"Subscription with ID {data.subscription_id} not found")

        linked_tx_id = None
        if data.bank_account_id:
            bank = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == data.bank_account_id).first()
            if not bank:
                raise ValueError(f"Bank account with ID {data.bank_account_id} not found")

            # Lookup or fallback category & payment type
            cat = (
                self.db.query(TransactionCategoryDB)
                .filter(TransactionCategoryDB.name.ilike("%subscription%"))
                .first()
            )
            if not cat:
                cat = (
                    self.db.query(TransactionCategoryDB)
                    .filter(TransactionCategoryDB.kind == "cost")
                    .first()
                )

            ptype = (
                self.db.query(PaymentTypeDB)
                .filter(PaymentTypeDB.code.in_(["DEBIT_CARD", "OTHER", "CASH"]))
                .first()
            )

            tx = LedgerTransactionDB(
                account_id=bank.id,
                date=data.billing_date,
                amount=data.amount,
                currency=data.currency,
                direction="out",
                category_id=cat.id if cat else None,
                payment_type_id=ptype.id if ptype else None,
                reference=data.note or f"Sub: {sub.name}",
                description=f"Subscription charge: {sub.name}",
                fx_rate=None,
                source="subscription_charge",
                running_balance=0.0,
                created_at=datetime.utcnow(),
                created_by=created_by,
            )
            self.db.add(tx)
            self.db.flush()
            linked_tx_id = tx.id
            self.db.commit()
            self.ledger_repo.recalculate_account_running_balances(bank.id)

        charge = SubscriptionChargeDB(
            subscription_id=data.subscription_id,
            billing_date=data.billing_date,
            amount=data.amount,
            currency=data.currency.upper(),
            linked_transaction_id=linked_tx_id,
            note=data.note or "",
            created_at=datetime.utcnow(),
            created_by=created_by,
        )
        self.db.add(charge)
        self.db.commit()
        self.db.refresh(charge)
        return self.get_charge_by_id(charge.id)

    def add_attachment(
        self,
        subscription_charge_id: int,
        file_name: str,
        file_size: int,
        mime_type: str,
        storage_ref: str,
        uploaded_by: Optional[str] = None,
    ) -> FinanceAttachmentDB:
        att = FinanceAttachmentDB(
            subscription_charge_id=subscription_charge_id,
            statement_import_id=None,
            ledger_transaction_id=None,
            file_name=file_name,
            file_size=file_size,
            mime_type=mime_type,
            storage_ref=storage_ref,
            uploaded_at=datetime.utcnow(),
            uploaded_by=uploaded_by,
        )
        self.db.add(att)
        self.db.commit()
        self.db.refresh(att)
        return att

    def get_attachment_by_id(self, attachment_id: int) -> Optional[FinanceAttachmentDB]:
        return (
            self.db.query(FinanceAttachmentDB)
            .filter(FinanceAttachmentDB.id == attachment_id)
            .first()
        )
