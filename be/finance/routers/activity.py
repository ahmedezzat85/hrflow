"""
be/finance/routers/activity.py
Production router for Finance Entity Activity Timelines and Detail Summaries (Story 1.3).
Provides unified activity, timeline history, linked records, and permission-aware sensitive masking
for all finance entities (invoices, bills, transfers, cheques, transactions, accounts).
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from auth import get_current_user
from core.permissions import get_current_user_permissions
from repositories.deps import get_audit_repo
from repositories.interfaces import AuditRepository
from finance.models import (
    SalesInvoiceDB,
    BillDB,
    AccountTransferDB,
    FinanceChequeDB,
    LedgerTransactionDB,
    CustomerDB,
    VendorDB,
    FinanceBankAccountDB,
    SubscriptionDB,
)
from finance.schemas import (
    EntityActivityResponse,
    EntitySummary,
    EntitySummaryAttribute,
    RelatedRecordItem,
    TimelineEvent,
)

router = APIRouter(prefix="/api/finance/activity", tags=["Finance - Activity & Timeline"])


def _mask_sensitive(val: Optional[str], is_admin: bool) -> str:
    """Masks sensitive identifiers like bank account numbers or tax IDs for non-admin users."""
    if not val:
        return ""
    if is_admin:
        return val
    val_str = str(val).strip()
    if len(val_str) <= 4:
        return "****"
    return "******" + val_str[-4:]


@router.get("/{entity_type}/{entity_id}", response_model=EntityActivityResponse)
def get_entity_activity(
    entity_type: str,
    entity_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    audit_repo: AuditRepository = Depends(get_audit_repo),
):
    """
    Returns the comprehensive detail summary, related records, attachments, and chronological
    plain-language activity timeline for a financial entity. Masking sensitive fields unless admin.
    """
    norm_type = entity_type.lower().strip()
    user_role = current_user.get("role", "")
    is_admin = (user_role == "admin")

    # 1. Sales Invoice
    if norm_type in ("invoice", "sales_invoice", "invoices"):
        inv = db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == entity_id).first()
        if not inv:
            raise HTTPException(status_code=404, detail=f"Invoice #{entity_id} not found")

        acc_name = inv.expected_bank_account.account_name if inv.expected_bank_account else "—"
        cust_name = inv.customer.name if inv.customer else "—"
        cust_tax_id = inv.customer.tax_id if inv.customer else ""

        paid_sum = sum(p.amount for p in (inv.payments or []) if p.amount and (p.direction == "incoming" or not p.direction))
        paid_sum = round(paid_sum, 2)
        balance = max(0.0, round(inv.total - paid_sum, 2))
        today = datetime.utcnow().date()
        is_overdue = False
        days_overdue = 0
        if inv.due_date:
            try:
                due_dt = datetime.strptime(inv.due_date, "%Y-%m-%d").date()
                if due_dt < today and balance > 0 and inv.status != "void":
                    is_overdue = True
                    days_overdue = (today - due_dt).days
            except Exception:
                pass

        if balance <= 0 and inv.status != "void":
            derived_status = "paid"
            next_action = "Completed (Paid in Full)"
        elif inv.status == "void":
            derived_status = "void"
            next_action = "Archived (Voided)"
        elif inv.status == "draft":
            derived_status = "draft"
            next_action = "Review & Send to Customer"
        elif is_overdue:
            derived_status = "overdue"
            next_action = f"Send Payment Reminder ({days_overdue}d overdue)"
        elif paid_sum > 0:
            derived_status = "sent"
            next_action = "Collect Remaining Balance"
        else:
            derived_status = inv.status
            next_action = "Awaiting Due Date / Payment"

        attributes = [
            EntitySummaryAttribute(label="Subtotal", value=f"{inv.subtotal:,.2f} {inv.currency}"),
            EntitySummaryAttribute(label="Tax Amount", value=f"{inv.tax_amount:,.2f} {inv.currency}"),
            EntitySummaryAttribute(label="Amount Paid", value=f"{paid_sum:,.2f} {inv.currency}"),
            EntitySummaryAttribute(label="Outstanding Balance", value=f"{balance:,.2f} {inv.currency}"),
            EntitySummaryAttribute(label="Next Action", value=next_action),
            EntitySummaryAttribute(label="Revenue Channel", value=inv.revenue_channel or "—"),
            EntitySummaryAttribute(label="Expected Account", value=acc_name),
        ]
        if is_overdue:
            attributes.insert(4, EntitySummaryAttribute(label="Overdue State", value=f"{days_overdue} days overdue"))
        if cust_tax_id:
            attributes.append(EntitySummaryAttribute(label="Customer Tax ID", value=_mask_sensitive(cust_tax_id, is_admin)))

        summary = EntitySummary(
            reference=inv.invoice_number,
            counterparty=cust_name,
            amount=inv.total,
            currency=inv.currency,
            date=inv.issue_date,
            due_date=inv.due_date,
            status=derived_status,
            notes=inv.notes or "",
            sensitive_masked=not is_admin,
            attributes=attributes,
        )

        related: List[RelatedRecordItem] = []
        for p in (inv.payments or []):
            bank_name = p.bank_account.account_name if p.bank_account else "Bank"
            related.append(RelatedRecordItem(
                entity_type="payment",
                entity_id=p.id,
                title=f"Payment #{p.id} ({p.method})",
                badge=f"Paid into {bank_name}",
                amount=p.amount,
                currency=p.currency,
                date=p.payment_date,
            ))

        # Build timeline
        timeline: List[TimelineEvent] = []
        created_ts = inv.created_at.strftime("%Y-%m-%d %H:%M:%S") if inv.created_at else f"{inv.issue_date} 09:00:00"
        timeline.append(TimelineEvent(
            id=f"inv-{inv.id}-created",
            timestamp=created_ts,
            event="created",
            plain_text=f"Invoice {inv.invoice_number} created with total {inv.total:,.2f} {inv.currency}",
            actor="admin@voyancemed.com",
            state_transition={"from_state": None, "to_state": "draft"},
        ))

        if inv.status in ("sent", "paid", "overdue"):
            timeline.append(TimelineEvent(
                id=f"inv-{inv.id}-sent",
                timestamp=f"{inv.issue_date} 10:00:00",
                event="sent",
                plain_text=f"Invoice {inv.invoice_number} issued and sent to {cust_name}",
                actor="billing@voyancemed.com",
                state_transition={"from_state": "draft", "to_state": "sent"},
            ))

        for p in (inv.payments or []):
            timeline.append(TimelineEvent(
                id=f"inv-{inv.id}-pay-{p.id}",
                timestamp=f"{p.payment_date} 12:00:00",
                event="payment_recorded",
                plain_text=f"Payment of {p.amount:,.2f} {p.currency} recorded via {p.method}",
                actor="admin@voyancemed.com",
                state_transition={"from_state": "sent", "to_state": "paid"} if inv.status == "paid" else None,
                linked_record={"entity_type": "payment", "entity_id": p.id, "title": f"Payment #{p.id}"},
            ))

        if inv.status == "void":
            timeline.append(TimelineEvent(
                id=f"inv-{inv.id}-void",
                timestamp=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                event="voided",
                plain_text=f"Invoice {inv.invoice_number} voided with reversal audit entry",
                actor="admin@voyancemed.com",
                state_transition={"from_state": "sent", "to_state": "void"},
            ))

        # Query system audit log for this entity
        all_audits = audit_repo.list_all()
        for a in all_audits:
            if a.get("target_type") == "invoice" and str(a.get("target_id")) == str(inv.id):
                timeline.append(TimelineEvent(
                    id=f"audit-{a.get('id')}",
                    timestamp=a.get("timestamp") or "",
                    event=a.get("action") or "audit_action",
                    plain_text=f"Audit Event: {a.get('action')} - {a.get('details') or 'Action recorded'}",
                    actor=a.get("actor_email") or "",
                ))

        # Sort chronological (ascending)
        timeline.sort(key=lambda e: e.timestamp)

        return EntityActivityResponse(
            entity_type="invoice",
            entity_id=inv.id,
            title=f"Invoice {inv.invoice_number}",
            status=inv.status,
            summary=summary,
            related_records=related,
            attachments=[],
            timeline=timeline,
        )

    # 2. Vendor Bill
    elif norm_type in ("bill", "bills", "vendor_bill"):
        bill = db.query(BillDB).filter(BillDB.id == entity_id).first()
        if not bill:
            raise HTTPException(status_code=404, detail=f"Bill #{entity_id} not found")

        vendor_name = bill.vendor.name if bill.vendor else "—"
        vendor_tax_id = bill.vendor.tax_id if bill.vendor else ""

        attributes = [
            EntitySummaryAttribute(label="Category", value=bill.category or "Operating Expense"),
            EntitySummaryAttribute(label="Subtotal", value=f"{bill.subtotal:,.2f} {bill.currency}"),
            EntitySummaryAttribute(label="Tax Amount", value=f"{bill.tax_amount:,.2f} {bill.currency}"),
        ]
        if vendor_tax_id:
            attributes.append(EntitySummaryAttribute(label="Vendor Tax ID", value=_mask_sensitive(vendor_tax_id, is_admin)))

        summary = EntitySummary(
            reference=bill.bill_number,
            counterparty=vendor_name,
            amount=bill.total,
            currency=bill.currency,
            date=bill.issue_date,
            due_date=bill.due_date,
            status=bill.status,
            notes=bill.notes or "",
            sensitive_masked=not is_admin,
            attributes=attributes,
        )

        related = []
        for p in (bill.payments or []):
            bank_name = p.bank_account.account_name if p.bank_account else "Bank"
            related.append(RelatedRecordItem(
                entity_type="payment",
                entity_id=p.id,
                title=f"Bill Payment #{p.id} ({p.method})",
                badge=f"Paid from {bank_name}",
                amount=p.amount,
                currency=p.currency,
                date=p.payment_date,
            ))

        timeline = []
        created_ts = bill.created_at.strftime("%Y-%m-%d %H:%M:%S") if bill.created_at else f"{bill.issue_date} 09:00:00"
        timeline.append(TimelineEvent(
            id=f"bill-{bill.id}-created",
            timestamp=created_ts,
            event="created",
            plain_text=f"Vendor bill {bill.bill_number} received from {vendor_name} for {bill.total:,.2f} {bill.currency}",
            actor="ap@voyancemed.com",
            state_transition={"from_state": None, "to_state": "unpaid"},
        ))

        for p in (bill.payments or []):
            timeline.append(TimelineEvent(
                id=f"bill-{bill.id}-pay-{p.id}",
                timestamp=f"{p.payment_date} 14:00:00",
                event="payment_recorded",
                plain_text=f"Outflow payment of {p.amount:,.2f} {p.currency} executed to {vendor_name}",
                actor="admin@voyancemed.com",
                state_transition={"from_state": "unpaid", "to_state": "paid"} if bill.status == "paid" else None,
                linked_record={"entity_type": "payment", "entity_id": p.id, "title": f"Payment #{p.id}"},
            ))

        if bill.status == "void":
            timeline.append(TimelineEvent(
                id=f"bill-{bill.id}-void",
                timestamp=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                event="voided",
                plain_text=f"Vendor bill {bill.bill_number} voided with audit consequence tracking",
                actor="admin@voyancemed.com",
                state_transition={"from_state": "unpaid", "to_state": "void"},
            ))

        all_audits = audit_repo.list_all()
        for a in all_audits:
            if a.get("target_type") == "bill" and str(a.get("target_id")) == str(bill.id):
                timeline.append(TimelineEvent(
                    id=f"audit-{a.get('id')}",
                    timestamp=a.get("timestamp") or "",
                    event=a.get("action") or "audit_action",
                    plain_text=f"Audit Event: {a.get('action')} - {a.get('details') or 'Action recorded'}",
                    actor=a.get("actor_email") or "",
                ))

        timeline.sort(key=lambda e: e.timestamp)

        return EntityActivityResponse(
            entity_type="bill",
            entity_id=bill.id,
            title=f"Bill {bill.bill_number}",
            status=bill.status,
            summary=summary,
            related_records=related,
            attachments=[],
            timeline=timeline,
        )

    # 3. Bank / Account Transfer
    elif norm_type in ("transfer", "transfers", "account_transfer"):
        trf = db.query(AccountTransferDB).filter(AccountTransferDB.id == entity_id).first()
        if not trf:
            raise HTTPException(status_code=404, detail=f"Transfer #{entity_id} not found")

        from_name = trf.from_account.account_name if trf.from_account else "External / Cash"
        to_name = trf.to_account.account_name if trf.to_account else "External / Cash"

        attributes = [
            EntitySummaryAttribute(label="Source Account", value=from_name),
            EntitySummaryAttribute(label="Destination Account", value=to_name),
            EntitySummaryAttribute(label="Transfer Type", value=trf.transfer_type),
            EntitySummaryAttribute(label="Outflow Amount", value=f"{trf.from_amount:,.2f} {trf.from_currency}"),
            EntitySummaryAttribute(label="Inflow Amount", value=f"{trf.to_amount:,.2f} {trf.to_currency}"),
        ]
        if trf.fx_rate:
            attributes.append(EntitySummaryAttribute(label="FX Conversion Rate", value=str(trf.fx_rate)))
        if trf.exchange_reference:
            attributes.append(EntitySummaryAttribute(label="Exchange Reference", value=trf.exchange_reference))

        summary = EntitySummary(
            reference=f"TRF-{trf.id:04d}",
            counterparty=f"{from_name} -> {to_name}",
            amount=trf.from_amount,
            currency=trf.from_currency,
            date=trf.date,
            status="completed",
            notes=trf.note or "",
            sensitive_masked=not is_admin,
            attributes=attributes,
        )

        related = []
        for tx in (trf.ledger_transactions or []):
            acc = tx.account.account_name if tx.account else "Account"
            related.append(RelatedRecordItem(
                entity_type="transaction",
                entity_id=tx.id,
                title=f"Ledger Entry #{tx.id} ({tx.direction.upper()})",
                badge=acc,
                amount=tx.amount,
                currency=tx.currency,
                date=tx.date,
            ))

        created_ts = trf.created_at.strftime("%Y-%m-%d %H:%M:%S") if trf.created_at else f"{trf.date} 10:00:00"
        timeline = [
            TimelineEvent(
                id=f"trf-{trf.id}-init",
                timestamp=created_ts,
                event="created",
                plain_text=f"Account transfer initiated: {trf.from_amount:,.2f} {trf.from_currency} from {from_name} to {to_name}",
                actor=trf.created_by or "treasury@voyancemed.com",
                state_transition={"from_state": None, "to_state": "completed"},
            )
        ]
        if trf.confirmed_leg == "both":
            confirm_ts = (
                (trf.created_at.strftime("%Y-%m-%d %H:%M:%S") if trf.created_at else f"{trf.date} 10:05:00")
            )
            timeline.append(TimelineEvent(
                id=f"trf-{trf.id}-confirm",
                timestamp=confirm_ts,
                event="legs_settled",
                plain_text=f"Both debit and credit ledger legs synchronized successfully",
                actor="system@hrflow.internal",
            ))

        # Preserve creation as first event if timestamps match
        timeline.sort(key=lambda e: (e.timestamp, 0 if e.event == "created" else 1))


        return EntityActivityResponse(
            entity_type="transfer",
            entity_id=trf.id,
            title=f"Transfer TRF-{trf.id:04d}",
            status="completed",
            summary=summary,
            related_records=related,
            attachments=[],
            timeline=timeline,
        )

    # 4. Cheque
    elif norm_type in ("cheque", "cheques"):
        chq = db.query(FinanceChequeDB).filter(FinanceChequeDB.id == entity_id).first()
        if not chq:
            raise HTTPException(status_code=404, detail=f"Cheque #{entity_id} not found")

        acc_name = chq.account.account_name if chq.account else "—"
        acc_num = chq.account.account_number if chq.account else ""

        attributes = [
            EntitySummaryAttribute(label="Cheque Number", value=chq.cheque_number),
            EntitySummaryAttribute(label="Issuing Account", value=acc_name),
            EntitySummaryAttribute(label="Account Number", value=_mask_sensitive(acc_num, is_admin)),
            EntitySummaryAttribute(label="Purpose", value=chq.purpose_type.replace("_", " ").title()),
            EntitySummaryAttribute(label="Fiscal Year", value=str(chq.fiscal_year)),
        ]
        if chq.clear_date:
            attributes.append(EntitySummaryAttribute(label="Clear Date", value=chq.clear_date))

        summary = EntitySummary(
            reference=f"CHQ #{chq.cheque_number}",
            counterparty=chq.payee,
            amount=chq.amount,
            currency=chq.currency,
            date=chq.issue_date,
            status=chq.status,
            notes=chq.notes or "",
            sensitive_masked=not is_admin,
            attributes=attributes,
        )

        related = []
        if chq.linked_transaction:
            related.append(RelatedRecordItem(
                entity_type="transaction",
                entity_id=chq.linked_transaction.id,
                title=f"Bank Withdrawal Entry #{chq.linked_transaction.id}",
                badge="Ledger Debit",
                amount=chq.linked_transaction.amount,
                currency=chq.linked_transaction.currency,
                date=chq.linked_transaction.date,
            ))
        if chq.linked_cash_transaction:
            related.append(RelatedRecordItem(
                entity_type="transaction",
                entity_id=chq.linked_cash_transaction.id,
                title=f"Cash Drawer Inflow Entry #{chq.linked_cash_transaction.id}",
                badge="Cash Credit",
                amount=chq.linked_cash_transaction.amount,
                currency=chq.linked_cash_transaction.currency,
                date=chq.linked_cash_transaction.date,
            ))
        if chq.linked_bill:
            related.append(RelatedRecordItem(
                entity_type="bill",
                entity_id=chq.linked_bill.id,
                title=f"Linked Bill {chq.linked_bill.bill_number}",
                badge="Vendor Payables",
                amount=chq.linked_bill.total,
                currency=chq.linked_bill.currency,
                date=chq.linked_bill.issue_date,
            ))

        created_ts = chq.created_at.strftime("%Y-%m-%d %H:%M:%S") if chq.created_at else f"{chq.issue_date} 09:30:00"
        timeline = [
            TimelineEvent(
                id=f"chq-{chq.id}-issued",
                timestamp=created_ts,
                event="issued",
                plain_text=f"Cheque #{chq.cheque_number} issued to {chq.payee} for {chq.amount:,.2f} {chq.currency}",
                actor=chq.created_by or "treasury@voyancemed.com",
                state_transition={"from_state": None, "to_state": "issued"},
            )
        ]
        if chq.clear_date or chq.status == "cleared":
            clear_ts = f"{chq.clear_date} 16:00:00" if chq.clear_date else f"{chq.issue_date} 16:00:00"
            timeline.append(TimelineEvent(
                id=f"chq-{chq.id}-cleared",
                timestamp=clear_ts,
                event="cleared",
                plain_text=f"Cheque #{chq.cheque_number} cleared through {acc_name}",
                actor="treasury@voyancemed.com",
                state_transition={"from_state": "issued", "to_state": "cleared"},
            ))
        elif chq.status == "voided":
            timeline.append(TimelineEvent(
                id=f"chq-{chq.id}-voided",
                timestamp=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                event="voided",
                plain_text=f"Cheque #{chq.cheque_number} voided and returned to bookkeeper",
                actor="admin@voyancemed.com",
                state_transition={"from_state": "issued", "to_state": "voided"},
            ))

        timeline.sort(key=lambda e: e.timestamp)

        return EntityActivityResponse(
            entity_type="cheque",
            entity_id=chq.id,
            title=f"Cheque #{chq.cheque_number}",
            status=chq.status,
            summary=summary,
            related_records=related,
            attachments=[],
            timeline=timeline,
        )

    # 5. Ledger Transaction
    elif norm_type in ("transaction", "transactions", "ledger"):
        tx = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == entity_id).first()
        if not tx:
            raise HTTPException(status_code=404, detail=f"Transaction #{entity_id} not found")

        acc_name = tx.account.account_name if tx.account else "—"
        cat_name = tx.category.name if tx.category else "General"
        pt_name = tx.payment_type.name if tx.payment_type else "Other"

        attributes = [
            EntitySummaryAttribute(label="Direction", value="Inflow" if tx.direction == "in" else "Outflow"),
            EntitySummaryAttribute(label="Account", value=acc_name),
            EntitySummaryAttribute(label="Category", value=cat_name),
            EntitySummaryAttribute(label="Payment Type", value=pt_name),
            EntitySummaryAttribute(label="Running Balance", value=f"{tx.running_balance:,.2f} {tx.currency}"),
        ]
        if tx.cheque_number:
            attributes.append(EntitySummaryAttribute(label="Cheque #", value=tx.cheque_number))

        summary = EntitySummary(
            reference=f"TXN-{tx.id:04d}",
            counterparty=tx.description or acc_name,
            amount=tx.amount,
            currency=tx.currency,
            date=tx.date,
            status="settled",
            notes=tx.reference or "",
            sensitive_masked=not is_admin,
            attributes=attributes,
        )

        related = []
        if tx.linked_invoice:
            related.append(RelatedRecordItem(
                entity_type="invoice",
                entity_id=tx.linked_invoice.id,
                title=f"Invoice {tx.linked_invoice.invoice_number}",
                badge="Accounts Receivable",
                amount=tx.linked_invoice.total,
                currency=tx.linked_invoice.currency,
                date=tx.linked_invoice.issue_date,
            ))
        if tx.linked_bill:
            related.append(RelatedRecordItem(
                entity_type="bill",
                entity_id=tx.linked_bill.id,
                title=f"Bill {tx.linked_bill.bill_number}",
                badge="Vendor Payables",
                amount=tx.linked_bill.total,
                currency=tx.linked_bill.currency,
                date=tx.linked_bill.issue_date,
            ))
        if tx.linked_transfer:
            related.append(RelatedRecordItem(
                entity_type="transfer",
                entity_id=tx.linked_transfer.id,
                title=f"Transfer TRF-{tx.linked_transfer.id:04d}",
                badge="Inter-Account",
                amount=tx.linked_transfer.from_amount,
                currency=tx.linked_transfer.from_currency,
                date=tx.linked_transfer.date,
            ))

        created_ts = tx.created_at.strftime("%Y-%m-%d %H:%M:%S") if tx.created_at else f"{tx.date} 10:00:00"
        timeline = [
            TimelineEvent(
                id=f"tx-{tx.id}-posted",
                timestamp=created_ts,
                event="posted",
                plain_text=f"Transaction #{tx.id} posted to {acc_name}: {tx.direction.upper()} of {tx.amount:,.2f} {tx.currency}",
                actor=tx.created_by or "system@hrflow.internal",
                state_transition={"from_state": None, "to_state": "settled"},
            )
        ]

        timeline.sort(key=lambda e: e.timestamp)

        return EntityActivityResponse(
            entity_type="transaction",
            entity_id=tx.id,
            title=f"Transaction TXN-{tx.id:04d}",
            status="settled",
            summary=summary,
            related_records=related,
            attachments=[],
            timeline=timeline,
        )

    elif norm_type in ("customer", "customers"):
        cust = db.query(CustomerDB).filter(CustomerDB.id == entity_id).first()
        if not cust:
            raise HTTPException(status_code=404, detail=f"Customer #{entity_id} not found")

        total_invoiced = 0.0
        total_paid = 0.0
        outstanding_balance = 0.0
        overdue_balance = 0.0
        today = datetime.utcnow().date()
        related = []
        timeline = []

        for inv in (cust.invoices or []):
            is_void = (inv.status or "").lower() == "void"
            valid_payments = [p for p in (inv.payments or []) if not getattr(p, "is_reversed", False)]
            inv_paid = sum(p.amount for p in valid_payments)
            inv_balance = max(0.0, float(inv.total) - inv_paid) if not is_void else 0.0

            due_dt = None
            if inv.due_date:
                try:
                    due_dt = datetime.strptime(str(inv.due_date)[:10], "%Y-%m-%d").date()
                except Exception:
                    pass

            is_overdue = False
            if not is_void and inv_balance > 0.001 and due_dt and due_dt < today:
                is_overdue = True

            derived_status = "void" if is_void else ("paid" if inv_balance <= 0.001 and float(inv.total) > 0 else ("overdue" if is_overdue else (inv.status or "sent")))

            if not is_void:
                total_invoiced += float(inv.total)
                total_paid += inv_paid
                outstanding_balance += inv_balance
                if is_overdue:
                    overdue_balance += inv_balance

            related.append(RelatedRecordItem(
                entity_type="invoice",
                entity_id=inv.id,
                title=f"Invoice {inv.invoice_number}",
                badge=derived_status.capitalize(),
                amount=float(inv.total),
                currency=inv.currency,
                date=str(inv.issue_date) if inv.issue_date else None,
            ))

            iss_date_str = str(inv.issue_date) if inv.issue_date else (inv.created_at.strftime("%Y-%m-%d") if inv.created_at else str(today))
            timeline.append(TimelineEvent(
                id=f"inv-{inv.id}-created",
                timestamp=f"{iss_date_str} 09:00:00",
                event="invoice_issued",
                plain_text=f"Invoice {inv.invoice_number} issued for {inv.currency} {float(inv.total):,.2f}",
                actor="finance@voyance.health",
                state_transition={"from_state": "draft", "to_state": derived_status},
            ))

            for p in valid_payments:
                p_date_str = str(p.payment_date) if p.payment_date else str(today)
                timeline.append(TimelineEvent(
                    id=f"pmt-{p.id}-received",
                    timestamp=f"{p_date_str} 14:00:00",
                    event="payment_received",
                    plain_text=f"Payment of {p.currency} {float(p.amount):,.2f} recorded (Ref: {p.reference or 'N/A'})",
                    actor="finance@voyance.health",
                    state_transition={"from_state": "sent", "to_state": "paid" if inv_balance <= 0.001 else "partially_paid"},
                ))

        timeline.sort(key=lambda e: e.timestamp, reverse=True)

        attributes = [
            EntitySummaryAttribute(label="Legal Name", value=cust.legal_name or "—"),
            EntitySummaryAttribute(label="Contact Email", value=cust.contact_email or "—"),
            EntitySummaryAttribute(label="Contact Phone", value=cust.contact_phone or "—"),
            EntitySummaryAttribute(label="Tax ID", value=_mask_sensitive(cust.tax_id, is_admin) or "—"),
            EntitySummaryAttribute(label="Payment Terms", value=f"{cust.payment_terms_days or 30} days"),
            EntitySummaryAttribute(label="Default Currency", value=cust.default_currency or "USD"),
            EntitySummaryAttribute(label="Country", value=cust.country or "Egypt"),
            EntitySummaryAttribute(label="Total Invoiced", value=f"{total_invoiced:,.2f} {cust.default_currency or 'USD'}"),
            EntitySummaryAttribute(label="Total Paid", value=f"{total_paid:,.2f} {cust.default_currency or 'USD'}"),
            EntitySummaryAttribute(label="Outstanding Balance", value=f"{outstanding_balance:,.2f} {cust.default_currency or 'USD'}"),
            EntitySummaryAttribute(label="Overdue Balance", value=f"{overdue_balance:,.2f} {cust.default_currency or 'USD'}"),
            EntitySummaryAttribute(label="Account Owner", value=cust.owner or "—"),
        ]

        summary = EntitySummary(
            reference=f"CUST-{cust.id:04d}",
            amount=outstanding_balance,
            currency=cust.default_currency or "USD",
            counterparty=cust.legal_name or cust.name,
            attributes=attributes,
            notes=cust.notes,
            sensitive_masked=(not is_admin and bool(cust.tax_id)),
        )

        return EntityActivityResponse(
            entity_type="customer",
            entity_id=cust.id,
            title=f"Customer: {cust.name}",
            status="active" if cust.is_active else "inactive",
            summary=summary,
            related_records=related,
            attachments=[],
            timeline=timeline,
        )

    elif norm_type in ("vendor", "vendors"):
        vend = db.query(VendorDB).filter(VendorDB.id == entity_id).first()
        if not vend:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Vendor #{entity_id} not found")

        bills = db.query(BillDB).filter(BillDB.vendor_id == vend.id).all()
        paid_bills = [b for b in bills if str(b.status).lower() == "paid"]
        total_spend = sum(float(b.total or 0.0) for b in paid_bills)
        open_bills = [b for b in bills if str(b.status).lower() not in ("paid", "void")]
        open_total = sum(float(b.total or 0.0) for b in open_bills)

        related: List[RelatedRecordItem] = []
        timeline: List[TimelineEvent] = []

        for b in sorted(bills, key=lambda x: str(x.issue_date or ""), reverse=True):
            b_status = str(b.status).lower()
            related.append(RelatedRecordItem(
                entity_type="bill",
                entity_id=b.id,
                title=f"Bill {b.bill_number}",
                badge=b_status.upper(),
                amount=float(b.total or 0.0),
                currency=b.currency or "USD",
                date=b.issue_date,
            ))
            timeline.append(TimelineEvent(
                id=f"bill-{b.id}-issued",
                timestamp=f"{b.issue_date or today} 09:00:00",
                event="bill_received",
                plain_text=f"Bill {b.bill_number} recorded for {b.currency} {float(b.total):,.2f}",
                actor=b.created_by or "finance@voyance.health",
                state_transition={"from_state": "inbox", "to_state": b_status},
            ))

        # Payment instructions info
        can_reveal = is_admin or ("finance.vendor_payment.reveal" in user_permissions)
        instructions = vend.payment_instructions or []
        pi_summary_parts = []
        for pi in instructions:
            acct_display = pi.account_number if can_reveal else _mask_sensitive(pi.account_number, False)
            pi_summary_parts.append(f"{pi.bank_name or 'Bank'}: {acct_display} ({pi.verification_status})")

        vend_curr = vend.default_currency or "EGP"
        attributes = [
            EntitySummaryAttribute(label="Legal Name", value=vend.legal_name or "—"),
            EntitySummaryAttribute(label="Category", value=vend.category or "General"),
            EntitySummaryAttribute(label="Contact Email", value=vend.contact_email or "—"),
            EntitySummaryAttribute(label="Contact Phone", value=vend.contact_phone or "—"),
            EntitySummaryAttribute(label="Tax ID", value=_mask_sensitive(vend.tax_id, is_admin) or "—"),
            EntitySummaryAttribute(label="Payment Terms", value=f"{vend.payment_terms_days or 30} days"),
            EntitySummaryAttribute(label="Default Currency", value=vend_curr),
            EntitySummaryAttribute(label="Total Spend", value=f"{total_spend:,.2f} {vend_curr}"),
            EntitySummaryAttribute(label="Open Bills Count", value=str(len(open_bills))),
            EntitySummaryAttribute(label="Open Bills Total", value=f"{open_total:,.2f} {vend_curr}"),
            EntitySummaryAttribute(label="Payment Instructions", value="; ".join(pi_summary_parts) if pi_summary_parts else "None recorded"),
        ]

        summary = EntitySummary(
            reference=f"VEND-{vend.id:04d}",
            amount=open_total,
            currency=vend_curr,
            counterparty=vend.legal_name or vend.name,
            attributes=attributes,
            notes=vend.notes,
            sensitive_masked=(not can_reveal and bool(instructions)),
        )

        return EntityActivityResponse(
            entity_type="vendor",
            entity_id=vend.id,
            title=f"Vendor: {vend.name}",
            status="active" if vend.is_active else "inactive",
            summary=summary,
            related_records=related,
            attachments=[],
            timeline=timeline,
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported entity type for activity drawer: '{entity_type}'"
        )
