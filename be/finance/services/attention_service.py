"""
be/finance/services/attention_service.py
Needs-Attention Queue Service for Finance Module (Story 2.2).
Aggregates overdue receivables, bills due, pending approvals, unreconciled statement lines,
bounced cheques, and negative cash balances with deterministic priority rules and strict RBAC filtering.
"""
from typing import Dict, Any, List, Optional, Set
from datetime import datetime
from sqlalchemy.orm import Session

from finance.models import (
    FinanceBankAccountDB,
    SalesInvoiceDB,
    BillDB,
    AccountTransferDB,
    PayrollRunDB,
    BankStatementImportDB,
    FinanceChequeDB,
    FinanceAttentionReviewDB,
    StatutoryObligationDB,
)
from finance.schemas import AttentionItem, AttentionQueueResponse


class AttentionQueueService:
    def __init__(self, db: Session):
        self.db = db

    def get_attention_queue(
        self,
        current_user: dict,
        user_permissions: Set[str],
        severity: str = "all",
        item_type: str = "all",
        owner: Optional[str] = None,
        search: Optional[str] = None,
        include_reviewed: bool = False,
        limit: int = 50,
    ) -> AttentionQueueResponse:
        """
        Gathers attention exceptions across authorized finance domains,
        applying deterministic priority scoring and permission redaction.
        """
        is_admin = (
            current_user.get("role") == "admin"
            or "*" in user_permissions
            or "admin" in user_permissions
        )

        can_invoices = is_admin or "finance.invoice.read" in user_permissions
        can_bills = is_admin or "finance.bill.read" in user_permissions
        can_accounts = is_admin or "finance.account.read" in user_permissions
        can_transfers = is_admin or "finance.transfer.read" in user_permissions
        can_payroll = is_admin or "finance.payroll.read" in user_permissions
        can_statements = is_admin or "finance.statement.read" in user_permissions
        can_cheques = is_admin or "finance.cheque.read" in user_permissions or "finance.report.read" in user_permissions
        can_statutory = is_admin or "finance.spend.read" in user_permissions or "finance.bill.read" in user_permissions

        # 1. Fetch reviewed items
        reviewed_query = self.db.query(FinanceAttentionReviewDB).all()
        reviewed_dict: Dict[str, FinanceAttentionReviewDB] = {
            r.deduplication_key: r
            for r in reviewed_query
            if r.status in ("reviewed", "resolved", "dismissed")
        }

        today = datetime.utcnow().date()
        today_str = today.strftime("%Y-%m-%d")

        raw_items: List[AttentionItem] = []

        # ----------------------------------------------------
        # Domain 1: Negative Cash Balances (Urgent Overdraft)
        # ----------------------------------------------------
        if can_accounts:
            accounts = (
                self.db.query(FinanceBankAccountDB)
                .filter(FinanceBankAccountDB.is_active == True)
                .all()
            )
            for acc in accounts:
                if acc.current_balance is not None and acc.current_balance < 0:
                    key = f"account:{acc.id}:negative_balance"
                    is_rev = key in reviewed_dict
                    if not include_reviewed and is_rev:
                        continue
                    overdraft_amount = round(abs(acc.current_balance), 2)
                    raw_items.append(
                        AttentionItem(
                            id=f"cash-acc-{acc.id}",
                            deduplication_key=key,
                            type="negative_cash",
                            severity="urgent",
                            severity_label="Urgent",
                            title=f"Negative Balance: {acc.account_name}",
                            description=f"Account '{acc.account_name}' has an overdraft balance of {overdraft_amount:,.2f} {acc.currency}. Immediate funding or transfer required.",
                            counterparty=acc.bank_name or "Cash Drawer",
                            amount=overdraft_amount,
                            currency=acc.currency,
                            due_date=today_str,
                            due_state="immediate",
                            due_state_label="Action Required (Negative Cash)",
                            owner=None,
                            target_route="a-finance-accounts",
                            target_id=acc.id,
                            target_filter={"is_active": "true"},
                            permission="finance.account.read",
                            priority_score=110 + int(min(overdraft_amount / 1000, 20)),
                            can_resolve=True,
                            can_mark_reviewed=True,
                            is_reviewed=is_rev,
                            created_at=acc.created_at.isoformat() if acc.created_at else None,
                        )
                    )

        # ----------------------------------------------------
        # Domain 2: Bounced Cheques
        # ----------------------------------------------------
        if can_cheques:
            bounced_cheques = (
                self.db.query(FinanceChequeDB)
                .filter(FinanceChequeDB.status == "bounced")
                .all()
            )
            for chq in bounced_cheques:
                key = f"cheque:{chq.id}:bounced"
                is_rev = key in reviewed_dict
                if not include_reviewed and is_rev:
                    continue
                raw_items.append(
                    AttentionItem(
                        id=f"cheque-{chq.id}",
                        deduplication_key=key,
                        type="bounced_cheque",
                        severity="urgent",
                        severity_label="Urgent",
                        title=f"Bounced Cheque #{chq.cheque_number}",
                        description=f"Cheque #{chq.cheque_number} payable to {chq.payee} has bounced. Review bank reason and reissue or void.",
                        counterparty=chq.payee,
                        amount=round(chq.amount, 2),
                        currency=chq.currency,
                        due_date=chq.clear_date or chq.issue_date,
                        due_state="bounced",
                        due_state_label="Bounced Cheque",
                        owner=chq.created_by,
                        target_route="a-finance-cheques",
                        target_id=chq.id,
                        target_filter={"status": "bounced"},
                        permission="finance.cheque.read",
                        priority_score=105,
                        can_resolve=True,
                        can_mark_reviewed=True,
                        is_reviewed=is_rev,
                        created_at=chq.created_at.isoformat() if chq.created_at else None,
                    )
                )

        # ----------------------------------------------------
        # Domain 3: Overdue Receivables (Sales Invoices)
        # ----------------------------------------------------
        if can_invoices:
            invoices = (
                self.db.query(SalesInvoiceDB)
                .filter(~SalesInvoiceDB.status.in_(["void", "paid", "draft"]))
                .all()
            )
            for inv in invoices:
                # Sum payments
                paid_total = sum((p.amount or 0.0) for p in (inv.payments or []))
                balance = round((inv.total or 0.0) - paid_total, 2)
                if balance <= 0:
                    continue

                is_overdue = inv.status == "overdue"
                days_overdue = 0
                if inv.due_date:
                    try:
                        due_dt = datetime.strptime(inv.due_date, "%Y-%m-%d").date()
                        if due_dt < today:
                            is_overdue = True
                            days_overdue = (today - due_dt).days
                    except Exception:
                        pass

                if is_overdue:
                    key = f"invoice:{inv.id}:overdue"
                    is_rev = key in reviewed_dict
                    if not include_reviewed and is_rev:
                        continue
                    days_overdue = max(days_overdue, 1)
                    sev = "urgent" if days_overdue >= 7 else "warning"
                    cust_name = inv.customer.name if inv.customer else "Customer"
                    raw_items.append(
                        AttentionItem(
                            id=f"rec-inv-{inv.id}",
                            deduplication_key=key,
                            type="overdue_receivable",
                            severity=sev,
                            severity_label=sev.capitalize(),
                            title=f"Overdue Invoice: {inv.invoice_number}",
                            description=f"Invoice {inv.invoice_number} to {cust_name} is overdue by {days_overdue} day(s). Outstanding balance: {balance:,.2f} {inv.currency}.",
                            counterparty=cust_name,
                            amount=balance,
                            currency=inv.currency,
                            due_date=inv.due_date,
                            due_state="overdue",
                            due_state_label=f"Overdue by {days_overdue}d",
                            owner=inv.customer.contact_email if inv.customer else None,
                            target_route="a-finance-invoices",
                            target_id=inv.id,
                            target_filter={"status": "overdue", "invoice_id": inv.id},
                            permission="finance.invoice.read",
                            priority_score=90 + min(days_overdue, 20),
                            can_resolve=True,
                            can_mark_reviewed=True,
                            is_reviewed=is_rev,
                            created_at=inv.created_at.isoformat() if inv.created_at else None,
                        )
                    )

        # ----------------------------------------------------
        # Domain 4: Vendor Bills Due & Overdue
        # ----------------------------------------------------
        if can_bills:
            bills = (
                self.db.query(BillDB)
                .filter(~BillDB.status.in_(["void", "paid"]))
                .all()
            )
            for bill in bills:
                paid_total = sum((p.amount or 0.0) for p in (bill.payments or []))
                balance = round((bill.total or 0.0) - paid_total, 2)
                if balance <= 0:
                    continue

                vend_name = bill.vendor.name if bill.vendor else "Vendor"
                key = f"bill:{bill.id}:due"
                is_rev = key in reviewed_dict
                if not include_reviewed and is_rev:
                    continue

                diff = 0
                is_overdue = bill.status == "overdue"
                if bill.due_date:
                    try:
                        due_dt = datetime.strptime(bill.due_date, "%Y-%m-%d").date()
                        diff = (due_dt - today).days
                        if diff < 0:
                            is_overdue = True
                    except Exception:
                        pass

                if is_overdue or diff < 0:
                    days_overdue = max(abs(diff), 1)
                    raw_items.append(
                        AttentionItem(
                            id=f"bill-{bill.id}",
                            deduplication_key=key,
                            type="bill_due",
                            severity="urgent",
                            severity_label="Urgent",
                            title=f"Overdue Bill: {bill.bill_number}",
                            description=f"Bill {bill.bill_number} from {vend_name} is overdue by {days_overdue} day(s). Payable balance: {balance:,.2f} {bill.currency}.",
                            counterparty=vend_name,
                            amount=balance,
                            currency=bill.currency,
                            due_date=bill.due_date,
                            due_state="overdue",
                            due_state_label=f"Overdue by {days_overdue}d",
                            owner=bill.vendor.contact_email if bill.vendor else None,
                            target_route="a-finance-bills",
                            target_id=bill.id,
                            target_filter={"bill_id": bill.id},
                            permission="finance.bill.read",
                            priority_score=85 + min(days_overdue, 15),
                            can_resolve=True,
                            can_mark_reviewed=True,
                            is_reviewed=is_rev,
                            created_at=bill.created_at.isoformat() if bill.created_at else None,
                        )
                    )
                elif diff <= 3:
                    sev = "warning" if diff <= 1 else "info"
                    due_label = "Due today" if diff == 0 else f"Due in {diff}d"
                    due_state = "due_today" if diff == 0 else "due_soon"
                    raw_items.append(
                        AttentionItem(
                            id=f"bill-{bill.id}",
                            deduplication_key=key,
                            type="bill_due",
                            severity=sev,
                            severity_label=sev.capitalize(),
                            title=f"Bill Payment Due: {bill.bill_number}",
                            description=f"Bill {bill.bill_number} from {vend_name} is {due_label}. Payable balance: {balance:,.2f} {bill.currency}.",
                            counterparty=vend_name,
                            amount=balance,
                            currency=bill.currency,
                            due_date=bill.due_date,
                            due_state=due_state,
                            due_state_label=due_label,
                            owner=bill.vendor.contact_email if bill.vendor else None,
                            target_route="a-finance-bills",
                            target_id=bill.id,
                            target_filter={"bill_id": bill.id},
                            permission="finance.bill.read",
                            priority_score=70 + (3 - diff),
                            can_resolve=True,
                            can_mark_reviewed=True,
                            is_reviewed=is_rev,
                            created_at=bill.created_at.isoformat() if bill.created_at else None,
                        )
                    )

        # ----------------------------------------------------
        # Domain 5: Incomplete Account Transfers
        # ----------------------------------------------------
        if can_transfers:
            transfers = (
                self.db.query(AccountTransferDB)
                .filter(AccountTransferDB.confirmed_leg != "both")
                .all()
            )
            for tr in transfers:
                key = f"transfer:{tr.id}:incomplete"
                is_rev = key in reviewed_dict
                if not include_reviewed and is_rev:
                    continue
                from_name = tr.from_account.account_name if tr.from_account else "Source"
                to_name = tr.to_account.account_name if tr.to_account else "Destination"
                raw_items.append(
                    AttentionItem(
                        id=f"transfer-{tr.id}",
                        deduplication_key=key,
                        type="pending_approval",
                        severity="warning",
                        severity_label="Warning",
                        title=f"Incomplete Transfer #{tr.id}",
                        description=f"Transfer of {tr.from_amount:,.2f} {tr.from_currency} from '{from_name}' to '{to_name}' has confirmed leg '{tr.confirmed_leg}'. Second leg requires confirmation.",
                        counterparty=f"{from_name} \u2192 {to_name}",
                        amount=round(tr.from_amount, 2),
                        currency=tr.from_currency,
                        due_date=tr.date,
                        due_state="pending_review",
                        due_state_label="Pending Second Leg",
                        owner=tr.created_by,
                        target_route="a-finance-transfers",
                        target_id=tr.id,
                        target_filter={"transfer_id": tr.id},
                        permission="finance.transfer.read",
                        priority_score=75,
                        can_resolve=True,
                        can_mark_reviewed=True,
                        is_reviewed=is_rev,
                        created_at=tr.created_at.isoformat() if tr.created_at else None,
                    )
                )

        # ----------------------------------------------------
        # Domain 6: Draft Payroll Runs
        # ----------------------------------------------------
        if can_payroll:
            payroll_drafts = (
                self.db.query(PayrollRunDB)
                .filter(PayrollRunDB.status == "draft")
                .all()
            )
            for run in payroll_drafts:
                key = f"payroll:{run.id}:draft"
                is_rev = key in reviewed_dict
                if not include_reviewed and is_rev:
                    continue
                raw_items.append(
                    AttentionItem(
                        id=f"payroll-{run.id}",
                        deduplication_key=key,
                        type="pending_approval",
                        severity="warning",
                        severity_label="Warning",
                        title=f"Payroll Run Draft: {run.period_label}",
                        description=f"Payroll run for {run.period_label} is in draft status. Total net pay of {run.total_net:,.2f} USD is awaiting review and approval.",
                        counterparty="Staff Payroll",
                        amount=round(run.total_net, 2),
                        currency="USD",
                        due_date=run.period_end,
                        due_state="pending_review",
                        due_state_label="Awaiting Approval",
                        owner=None,
                        target_route="a-finance-payroll",
                        target_id=run.id,
                        target_filter={"run_id": run.id},
                        permission="finance.payroll.read",
                        priority_score=70,
                        can_resolve=True,
                        can_mark_reviewed=True,
                        is_reviewed=is_rev,
                        created_at=run.created_at.isoformat() if run.created_at else None,
                    )
                )

        # ----------------------------------------------------
        # Domain 7: Unreconciled Statement Imports
        # ----------------------------------------------------
        if can_statements:
            imports = (
                self.db.query(BankStatementImportDB)
                .filter(BankStatementImportDB.status.in_(["parsing", "needs_review"]))
                .all()
            )
            for imp in imports:
                unmatched_lines = [l for l in (imp.lines or []) if l.status == "unmatched"]
                unmatched_count = len(unmatched_lines) if imp.lines else max(imp.total_lines_count - imp.matched_lines_count, 1)
                if unmatched_count <= 0 and imp.status != "needs_review":
                    continue

                key = f"statement:{imp.id}:unmatched"
                is_rev = key in reviewed_dict
                if not include_reviewed and is_rev:
                    continue

                acc_name = imp.account.account_name if imp.account else "Bank Account"
                curr = imp.account.currency if imp.account else "USD"
                sum_unmatched = sum(l.raw_amount for l in unmatched_lines) if unmatched_lines else None

                raw_items.append(
                    AttentionItem(
                        id=f"stmt-{imp.id}",
                        deduplication_key=key,
                        type="unreconciled_statement",
                        severity="warning",
                        severity_label="Warning",
                        title=f"Unreconciled Statement: {acc_name} ({imp.period_month})",
                        description=f"Statement import for {imp.period_month} contains {unmatched_count} unmatched statement line(s) requiring ledger matching.",
                        counterparty=acc_name,
                        amount=round(sum_unmatched, 2) if sum_unmatched else None,
                        currency=curr,
                        due_date=imp.created_at.strftime("%Y-%m-%d") if imp.created_at else None,
                        due_state="needs_reconciliation",
                        due_state_label=f"{unmatched_count} Unmatched Lines",
                        owner=imp.created_by,
                        target_route="a-finance-statements",
                        target_id=imp.id,
                        target_filter={"import_id": imp.id},
                        permission="finance.statement.read",
                        priority_score=65,
                        can_resolve=True,
                        can_mark_reviewed=True,
                        is_reviewed=is_rev,
                        created_at=imp.created_at.isoformat() if imp.created_at else None,
                    )
                )

        # ----------------------------------------------------
        # Domain 8: Subscriptions & Recurring Spend (Story 4.4)
        # ----------------------------------------------------
        can_subscriptions = is_admin or "finance.subscription.read" in user_permissions
        if can_subscriptions:
            from finance.models import SubscriptionDB
            from datetime import timedelta
            active_subs = (
                self.db.query(SubscriptionDB)
                .filter(SubscriptionDB.is_active == True)
                .all()
            )
            for sub in active_subs:
                # 1. Renewal deadline approaching
                if sub.next_renewal_date:
                    try:
                        ren_dt = datetime.strptime(sub.next_renewal_date, "%Y-%m-%d").date()
                        notice_days = sub.notice_period_days if sub.notice_period_days is not None else 30
                        notice_dt = ren_dt - timedelta(days=notice_days)
                        if today >= notice_dt:
                            key = f"subscription:{sub.id}:renewal_due"
                            is_rev = key in reviewed_dict
                            if include_reviewed or not is_rev:
                                days_left = (ren_dt - today).days
                                sev = "urgent" if days_left <= 7 else "warning"
                                raw_items.append(
                                    AttentionItem(
                                        id=f"sub-ren-{sub.id}",
                                        deduplication_key=key,
                                        type="subscription_renewal",
                                        severity=sev,
                                        severity_label="Urgent" if sev == "urgent" else "Warning",
                                        title=f"Renewal Notice: {sub.name}",
                                        description=f"Subscription '{sub.name}' renews on {sub.next_renewal_date} ({days_left} days left). Notice deadline {notice_dt.strftime('%Y-%m-%d')} reached.",
                                        counterparty=sub.vendor.name if sub.vendor else "Vendor",
                                        amount=sub.amount,
                                        currency=sub.currency,
                                        due_date=sub.next_renewal_date,
                                        due_state="overdue" if days_left < 0 else "due_soon",
                                        due_state_label=f"Renews in {days_left}d",
                                        owner=sub.owner,
                                        target_route="a-finance-subscriptions",
                                        target_id=sub.id,
                                        target_filter={"subscription_id": sub.id},
                                        permission="finance.subscription.read",
                                        priority_score=80 if sev == "urgent" else 60,
                                        can_resolve=True,
                                        can_mark_reviewed=True,
                                        is_reviewed=is_rev,
                                        created_at=sub.created_at.isoformat() if sub.created_at else None,
                                    )
                                )
                    except Exception:
                        pass

                # 2. Missing owner alert
                if not sub.owner:
                    key = f"subscription:{sub.id}:missing_owner"
                    is_rev = key in reviewed_dict
                    if include_reviewed or not is_rev:
                        raw_items.append(
                            AttentionItem(
                                id=f"sub-owner-{sub.id}",
                                deduplication_key=key,
                                type="subscription_governance",
                                severity="info",
                                severity_label="Info",
                                title=f"Missing Owner: {sub.name}",
                                description=f"Subscription '{sub.name}' does not have an assigned DRI/owner.",
                                counterparty=sub.vendor.name if sub.vendor else "Vendor",
                                amount=sub.amount,
                                currency=sub.currency,
                                due_date=today_str,
                                due_state="immediate",
                                due_state_label="Unassigned",
                                owner=None,
                                target_route="a-finance-subscriptions",
                                target_id=sub.id,
                                target_filter={"subscription_id": sub.id},
                                permission="finance.subscription.read",
                                priority_score=40,
                                can_resolve=True,
                                can_mark_reviewed=True,
                                is_reviewed=is_rev,
                                created_at=sub.created_at.isoformat() if sub.created_at else None,
                            )
                        )

        # ----------------------------------------------------
        # Domain 10: Statutory Obligations (Unconfirmed / Unremitted)
        # ----------------------------------------------------
        if can_statutory:
            open_obligations = (
                self.db.query(StatutoryObligationDB)
                .filter(StatutoryObligationDB.status.in_(["estimated", "accrued", "partially_remitted"]))
                .all()
            )
            for obl in open_obligations:
                key = f"statutory:{obl.id}:{obl.status}"
                is_rev = key in reviewed_dict
                if not include_reviewed and is_rev:
                    continue

                type_label = obl.obligation_type.replace("_", " ").title()
                rem = max(0.0, round(obl.amount_accrued - (obl.amount_remitted or 0.0), 2))

                is_overdue = False
                days_diff = 0
                if obl.due_date:
                    try:
                        due_d = datetime.strptime(obl.due_date[:10], "%Y-%m-%d").date()
                        days_diff = (today - due_d).days
                        is_overdue = days_diff > 0
                    except Exception:
                        pass

                if obl.status == "estimated":
                    item_severity = "warning"
                    title = f"Unconfirmed Obligation: {type_label} ({obl.period})"
                    desc = f"Payroll-derived estimate of {obl.amount_accrued:,.2f} {obl.currency} for {obl.period} requires confirmation against government portal figures."
                    due_state = "pending_confirmation"
                    due_label = "Requires Portal Confirmation"
                    score = 72
                elif is_overdue:
                    item_severity = "urgent"
                    title = f"Overdue Obligation: {type_label} ({obl.period})"
                    desc = f"Statutory obligation of {rem:,.2f} {obl.currency} is {days_diff} day(s) past due ({obl.due_date}). Immediate remittance required."
                    due_state = "overdue"
                    due_label = f"Overdue by {days_diff}d"
                    score = min(95, 80 + days_diff)
                else:
                    item_severity = "warning"
                    title = f"Pending Remittance: {type_label} ({obl.period})"
                    desc = f"Confirmed statutory obligation of {rem:,.2f} {obl.currency} due on {obl.due_date or 'N/A'} is awaiting remittance."
                    due_state = "due_soon"
                    due_label = f"Due: {obl.due_date or 'N/A'}"
                    score = 68

                raw_items.append(
                    AttentionItem(
                        id=f"statutory-{obl.id}",
                        deduplication_key=key,
                        type="statutory_obligation",
                        severity=item_severity,
                        severity_label=item_severity.title(),
                        title=title,
                        description=desc,
                        counterparty=f"Gov / {type_label}",
                        amount=rem if obl.status != "estimated" else obl.amount_accrued,
                        currency=obl.currency,
                        due_date=obl.due_date or today_str,
                        due_state=due_state,
                        due_state_label=due_label,
                        owner=None,
                        target_route="a-finance-statutory",
                        target_id=obl.id,
                        target_filter={"obligation_id": obl.id},
                        permission="finance.spend.read",
                        priority_score=score,
                        can_resolve=True,
                        can_mark_reviewed=True,
                        is_reviewed=is_rev,
                        created_at=obl.created_at.isoformat() if obl.created_at else None,
                    )
                )

        # ----------------------------------------------------
        # Filtering & Deterministic Priority Ordering
        # ----------------------------------------------------
        filtered: List[AttentionItem] = []
        for item in raw_items:
            if severity != "all" and item.severity.lower() != severity.lower():
                continue
            if item_type != "all" and item.type.lower() != item_type.lower():
                continue
            if owner and item.owner and owner.lower() not in item.owner.lower():
                continue
            if search:
                s = search.lower()
                in_title = s in item.title.lower()
                in_desc = s in item.description.lower()
                in_cp = item.counterparty and s in item.counterparty.lower()
                if not (in_title or in_desc or in_cp):
                    continue
            filtered.append(item)

        # Sort deterministically:
        # 1. priority_score descending
        # 2. amount descending (None treated as 0)
        # 3. id ascending
        filtered.sort(
            key=lambda x: (
                -x.priority_score,
                -(x.amount if x.amount is not None else 0.0),
                x.id,
            )
        )

        # Aggregate metrics
        total_count = len(filtered)
        urgent_count = sum(1 for i in filtered if i.severity == "urgent")
        warning_count = sum(1 for i in filtered if i.severity == "warning")
        info_count = sum(1 for i in filtered if i.severity == "info")

        currency_totals: Dict[str, float] = {}
        for i in filtered:
            if i.amount is not None and i.currency:
                c = i.currency.upper()
                currency_totals[c] = round(currency_totals.get(c, 0.0) + i.amount, 2)

        sliced_items = filtered[:limit]

        return AttentionQueueResponse(
            total_count=total_count,
            urgent_count=urgent_count,
            warning_count=warning_count,
            info_count=info_count,
            total_amount_by_currency=currency_totals,
            items=sliced_items,
            generated_at=datetime.utcnow().isoformat(),
        )

    def review_item(
        self,
        item_key: str,
        status: str = "reviewed",
        reviewed_by: Optional[str] = None,
        notes: str = "",
    ) -> FinanceAttentionReviewDB:
        """Marks an attention item as reviewed or resolved so it disappears from the queue."""
        record = (
            self.db.query(FinanceAttentionReviewDB)
            .filter(FinanceAttentionReviewDB.deduplication_key == item_key)
            .first()
        )
        if not record:
            item_type = item_key.split(":")[0] if ":" in item_key else "general"
            record = FinanceAttentionReviewDB(
                deduplication_key=item_key,
                item_type=item_type,
                status=status,
                reviewed_by=reviewed_by,
                notes=notes or "",
            )
            self.db.add(record)
        else:
            record.status = status
            record.reviewed_by = reviewed_by
            record.reviewed_at = datetime.utcnow()
            if notes:
                record.notes = notes
        self.db.commit()
        self.db.refresh(record)
        return record
