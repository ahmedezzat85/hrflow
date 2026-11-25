"""
be/finance/routers/activity.py
Production router for Finance Entity Activity Timelines and Detail Summaries (Story 1.3).
Provides unified activity, timeline history, linked records, and permission-aware sensitive masking
for all finance entities (invoices, bills, transfers, cheques, transactions, accounts).
"""
import json
import os
import file_layout
from typing import Optional, List, Dict, Any
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from db import get_db
from auth import get_current_user
from core.permissions import get_current_user_permissions
from finance import invoice_status as inv_status
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
    FinanceAttachmentResponse,
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


def _ts(value: Optional[datetime]) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else ""


# Audit actions the invoice timeline already derives from the stored columns (no second line for them)
_DERIVED_INVOICE_AUDITS = {
    "invoice.created", "invoice.sent", "invoice.voided", "invoice.payment_recorded", "invoice.payment_reversed",
}


def _build_invoice_timeline(db: Session, inv: SalesInvoiceDB, cust_name: str) -> List[TimelineEvent]:
    """
    Invoice activity from stored facts only: who and when come from the columns the actions write
    (created_by/created_at, sent_by/sent_at, payment created_by/created_at, reversal and void fields) and from the
    audit log for edits. Nothing is invented. A date-only timestamp means only that date is known.
    """
    cur = inv.currency
    events: List[TimelineEvent] = []

    # The first two lines always lead; the rest follow by when they were entered.
    lead: List[TimelineEvent] = [TimelineEvent(
        id=f"inv-{inv.id}-created",
        timestamp=_ts(inv.created_at) or str(inv.issue_date),
        event="created",
        plain_text=f"Invoice {inv.invoice_number} created with total {inv.total:,.2f} {cur}",
        actor=inv.created_by or "",
        state_transition={"from_state": None, "to_state": "draft"},
    )]
    if inv.status in ("sent", "partially_paid", "paid") or inv.sent_at:
        lead.append(TimelineEvent(
            id=f"inv-{inv.id}-sent",
            timestamp=_ts(inv.sent_at) or str(inv.issue_date),
            event="sent",
            plain_text=f"Invoice {inv.invoice_number} issued and sent to {cust_name} (issue date {inv.issue_date})",
            actor=inv.sent_by or "",
            state_transition={"from_state": "draft", "to_state": "sent"},
        ))

    running = 0.0
    prev_state = "sent"
    for p in sorted(inv.payments or [], key=lambda x: x.id):
        running += float(p.amount or 0.0) + float(getattr(p, "withheld_amount", 0.0) or 0.0)
        state = inv_status.derive_payment_status(inv.total, running)
        events.append(TimelineEvent(
            id=f"inv-{inv.id}-pay-{p.id}",
            timestamp=_ts(p.created_at) or str(p.payment_date),
            event="payment_recorded",
            plain_text=f"Payment of {p.amount:,.2f} {p.currency} received {p.payment_date}, recorded via {p.method}",
            actor=p.created_by or "",
            state_transition={"from_state": prev_state, "to_state": state} if inv.status != "void" and state != prev_state else None,
            linked_record={"entity_type": "payment", "entity_id": p.id, "title": f"Payment #{p.id}"},
        ))
        prev_state = state
        if p.is_reversed:
            label = "Refund" if p.reversal_kind == "refund" else "Reversal"
            note = f"{label} of payment #{p.id} ({p.amount:,.2f} {p.currency}) as of {p.reversal_date or 'the action date'}"
            if p.reversal_reason:
                note += f": {p.reversal_reason}"
            events.append(TimelineEvent(
                id=f"inv-{inv.id}-pay-{p.id}-reversed",
                timestamp=_ts(p.reversed_at) or str(p.reversal_date or p.payment_date),
                event="payment_reversed",
                plain_text=note,
                actor=p.reversed_by or "",
                linked_record={"entity_type": "payment", "entity_id": p.id, "title": f"Payment #{p.id}"},
            ))

    if inv.status == "void":
        reason = f": {inv.void_reason}" if inv.void_reason else ""
        events.append(TimelineEvent(
            id=f"inv-{inv.id}-void",
            timestamp=_ts(inv.voided_at) or str(inv.issue_date),
            event="voided",
            plain_text=f"Invoice {inv.invoice_number} voided{reason}",
            actor=inv.voided_by or "",
            state_transition={"from_state": "sent" if inv.sent_at or inv.sent_by else "draft", "to_state": "void"},
        ))

    for a in _audits_for(db, ["invoice"], inv.id):
        action = a.action or "audit_action"
        if action in _DERIVED_INVOICE_AUDITS:
            continue
        label = "Invoice edited" if action == "invoice.updated" else action
        details = a.details
        events.append(TimelineEvent(
            id=f"audit-{a.id}",
            timestamp=a.timestamp or "",
            event=action,
            plain_text=f"{label} ({details})" if details else label,
            actor=a.actor_email or "",
        ))

    events.sort(key=lambda e: e.timestamp)
    return lead + events


