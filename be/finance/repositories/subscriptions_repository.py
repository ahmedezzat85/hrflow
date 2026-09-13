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
        # Calculate monthly equivalent amount
        amount = float(data.amount)
        cycle = (data.billing_cycle or "monthly").lower()
        if cycle == "yearly":
            monthly_equiv = round(amount / 12.0, 2)
        elif cycle == "quarterly":
            monthly_equiv = round(amount / 3.0, 2)
        else:
            monthly_equiv = round(amount, 2)

        sub = SubscriptionDB(
            vendor_id=data.vendor_id,
            name=data.name.strip(),
            amount=data.amount,
            currency=data.currency.upper(),
            billing_cycle=data.billing_cycle,
            next_renewal_date=data.next_renewal_date,
            contract_start_date=data.contract_start_date,
            contract_end_date=data.contract_end_date,
            notice_period_days=data.notice_period_days if data.notice_period_days is not None else 30,
            owner=data.owner.strip() if data.owner else None,
            department=data.department.strip() if data.department else None,
            payment_method=data.payment_method or "card",
            payment_account_id=data.payment_account_id,
            seats_count=data.seats_count,
            monthly_equivalent_amount=monthly_equiv,
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
            elif key == "owner" and val:
                val = val.strip()
            elif key == "department" and val:
                val = val.strip()
            setattr(sub, key, val)

        # Recalculate monthly equivalent if amount or billing_cycle updated
        amount = float(sub.amount or 0.0)
        cycle = (sub.billing_cycle or "monthly").lower()
        if cycle == "yearly":
            sub.monthly_equivalent_amount = round(amount / 12.0, 2)
        elif cycle == "quarterly":
            sub.monthly_equivalent_amount = round(amount / 3.0, 2)
        else:
            sub.monthly_equivalent_amount = round(amount, 2)

        self.db.commit()
        return self.get_by_id(subscription_id)

    def get_charge_by_id(self, charge_id: int) -> Optional[SubscriptionChargeDB]:
        return (
            self.db.query(SubscriptionChargeDB)
            .options(
                joinedload(SubscriptionChargeDB.subscription).joinedload(SubscriptionDB.vendor),
                joinedload(SubscriptionChargeDB.attachments),
                joinedload(SubscriptionChargeDB.linked_transaction),
                joinedload(SubscriptionChargeDB.linked_bill),
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
                joinedload(SubscriptionChargeDB.linked_bill),
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
        from finance.models import BillDB, BillLineDB

        sub = self.db.query(SubscriptionDB).filter(SubscriptionDB.id == data.subscription_id).first()
        if not sub:
            raise ValueError(f"Subscription with ID {data.subscription_id} not found")

        # Calculate variance against subscription base rate
        base_rate = float(sub.amount or 0.0)
        charged_amount = float(data.amount)
        variance_amount = round(charged_amount - base_rate, 2)

        linked_bill_id = None
        # Link or create bill if requested or if auto_generate_bill is True
        if getattr(data, "create_bill", False) or sub.auto_generate_bill:
            bill_num = f"SUB-{sub.id}-{data.billing_date.replace('-', '')}"
            bill = BillDB(
                vendor_id=sub.vendor_id,
                bill_number=bill_num,
                category="SaaS / Software",
                issue_date=data.billing_date,
                due_date=data.billing_date,
                status="ready_to_pay",
                currency=data.currency.upper(),
                subtotal=charged_amount,
                tax_amount=0.0,
                total=charged_amount,
                amount_paid=0.0,
                department=sub.department or "Operations",
                capture_source="recurring_match",
                extraction_confidence=1.0,
                is_reviewed=True,
                notes=f"Recurring charge for subscription: {sub.name}",
                created_at=datetime.utcnow(),
                created_by=created_by or "system",
            )
            self.db.add(bill)
            self.db.flush()
            line = BillLineDB(
                bill_id=bill.id,
                description=f"Subscription: {sub.name}",
                quantity=1,
                unit_price=charged_amount,
                line_total=charged_amount,
            )
            self.db.add(line)
            linked_bill_id = bill.id

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
            linked_bill_id=linked_bill_id,
            variance_amount=variance_amount,
            variance_reason=data.variance_reason if variance_amount != 0.0 else None,
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
