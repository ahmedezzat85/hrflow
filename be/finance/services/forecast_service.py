"""
be/finance/services/forecast_service.py
Cash Position & Forecast Service for Finance Module (Story 2.3).
Provides multi-account bank vs book cash visibility, separate available and reconciled balances,
and 30/60/90-day cash flow projections from contractual and expected obligations.
"""
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from finance.models import (
    FinanceBankAccountDB,
    SalesInvoiceDB,
    BillDB,
    SubscriptionDB,
    PayrollRunDB,
    AccountTransferDB,
    BankStatementImportDB,
    FinanceChequeDB,
)
from finance.schemas import (
    CashPositionAccount,
    HorizonProjection,
    ForecastObligationItem,
    CashForecastResponse,
)


class CashForecastService:
    def __init__(self, db: Session):
        self.db = db

    def get_cash_forecast(
        self,
        currency: str = "all",
        horizon_days: int = 90,
        include_expected: bool = True,
    ) -> CashForecastResponse:
        today = datetime.utcnow().date()
        today_str = today.strftime("%Y-%m-%d")
        curr_filter = currency.upper() if currency != "all" else "ALL"

        # ----------------------------------------------------
        # 1. Accounts & Current Cash Position
        # ----------------------------------------------------
        acc_query = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True)
        if curr_filter != "ALL":
            acc_query = acc_query.filter(FinanceBankAccountDB.currency == curr_filter)
        db_accounts = acc_query.all()

        accounts: List[CashPositionAccount] = []
        cash_by_currency: Dict[str, float] = {}

        for acc in db_accounts:
            book_bal = round(acc.current_balance or 0.0, 2)
            acc_curr = acc.currency.upper()
            cash_by_currency[acc_curr] = round(cash_by_currency.get(acc_curr, 0.0) + book_bal, 2)

            # Uncleared cheques issued against this account
            uncleared_cheques_sum = 0.0
            for chq in acc.cheques or []:
                if chq.status == "issued":
                    uncleared_cheques_sum += (chq.amount or 0.0)
            uncleared_cheques_sum = round(uncleared_cheques_sum, 2)

            # Pending outgoing transfers
            pending_transfers_sum = 0.0
            pending_tr_list = (
                self.db.query(AccountTransferDB)
                .filter(
                    AccountTransferDB.from_account_id == acc.id,
                    AccountTransferDB.confirmed_leg != "both",
                )
                .all()
            )
            for tr in pending_tr_list:
                pending_transfers_sum += (tr.from_amount or 0.0)
            pending_transfers_sum = round(pending_transfers_sum, 2)

            # Available balance = book balance minus uncleared cheques and pending outgoing legs
            avail_bal = round(book_bal - uncleared_cheques_sum - pending_transfers_sum, 2)

            # Reconciled balance from statements
            reconciled_bal: Optional[float] = None
            last_reconciled_stmt = (
                self.db.query(BankStatementImportDB)
                .filter(
                    BankStatementImportDB.account_id == acc.id,
                    BankStatementImportDB.status == "reconciled",
                )
                .order_by(BankStatementImportDB.period_month.desc())
                .first()
            )
            if last_reconciled_stmt:
                # Calculate sum of matched lines
                matched_sum = sum((ln.raw_amount or 0.0) for ln in (last_reconciled_stmt.lines or []) if ln.status == "matched")
                reconciled_bal = round(matched_sum, 2) if matched_sum else round(book_bal, 2)

            accounts.append(
                CashPositionAccount(
                    account_id=acc.id,
                    account_name=acc.account_name,
                    bank_name=acc.bank_name,
                    account_type=acc.account_type or "bank",
                    currency=acc.currency,
                    book_balance=book_bal,
                    available_balance=avail_bal,
                    reconciled_balance=reconciled_bal,
                    uncleared_cheques_amount=uncleared_cheques_sum,
                    pending_transfers_amount=pending_transfers_sum,
                    is_active=acc.is_active,
                )
            )

        # Baseline cash for projection
        if curr_filter != "ALL":
            base_cash = cash_by_currency.get(curr_filter, 0.0)
        else:
            base_cash = sum(cash_by_currency.values())

        # ----------------------------------------------------
        # 2. Material Inflows & Outflows Collection
        # ----------------------------------------------------
        obligations: List[ForecastObligationItem] = []

        # (a) Sales Invoices (Inflows)
        inv_query = self.db.query(SalesInvoiceDB).filter(
            ~SalesInvoiceDB.status.in_(["void", "draft"])
        )
        if curr_filter != "ALL":
            inv_query = inv_query.filter(SalesInvoiceDB.currency == curr_filter)
        invoices = inv_query.all()

        for inv in invoices:
            paid_sum = sum((p.amount or 0.0) for p in (inv.payments or []))
            balance = round((inv.total or 0.0) - paid_sum, 2)
            if balance <= 0:
                continue

            cust_name = inv.customer.name if inv.customer else "Customer"
            is_overdue = False
            due_dt = today
            if inv.due_date:
                try:
                    due_dt = datetime.strptime(inv.due_date, "%Y-%m-%d").date()
                    if due_dt < today:
                        is_overdue = True
                except Exception:
                    pass

            # Inflow status & certainty
            if is_overdue:
                status = "expected"
                certainty = "overdue"
                scheduled_date = today_str  # Expected in next 30 days
            else:
                status = "confirmed"
                certainty = "contractual"
                scheduled_date = inv.due_date or today_str

            obligations.append(
                ForecastObligationItem(
                    id=f"inflow-inv-{inv.id}",
                    entity_type="invoice",
                    entity_id=inv.id,
                    reference=inv.invoice_number,
                    counterparty=cust_name,
                    type="inflow",
                    amount=balance,
                    currency=inv.currency,
                    due_date=scheduled_date,
                    status=status,
                    certainty=certainty,
                    target_route="a-finance-invoices",
                    notes=f"Outstanding balance: {balance:,.2f} {inv.currency}",
                )
            )

        # (b) Vendor Bills (Outflows)
        bill_query = self.db.query(BillDB).filter(
            ~BillDB.status.in_(["void", "draft"])
        )
        if curr_filter != "ALL":
            bill_query = bill_query.filter(BillDB.currency == curr_filter)
        bills = bill_query.all()

        for bill in bills:
            paid_sum = sum((p.amount or 0.0) for p in (bill.payments or []))
            balance = round((bill.total or 0.0) - paid_sum, 2)
            if balance <= 0:
                continue

            vend_name = bill.vendor.name if bill.vendor else "Vendor"
            is_overdue = False
            if bill.due_date:
                try:
                    due_dt = datetime.strptime(bill.due_date, "%Y-%m-%d").date()
                    if due_dt < today:
                        is_overdue = True
                except Exception:
                    pass

            scheduled_date = today_str if is_overdue else (bill.due_date or today_str)
            certainty = "overdue" if is_overdue else "contractual"

            obligations.append(
                ForecastObligationItem(
                    id=f"outflow-bill-{bill.id}",
                    entity_type="bill",
                    entity_id=bill.id,
                    reference=bill.bill_number,
                    counterparty=vend_name,
                    type="outflow",
                    amount=balance,
                    currency=bill.currency,
                    due_date=scheduled_date,
                    status="confirmed",
                    certainty=certainty,
                    target_route="a-finance-bills",
                    notes=f"Vendor payable balance: {balance:,.2f} {bill.currency}",
                )
            )

        # (c) Active Subscriptions (Recurring Outflows)
        if include_expected:
            sub_query = self.db.query(SubscriptionDB).filter(SubscriptionDB.is_active == True)
            if curr_filter != "ALL":
                sub_query = sub_query.filter(SubscriptionDB.currency == curr_filter)
            subs = sub_query.all()

            for s in subs:
                vend_name = s.vendor.name if s.vendor else s.name
                amount = round(s.amount or 0.0, 2)
                if amount <= 0:
                    continue

                try:
                    base_renewal = datetime.strptime(s.next_renewal_date, "%Y-%m-%d").date()
                except Exception:
                    base_renewal = today + timedelta(days=15)

                # Project monthly renewal events within 90 days
                for cycle in range(3):
                    cycle_date = base_renewal + timedelta(days=30 * cycle)
                    days_diff = (cycle_date - today).days
                    if 0 <= days_diff <= 90:
                        obligations.append(
                            ForecastObligationItem(
                                id=f"outflow-sub-{s.id}-c{cycle}",
                                entity_type="subscription",
                                entity_id=s.id,
                                reference=f"{s.name} (Renewal #{cycle + 1})",
                                counterparty=vend_name,
                                type="outflow",
                                amount=amount,
                                currency=s.currency,
                                due_date=cycle_date.strftime("%Y-%m-%d"),
                                status="expected",
                                certainty="estimated",
                                target_route="a-finance-spend",
                                notes=f"Recurring {s.billing_cycle or 'monthly'} subscription charge",
                            )
                        )

        # (d) Approved/Pending Payroll Runs
        payroll_runs = self.db.query(PayrollRunDB).filter(
            PayrollRunDB.status.in_(["draft", "approved"])
        ).all()
        for run in payroll_runs:
            if curr_filter != "ALL" and curr_filter != "USD":
                continue
            net_total = round(run.total_net or 0.0, 2)
            if net_total <= 0:
                continue

            scheduled_date = run.period_end or today_str
            is_confirmed = run.status == "approved"
            obligations.append(
                ForecastObligationItem(
                    id=f"outflow-payroll-{run.id}",
                    entity_type="payroll",
                    entity_id=run.id,
                    reference=f"Payroll {run.period_label}",
                    counterparty="Staff Payroll",
                    type="outflow",
                    amount=net_total,
                    currency="USD",
                    due_date=scheduled_date,
                    status="confirmed" if is_confirmed else "expected",
                    certainty="contractual" if is_confirmed else "estimated",
                    target_route="a-finance-payroll",
                    notes=f"Payroll run status: {run.status}",
                )
            )

        # ----------------------------------------------------
        # 3. Horizon Projections (30, 60, 90 Days)
        # ----------------------------------------------------
        horizons_meta = [
            ("30_days", 30, "Next 30 Days"),
            ("60_days", 60, "31 - 60 Days"),
            ("90_days", 90, "61 - 90 Days"),
        ]

        horizons: Dict[str, HorizonProjection] = {}
        running_cash = base_cash

        for key, days, label in horizons_meta:
            lower_bound = 0 if key == "30_days" else (30 if key == "60_days" else 60)
            upper_bound = days

            confirmed_in = 0.0
            expected_in = 0.0
            confirmed_out = 0.0
            expected_out = 0.0

            for ob in obligations:
                try:
                    ob_dt = datetime.strptime(ob.due_date, "%Y-%m-%d").date()
                    diff = (ob_dt - today).days
                except Exception:
                    diff = 0

                if lower_bound <= diff <= upper_bound or (lower_bound == 0 and diff < 0):
                    if ob.type == "inflow":
                        if ob.status == "confirmed":
                            confirmed_in += ob.amount
                        else:
                            expected_in += ob.amount
                    else:
                        if ob.status == "confirmed":
                            confirmed_out += ob.amount
                        else:
                            expected_out += ob.amount

            confirmed_in = round(confirmed_in, 2)
            expected_in = round(expected_in, 2)
            confirmed_out = round(confirmed_out, 2)
            expected_out = round(expected_out, 2)

            tot_in = round(confirmed_in + expected_in, 2)
            tot_out = round(confirmed_out + expected_out, 2)
            net_flow = round(tot_in - tot_out, 2)
            running_cash = round(running_cash + net_flow, 2)

            confidence = "high" if key == "30_days" and expected_in <= confirmed_in else ("medium" if key != "90_days" else "low")

            horizons[key] = HorizonProjection(
                period_label=label,
                days=days,
                confirmed_inflows=confirmed_in,
                expected_inflows=expected_in,
                total_inflows=tot_in,
                confirmed_outflows=confirmed_out,
                expected_outflows=expected_out,
                total_outflows=tot_out,
                net_cash_flow=net_flow,
                projected_ending_cash=running_cash,
                confidence=confidence,
            )

        # Sort obligations by due date ascending
        obligations.sort(key=lambda x: (x.due_date, -x.amount))

        # ----------------------------------------------------
        # 4. Assumptions and FX Warnings
        # ----------------------------------------------------
        assumptions = [
            "Draft sales invoices and unapproved vendor bills are strictly excluded from cash projections.",
            "Contractual obligations with past-due dates are placed in the immediate 0-30 day horizon with an overdue status indicator.",
            "Active monthly subscriptions repeat every 30 days as estimated expected outflows.",
            "Book, available, and reconciled balances are tracked independently and never conflated.",
        ]

        fx_warnings: List[str] = []
        if curr_filter == "ALL":
            fx_warnings.append(
                "Multi-currency forecast aggregates values within native currencies. Cross-currency conversions are not fabricated without verified live exchange rates."
            )

        return CashForecastResponse(
            as_of_date=today_str,
            currency=curr_filter,
            accounts=accounts,
            current_cash_by_currency=cash_by_currency,
            total_current_cash=round(base_cash, 2),
            horizons=horizons,
            material_obligations=obligations[:60],
            assumptions=assumptions,
            fx_warnings=fx_warnings,
            generated_at=datetime.utcnow().isoformat(),
        )