# ---------------------------------------------------------------------------------------------------------------------
# Timelines for the other entities follow the same rule (audit 2026-11, H-1): only stored facts. Who and when come from
# the record's own columns (created_by/created_at, voided_*, a payment's created_* and reversed_*) and from the audit log:
# the named entries services write (bill.approved, finance.transfer.voided, ...) and the automatic trail of every change
# (finance/audit_trail.py). A fact that was never stored is left out, or shown with its date only and no actor.
# ---------------------------------------------------------------------------------------------------------------------

def _audits_for(db: Session, target_types, target_id) -> list:
    """Audit rows of one record, oldest first. Filtered in the database instead of loading the whole audit log."""
    from models_db import AuditLogDB
    return (db.query(AuditLogDB)
            .filter(AuditLogDB.target_type.in_(list(target_types)), AuditLogDB.target_id == str(target_id))
            .order_by(AuditLogDB.id).all())


def _fmt_change(field: str, change: dict) -> str:
    return f"{field.replace('_', ' ')}: {change.get('from') if change.get('from') is not None else '—'} → " \
           f"{change.get('to') if change.get('to') is not None else '—'}"


def _trail_change_events(db: Session, table: str, entity_id, label: str, skip_fields=frozenset()) -> List[TimelineEvent]:
    """One line per recorded change of a record (the automatic audit trail), with its real actor and time."""
    events = []
    for a in _audits_for(db, [table], entity_id):
        if not (a.action or "").endswith(".updated"):
            continue
        try:
            changes = (json.loads(a.details or "{}") or {}).get("changes") or {}
        except ValueError:
            continue
        shown = {k: v for k, v in changes.items() if k not in skip_fields}
        if not shown:
            continue
        state = shown.get("status")
        events.append(TimelineEvent(
            id=f"audit-{a.id}",
            timestamp=a.timestamp or "",
            event="status_changed" if state and len(shown) == 1 else "updated",
            plain_text=f"{label}: " + "; ".join(_fmt_change(k, v) for k, v in sorted(shown.items())),
            actor=a.actor_email or "",
            state_transition={"from_state": state.get("from"), "to_state": state.get("to")} if state else None,
        ))
    return events


def _payment_events(prefix: str, payments, describe) -> List[TimelineEvent]:
    """Recorded and reversed payments, timed by when they were entered and attributed to who entered them."""
    events = []
    for p in sorted(payments or [], key=lambda x: x.id):
        events.append(TimelineEvent(
            id=f"{prefix}-pay-{p.id}",
            timestamp=_ts(p.created_at) or str(p.payment_date),
            event="payment_recorded",
            plain_text=describe(p),
            actor=p.created_by or "",
            linked_record={"entity_type": "payment", "entity_id": p.id, "title": f"Payment #{p.id}"},
        ))
        if p.is_reversed:
            label = "Refund" if p.reversal_kind == "refund" else "Reversal"
            note = f"{label} of payment #{p.id} ({p.amount:,.2f} {p.currency})"
            if p.reversal_reason:
                note += f": {p.reversal_reason}"
            events.append(TimelineEvent(
                id=f"{prefix}-pay-{p.id}-reversed",
                timestamp=_ts(p.reversed_at) or str(p.reversal_date or p.payment_date),
                event="payment_reversed",
                plain_text=note,
                actor=p.reversed_by or "",
                linked_record={"entity_type": "payment", "entity_id": p.id, "title": f"Payment #{p.id}"},
            ))
    return events


def _build_bill_timeline(db: Session, bill: BillDB, vendor_name: str) -> List[TimelineEvent]:
    """Bills write a named audit entry for every action (bill.created, bill.approve, bill.payment_recorded, bill.void,
    ...: who, when, from -> to, reason). Those are the timeline. The stored columns fill in only what has no entry,
    which is the case for bills recorded before the entries existed."""
    rows = _audits_for(db, ["bill"], bill.id)
    actions = {a.action for a in rows}
    events: List[TimelineEvent] = []
    for a in rows:
        action = a.action or "audit_action"
        transition = None
        details = a.details or ""
        if "->" in details:
            frm, _, rest = details.partition("->")
            to = rest.split(";")[0].strip()
            transition = {"from_state": None if frm.strip() in ("", "-") else frm.strip(),
                          "to_state": None if to in ("", "-") else to}
        if action == "bill.created":
            label = f"Vendor bill {bill.bill_number or 'draft'} received from {vendor_name} for {bill.total:,.2f} {bill.currency}"
        else:
            label = "Bill " + action.split(".", 1)[-1].replace("_", " ")
        events.append(TimelineEvent(
            id=f"audit-{a.id}",
            timestamp=a.timestamp or "",
            event=action,
            plain_text=f"{label} ({details})" if details else label,
            actor=a.actor_email or "",
            state_transition=transition,
        ))

    if "bill.created" not in actions:
        born = "approved" if (bill.approval_status or "") == "auto" else "draft"
        events.append(TimelineEvent(
            id=f"bill-{bill.id}-created",
            timestamp=_ts(bill.created_at) or str(bill.issue_date or ""),
            event="created",
            plain_text=f"Vendor bill {bill.bill_number or 'draft'} received from {vendor_name} for {bill.total:,.2f} {bill.currency}",
            actor=bill.created_by or "",
            state_transition={"from_state": None, "to_state": born},
        ))
    if not actions & {"bill.payment_recorded", "bill.payment_reversed"}:
        events += _payment_events(f"bill-{bill.id}", bill.payments,
                                  lambda p: f"Payment of {p.amount:,.2f} {p.currency} to {vendor_name} on {p.payment_date}")
    if bill.status == "void" and "bill.void" not in actions:
        reason = f": {bill.void_reason}" if bill.void_reason else ""
        events.append(TimelineEvent(
            id=f"bill-{bill.id}-void",
            timestamp=_ts(bill.voided_at),
            event="voided",
            plain_text=f"Vendor bill {bill.bill_number or ''} voided{reason}".replace("  ", " "),
            actor=bill.voided_by or "",
            state_transition={"from_state": None, "to_state": "void"},
        ))
    events.sort(key=lambda e: (e.timestamp == "", e.timestamp))  # a fact with no stored time goes last
    return events


# Fields of a transfer whose change the void line already explains
_TRANSFER_VOID_FIELDS = frozenset({"voided_at", "voided_by", "void_reason", "settlement_status"})


def _build_transfer_timeline(db: Session, trf: AccountTransferDB, from_name: str, to_name: str) -> List[TimelineEvent]:
    events = [TimelineEvent(
        id=f"trf-{trf.id}-init",
        timestamp=_ts(trf.created_at) or str(trf.date),
        event="created",
        plain_text=f"Account transfer initiated: {trf.from_amount:,.2f} {trf.from_currency} from {from_name} to {to_name} on {trf.date}",
        actor=trf.created_by or "",
        state_transition=None,
    )]
    voided = bool(trf.voided_at)
    events += _trail_change_events(db, "finance_account_transfers", trf.id, "Transfer updated",
                                   skip_fields=_TRANSFER_VOID_FIELDS if voided else frozenset())
    if voided:
        reason = f": {trf.void_reason}" if trf.void_reason else ""
        events.append(TimelineEvent(
            id=f"trf-{trf.id}-void",
            timestamp=_ts(trf.voided_at),
            event="voided",
            plain_text=f"Transfer voided and its ledger rows removed{reason}",
            actor=trf.voided_by or "",
            state_transition={"from_state": None, "to_state": "voided"},
        ))
    events.sort(key=lambda e: (e.timestamp, 0 if e.event == "created" else 1))
    return events


def _build_cheque_timeline(db: Session, chq: FinanceChequeDB, acc_name: str) -> List[TimelineEvent]:
    events = [TimelineEvent(
        id=f"chq-{chq.id}-issued",
        timestamp=_ts(chq.created_at) or str(chq.issue_date),
        event="issued",
        plain_text=f"Cheque #{chq.cheque_number} issued to {chq.payee} for {chq.amount:,.2f} {chq.currency}, dated {chq.issue_date}",
        actor=chq.created_by or "",
        state_transition={"from_state": None, "to_state": "issued"},
    )]
    changes = _trail_change_events(db, "finance_cheques", chq.id, "Cheque updated")
    events += changes
    # Older cheques have no recorded change: the stored clear date is the only fact, shown without a time or person.
    if chq.status == "cleared" and chq.clear_date and not any(e.state_transition for e in changes):
        events.append(TimelineEvent(
            id=f"chq-{chq.id}-cleared",
            timestamp=str(chq.clear_date),
            event="cleared",
            plain_text=f"Cheque #{chq.cheque_number} cleared through {acc_name} (clear date {chq.clear_date})",
            actor="",
            state_transition={"from_state": "issued", "to_state": "cleared"},
        ))
    events.sort(key=lambda e: e.timestamp)
    return events


# Read key required to view each entity type's activity
ENTITY_READ_PERMISSIONS = {
    "invoice": "finance.invoice.read",
    "sales_invoice": "finance.invoice.read",
    "invoices": "finance.invoice.read",
    "bill": "finance.bill.read",
    "bills": "finance.bill.read",
    "vendor_bill": "finance.bill.read",
    "transfer": "finance.account.read",
    "transfers": "finance.account.read",
    "account_transfer": "finance.account.read",
    "cheque": "finance.account.read",
    "cheques": "finance.account.read",
    "transaction": "finance.account.read",
    "transactions": "finance.account.read",
    "ledger": "finance.account.read",
    "customer": "finance.customer.read",
    "customers": "finance.customer.read",
    "vendor": "finance.vendor.read",
    "vendors": "finance.vendor.read",
    "subscription": "finance.subscription.read",
    "subscriptions": "finance.subscription.read",
}


def require_entity_read_permission(
    entity_type: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Dependency: rejects unknown entity types (400) and applies the per-entity read key (403)."""
    norm_type = entity_type.lower().strip()
    req_perm = ENTITY_READ_PERMISSIONS.get(norm_type)
    if req_perm is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported entity type for activity drawer: '{entity_type}'",
        )
    perms = get_current_user_permissions(request, current_user=current_user, db=db)
    if not bool(current_user.get("is_super_admin")) and req_perm not in perms:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: '{req_perm}' required to view {entity_type} activity",
        )
    return current_user


require_entity_read_permission.hrflow_permission_any = tuple(sorted(set(ENTITY_READ_PERMISSIONS.values())))


@router.get("/{entity_type}/{entity_id}", response_model=EntityActivityResponse)
def get_entity_activity(
    entity_type: str,
    entity_id: int,
    request: Request,
    current_user: dict = Depends(require_entity_read_permission),
    db: Session = Depends(get_db),
):
    """
    Returns the comprehensive detail summary, related records, attachments, and chronological
    plain-language activity timeline for a financial entity. Masking sensitive fields unless admin.
    """
    perms = get_current_user_permissions(request, current_user=current_user, db=db)
    is_admin = bool(current_user.get("is_super_admin"))

    norm_type = entity_type.lower().strip()

    # 1. Sales Invoice
    if norm_type in ("invoice", "sales_invoice", "invoices"):
        inv = db.query(SalesInvoiceDB).filter(SalesInvoiceDB.id == entity_id).first()
        if not inv:
            raise HTTPException(status_code=404, detail=f"Invoice #{entity_id} not found")

        acc_name = inv.expected_bank_account.account_name if inv.expected_bank_account else "—"
        cust_name = inv.customer.name if inv.customer else "—"
        cust_tax_id = inv.customer.tax_id if inv.customer else ""

        paid_sum = inv_status.settled_amount(inv.payments)
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
            derived_status = inv.status
            next_action = f"Send Payment Reminder ({days_overdue}d overdue)"
        elif paid_sum > 0:
            derived_status = inv.status
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
                title=f"Payment #{p.id} ({p.method})" + (" [REVERSED]" if p.is_reversed else ""),
                badge=(
                    f"{'Refunded' if p.reversal_kind == 'refund' else 'Reversed'} on {p.reversal_date}"
                    if p.is_reversed and p.reversal_date else f"Paid into {bank_name}"
                ),
                amount=p.amount,
                currency=p.currency,
                date=p.payment_date,
                is_reversed=bool(p.is_reversed),
                reversal_date=p.reversal_date,
                reversal_kind=p.reversal_kind,
                reversal_reason=p.reversal_reason,
            ))

        # Build timeline
        timeline = _build_invoice_timeline(db, inv, cust_name)

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

        timeline = _build_bill_timeline(db, bill, vendor_name)

        bill_attachments = []
        if bill.attachment_name or bill.attachment_url:
            file_name = bill.attachment_name or "bill_document"
            file_size = 0
            if bill.attachment_url:
                try:
                    file_size = os.path.getsize(file_layout.resolve_path(bill.attachment_url, must_exist=True))
                except (OSError, ValueError):
                    pass
            bill_attachments.append(FinanceAttachmentResponse(
                id=bill.id,
                file_name=file_name,
                file_size=file_size,
                mime_type="application/pdf" if file_name.lower().endswith(".pdf") else "application/octet-stream",
                storage_ref=f"/api/finance/bills/{bill.id}/attachment",
                uploaded_at=bill.created_at,
                uploaded_by=bill.created_by,
            ))

        return EntityActivityResponse(
            entity_type="bill",
            entity_id=bill.id,
            title=f"Bill {bill.bill_number}",
            status=bill.status,
            summary=summary,
            related_records=related,
            attachments=bill_attachments,
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
            status=trf.settlement_status or "settled",
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

        timeline = _build_transfer_timeline(db, trf, from_name, to_name)

        return EntityActivityResponse(
            entity_type="transfer",
            entity_id=trf.id,
            title=f"Transfer TRF-{trf.id:04d}",
            status=trf.settlement_status or "settled",
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

        timeline = _build_cheque_timeline(db, chq, acc_name)

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

        timeline = [
            TimelineEvent(
                id=f"tx-{tx.id}-posted",
                timestamp=_ts(tx.created_at) or str(tx.date),
                event="posted",
                plain_text=f"Transaction #{tx.id} posted to {acc_name}: {tx.direction.upper()} of {tx.amount:,.2f} {tx.currency} dated {tx.date}",
                actor=tx.created_by or "",
                state_transition=None,
            )
        ]
        # Every later change with who and when (edits, links to a bill or invoice); balances are not changes
        timeline += _trail_change_events(db, "finance_ledger_transactions", tx.id, "Transaction updated")
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
            inv_paid = inv_status.settled_amount(valid_payments)
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

            derived_status = "void" if is_void else ("paid" if inv_balance <= 0.001 and float(inv.total) > 0 else (inv.status or "sent"))

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

            # Issued when it was sent (sent_at/sent_by); a draft shows when it was created; older invoices sent
            # before sent_at was stored show their issue date with no time and no person.
            if inv.sent_at or (inv.status or "") != "draft":
                timeline.append(TimelineEvent(
                    id=f"inv-{inv.id}-issued",
                    timestamp=_ts(inv.sent_at) or str(inv.issue_date or ""),
                    event="invoice_issued",
                    plain_text=f"Invoice {inv.invoice_number} issued for {inv.currency} {float(inv.total):,.2f} (issue date {inv.issue_date})",
                    actor=inv.sent_by or "",
                ))
            else:
                timeline.append(TimelineEvent(
                    id=f"inv-{inv.id}-created",
                    timestamp=_ts(inv.created_at) or str(inv.issue_date or ""),
                    event="invoice_created",
                    plain_text=f"Draft invoice {inv.invoice_number} created for {inv.currency} {float(inv.total):,.2f}",
                    actor=inv.created_by or "",
                ))
            timeline += _payment_events(
                f"inv-{inv.id}", inv.payments,
                lambda p, n=inv.invoice_number: f"Payment of {p.currency} {float(p.amount):,.2f} received {p.payment_date} on invoice {n} (Ref: {p.reference or 'N/A'})",
            )

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
        open_bills = [b for b in bills if str(b.status).lower() in ("approved", "scheduled", "partially_paid")]
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
                timestamp=_ts(b.created_at) or str(b.issue_date or ""),
                event="bill_received",
                plain_text=f"Bill {b.bill_number or 'draft'} recorded for {b.currency} {float(b.total or 0.0):,.2f} (now {b_status})",
                actor=b.created_by or "",
            ))

        # Payment instructions info
        can_reveal = is_admin or ("finance.vendor_payment.reveal" in perms)
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


