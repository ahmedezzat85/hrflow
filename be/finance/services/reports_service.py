"""
be/finance/services/reports_service.py
Service layer for financial reporting, aggregation, point-in-time balance calculations,
category spend rollups, and period matrices.
"""
import json
from typing import Dict, Any, List, Optional, Tuple
import calendar
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_

from fastapi import HTTPException, status

from finance.bill_status import OPEN_STATUSES, SPEND_STATUSES
from finance import invoice_status as inv_status
from finance import cash_basis
from finance import books
from finance import year_openings
from finance.models import (
    FinanceAccountYearOpeningDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    FinanceChequeDB,
    SalesInvoiceDB,
    PaymentDB,
    BillDB,
    SubscriptionDB,
    SubscriptionChargeDB,
    FinanceSavedReportViewDB,
    FinanceExportAuditDB,
    FinanceReportScheduleDB,
    PayrollRunDB,
    PayrollLineDB,
    StatutoryObligationDB,
)
from models_db import EmployeeDB
from finance.services.excel_exporter import (
    export_fiscal_year_summary_xlsx,
    export_transactions_xlsx,
    export_category_summary_xlsx,
    export_category_matrix_xlsx,
    export_balances_xlsx,
    export_cheques_xlsx,
    export_profit_and_loss_xlsx,
    export_balance_sheet_xlsx,
    export_trial_balance_xlsx,
    export_cash_flow_xlsx,
    export_aging_xlsx,
    export_report_csv,
    export_flat_xlsx,
    FLAT_REPORTS,
)
from finance.services.payroll_read_service import PayrollReadService


ACCRUAL_PARTIAL_NOTE = "Partial: excludes payroll, statutory and bank fees"


class ReportsService:
    def __init__(self, db: Session):
        self.db = db
        self.payroll_read_service = PayrollReadService(db)

    # ------------------------------------------------------------------
    # Book views (D-028). book omitted = legacy behaviour (all accounts)
    # ------------------------------------------------------------------
    def _scope(self, book: Optional[str]) -> "books.BookScope":
        return books.resolve(self.db, book)

    @staticmethod
    def _invoice_in_scope(scope: "books.BookScope", inv) -> bool:
        return books.invoice_in_scope(scope, inv)

    def _filter_bills(self, scope: "books.BookScope", bills: List[Any]) -> List[Any]:
        return books.filter_bills(self.db, scope, bills)

    # ------------------------------------------------------------------
    # 0. Executive Finance Summary & Trustworthy KPIs
    # ------------------------------------------------------------------
    def get_finance_summary(
        self,
        entity: Optional[str] = "all",
        period: str = "MTD",
        basis: str = "cash",
        currency: str = "USD",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        scope = self._scope(book)
        today = datetime.utcnow().date()
        period_norm = (period or "MTD").upper()
        basis_norm = (basis or "cash").lower()
        curr_norm = (currency or "USD").upper()
        entity_norm = (entity or "all").strip()

        if period_norm == "MTD":
            start_date = today.replace(day=1).strftime("%Y-%m-%d")
        elif period_norm == "QTD":
            q_month = ((today.month - 1) // 3) * 3 + 1
            start_date = today.replace(month=q_month, day=1).strftime("%Y-%m-%d")
        elif period_norm == "YTD":
            start_date = today.replace(month=1, day=1).strftime("%Y-%m-%d")
        elif period_norm == "ALL":
            start_date = None
        else:
            start_date = today.replace(day=1).strftime("%Y-%m-%d")

        end_date = today.strftime("%Y-%m-%d") if start_date else None

        # 1. Total Cash Balance (Book Cash)
        acc_q = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True)
        acc_q = scope.filter(acc_q, FinanceBankAccountDB.id)
        if curr_norm != "ALL":
            acc_q = acc_q.filter(FinanceBankAccountDB.currency == curr_norm)
        if entity_norm.lower() != "all":
            pat = f"%{entity_norm}%"
            acc_q = acc_q.filter(
                or_(
                    FinanceBankAccountDB.account_name.ilike(pat),
                    FinanceBankAccountDB.country.ilike(pat),
                    FinanceBankAccountDB.bank_name.ilike(pat),
                )
            )
        accounts = acc_q.all()
        total_cash = round(sum(float(a.current_balance or 0.0) for a in accounts), 2)
        balance_by_cur: Dict[str, float] = {}
        for a in accounts:
            cur = (a.currency or "USD").upper()
            balance_by_cur[cur] = round(balance_by_cur.get(cur, 0.0) + float(a.current_balance or 0.0), 2)

        # 2. Revenue & Operating Spend, kept per currency: currencies are never added together (D-026)
        per_cur: Dict[str, Dict[str, float]] = {}

        def _bucket(cur: Optional[str]) -> Dict[str, float]:
            return per_cur.setdefault((cur or "USD").upper(), {"revenue": 0.0, "spend": 0.0})

        inter_book_lines: Dict[Tuple[str, str, str], float] = {}

        if basis_norm == "accrual":
            inv_q = self.db.query(SalesInvoiceDB).filter(
                SalesInvoiceDB.status != "void",
                SalesInvoiceDB.status != "draft",
            )
            if start_date:
                inv_q = inv_q.filter(SalesInvoiceDB.issue_date >= start_date)
            if end_date:
                inv_q = inv_q.filter(SalesInvoiceDB.issue_date <= end_date)
            if curr_norm != "ALL":
                inv_q = inv_q.filter(SalesInvoiceDB.currency == curr_norm)
            for i in inv_q.all():
                if not self._invoice_in_scope(scope, i):
                    continue
                _bucket(i.currency)["revenue"] += float(i.subtotal or 0.0)  # net of VAT (D-023)

            bill_q = self.db.query(BillDB).filter(BillDB.status.in_(SPEND_STATUSES))
            if start_date:
                bill_q = bill_q.filter(BillDB.issue_date >= start_date)
            if end_date:
                bill_q = bill_q.filter(BillDB.issue_date <= end_date)
            if curr_norm != "ALL":
                bill_q = bill_q.filter(BillDB.currency == curr_norm)
            for b in self._filter_bills(scope, bill_q.all()):
                _bucket(b.currency)["spend"] += float(b.total or 0.0)
        else:
            # Cash basis: ledger transactions, classified by finance.cash_basis (D-026)
            tx_q = (
                self.db.query(LedgerTransactionDB, TransactionCategoryDB.kind)
                .join(FinanceBankAccountDB, LedgerTransactionDB.account_id == FinanceBankAccountDB.id)
                .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            )
            tx_q = scope.filter(tx_q, LedgerTransactionDB.account_id)
            if start_date:
                tx_q = tx_q.filter(LedgerTransactionDB.date >= start_date)
            if end_date:
                tx_q = tx_q.filter(LedgerTransactionDB.date <= end_date)
            if curr_norm != "ALL":
                tx_q = tx_q.filter(LedgerTransactionDB.currency == curr_norm)
            if entity_norm.lower() != "all":
                pat = f"%{entity_norm}%"
                tx_q = tx_q.filter(
                    or_(
                        FinanceBankAccountDB.account_name.ilike(pat),
                        FinanceBankAccountDB.country.ilike(pat),
                        FinanceBankAccountDB.bank_name.ilike(pat),
                    )
                )
            for t, kind in tx_q.all():
                cls = cash_basis.classify_view(t, kind, has_category=t.category_id is not None, scope=scope)
                if cls:
                    side, signed, label = cls
                    if side in (cash_basis.REVENUE, cash_basis.SPEND):
                        _bucket(t.currency)[side] += signed
                    if label:
                        key = ((t.currency or "USD").upper(), side, label)
                        inter_book_lines[key] = inter_book_lines.get(key, 0.0) + signed

        def _rounded(cur: str, key: str) -> float:
            return round(per_cur.get(cur, {}).get(key, 0.0), 2)

        by_currency = []
        if curr_norm == "ALL":
            for cur in sorted(set(per_cur) | set(balance_by_cur)):
                rev_c, spend_c = _rounded(cur, "revenue"), _rounded(cur, "spend")
                net_c = round(rev_c - spend_c, 2)
                by_currency.append({
                    "currency": cur,
                    "balance": balance_by_cur.get(cur, 0.0),
                    "revenue": rev_c,
                    "cost": spend_c,
                    "net": net_c,
                    "margin_pct": round((net_c / rev_c) * 100, 1) if rev_c > 0 else None,
                    "margin_valid": rev_c > 0,
                })
            revenue = operating_spend = None
        else:
            revenue = _rounded(curr_norm, "revenue")
            operating_spend = _rounded(curr_norm, "spend")

        if curr_norm == "ALL":
            # No converted total: the figures live in by_currency, one entry per currency
            net_result = None
            margin_pct = None
            margin_valid = False
            total_cash = None
        else:
            net_result = round(revenue - operating_spend, 2)
            if revenue > 0:
                margin_pct = round((net_result / revenue) * 100, 1)
                margin_valid = True
            else:
                margin_pct = None
                margin_valid = False

        open_inv_count = self.db.query(SalesInvoiceDB).filter(SalesInvoiceDB.status.in_(["sent", "draft", "partially_paid"])).count()
        unpaid_bills_count = self.db.query(BillDB).filter(BillDB.status.in_(OPEN_STATUSES)).count()
        active_sub_count = self.db.query(SubscriptionDB).filter(SubscriptionDB.is_active == True).count()

        now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        conversion_policy = (
            "One column per currency, side by side. Currencies are never added together and no converted total is shown."
            if curr_norm == "ALL"
            else f"Filtered strictly to {curr_norm} accounts and transactions (1:1 single currency)."
        )

        display_currency = curr_norm if curr_norm != "ALL" else "ALL"
        basis_note = ACCRUAL_PARTIAL_NOTE if basis_norm == "accrual" else None

        kpis = {
            "total_cash": {
                "id": "statFinanceBalance",
                "value": total_cash,
                "currency": display_currency,
                "label": "Total Cash Balance",
                "period": "Current (Real-time)",
                "definition": "Consolidated book cash balance across all active bank and cash accounts matching scope.",
                "formula": "SUM(finance_bank_accounts.current_balance WHERE is_active=True)",
                "source_coverage": f"{len(accounts)} active bank & cash accounts",
                "drilldown_section": "finance-accounts",
                "drilldown_filter": {"is_active": "true"},
            },
            "revenue": {
                "id": "statFinanceRevenue",
                "value": revenue,
                "currency": display_currency,
                "label": f"Revenue ({period_norm})",
                "period": period_norm,
                "definition": (
                    "Cash inflows received, net of reversals; transfers, exchange and cash withdrawals between own accounts are excluded"
                    if basis_norm == "cash"
                    else f"Recognized net revenue (excluding VAT) from all non-void sales invoices issued in period. {ACCRUAL_PARTIAL_NOTE}"
                ),
                "formula": (
                    "SUM(ledger_inflows WHERE source!='transfer' AND kind!='transfer')"
                    if basis_norm == "cash"
                    else "SUM(sales_invoices.subtotal WHERE status NOT IN ('void', 'draft'))  -- net of VAT"
                ),
                "source_coverage": "Bank & cash ledger transactions" if basis_norm == "cash" else "Sales invoices register",
                "drilldown_section": "finance-transactions" if basis_norm == "cash" else "finance-invoices",
                "drilldown_filter": {"direction": "in"} if basis_norm == "cash" else {"status": "all"},
            },
            "operating_spend": {
                "id": "statFinanceCost",
                "value": operating_spend,
                "currency": display_currency,
                "label": f"Operating Expenses ({period_norm})",
                "period": period_norm,
                "definition": (
                    "Cash outflows for expenses, bills, payroll and statutory payments, net of reversals; own-account movements are excluded"
                    if basis_norm == "cash"
                    else f"Recognized costs from all non-void vendor bills issued in period. {ACCRUAL_PARTIAL_NOTE}"
                ),
                "formula": (
                    "SUM(ledger_outflows WHERE source!='transfer' AND kind!='transfer')"
                    if basis_norm == "cash"
                    else "SUM(bills.total WHERE status!='void')"
                ),
                "source_coverage": "Bank & cash ledger transactions" if basis_norm == "cash" else "Vendor bills register",
                "drilldown_section": "finance-transactions" if basis_norm == "cash" else "finance-bills",
                "drilldown_filter": {"direction": "out"} if basis_norm == "cash" else {"status": "all"},
            },
            "net_result": {
                "id": "statFinanceNet",
                "value": net_result,
                "currency": display_currency,
                "label": f"Net Operating Result ({period_norm})",
                "period": period_norm,
                "definition": "Net operating difference: Revenue minus Operating Expenses for the period.",
                "formula": "Revenue - Operating Expenses",
                "source_coverage": "Ledger operating delta" if basis_norm == "cash" else "Invoices minus Bills",
                "drilldown_section": "finance-reports",
                "drilldown_filter": {},
            },
            "operating_margin": {
                "id": "statFinanceMargin",
                "value": margin_pct,
                "is_valid": margin_valid,
                "unit": "%",
                "label": f"Operating Margin ({period_norm})",
                "period": period_norm,
                "definition": (
                    "Operating profitability percentage: (Net Result / Revenue) * 100. Only valid when Revenue > 0."
                    if margin_valid
                    else "Margin is undefined or invalid because Revenue is zero or negative."
                ),
                "formula": "(Net Operating Result / Revenue) * 100",
                "source_coverage": "Derived from Revenue and Spend",
                "drilldown_section": "finance-reports",
                "drilldown_filter": {},
            },
        }

        return {
            "balance": total_cash,
            "revenue_mtd": revenue,
            "cost_mtd": operating_spend,
            "net_mtd": net_result,
            "margin_pct": margin_pct,
            "margin_valid": margin_valid,
            "currency": display_currency,
            "base_currency": display_currency,
            "by_currency": by_currency,
            "period": period_norm,
            "basis": basis_norm,
            "basis_note": basis_note,
            "entity": entity_norm,
            "conversion_policy": conversion_policy,
            "data_scope": f"{entity_norm}_{curr_norm.lower()}",
            "open_invoices_count": open_inv_count,
            "unpaid_bills_count": unpaid_bills_count,
            "active_subscriptions_count": active_sub_count,
            "generated_at": now_iso,
            "book": scope.view,
            "inter_book_lines": [
                {"currency": cur, "side": side, "label": label, "amount": round(amt, 2)}
                for (cur, side, label), amt in sorted(inter_book_lines.items())
            ],
            "kpis": kpis,
        }

    # ------------------------------------------------------------------
    # 1. Transactions Ledger Report
    # ------------------------------------------------------------------
    def get_transactions_report(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        account_id: Optional[int] = None,
        category_id: Optional[int] = None,
        payment_type_id: Optional[int] = None,
        direction: Optional[str] = None,
        search: Optional[str] = None,
        payee_type: Optional[str] = None,
        include_internal: bool = True,
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        scope = self._scope(book)
        q = (
            self.db.query(LedgerTransactionDB)
            .join(FinanceBankAccountDB, LedgerTransactionDB.account_id == FinanceBankAccountDB.id)
            .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            .outerjoin(PaymentTypeDB, LedgerTransactionDB.payment_type_id == PaymentTypeDB.id)
        )

        q = scope.filter(q, LedgerTransactionDB.account_id)
        if date_from:
            q = q.filter(LedgerTransactionDB.date >= date_from)
        if date_to:
            q = q.filter(LedgerTransactionDB.date <= date_to)
        if account_id:
            q = q.filter(LedgerTransactionDB.account_id == account_id)
        if category_id:
            q = q.filter(LedgerTransactionDB.category_id == category_id)
        if payment_type_id:
            q = q.filter(LedgerTransactionDB.payment_type_id == payment_type_id)
        if direction:
            q = q.filter(LedgerTransactionDB.direction == direction.lower())
        if payee_type:
            q = q.filter(LedgerTransactionDB.payee_type == payee_type.lower())
        elif not include_internal:
            q = q.filter(or_(LedgerTransactionDB.payee_type != "employee", LedgerTransactionDB.payee_type.is_(None)))

        if search:
            like_term = f"%{search.strip()}%"
            q = q.filter(
                or_(
                    LedgerTransactionDB.reference.ilike(like_term),
                    LedgerTransactionDB.description.ilike(like_term),
                    LedgerTransactionDB.cheque_number.ilike(like_term),
                    LedgerTransactionDB.counterparty.ilike(like_term),
                    LedgerTransactionDB.payee_name.ilike(like_term),
                )
            )

        txs = q.order_by(LedgerTransactionDB.date.asc(), LedgerTransactionDB.id.asc()).all()

        total_inflows = 0.0
        total_outflows = 0.0
        transactions_list = []

        for tx in txs:
            amt = float(tx.amount or 0.0)
            if tx.direction == "in":
                total_inflows += amt
            elif tx.direction == "out":
                total_outflows += amt

            transactions_list.append({
                "id": tx.id,
                "date": tx.date,
                "account_id": tx.account_id,
                "account_name": tx.account.account_name if tx.account else "Unknown",
                "account_currency": tx.account.currency if tx.account else tx.currency,
                "direction": tx.direction,
                "amount": amt,
                "currency": tx.currency,
                "category_id": tx.category_id,
                "category_name": tx.category.name if tx.category else "Uncategorized",
                "payment_type_id": tx.payment_type_id,
                "payment_type_name": tx.payment_type.name if tx.payment_type else "—",
                "payee_type": getattr(tx, "payee_type", "none") or "none",
                "payee_id": getattr(tx, "payee_id", None),
                "payee_name": getattr(tx, "payee_name", None) or getattr(tx, "counterparty", None) or "",
                "counterparty": getattr(tx, "counterparty", None) or getattr(tx, "payee_name", None) or "",
                "reference": tx.reference or "",
                "description": tx.description or "",
                "cheque_number": tx.cheque_number or "",
                "source": tx.source,
                "running_balance": float(tx.running_balance or 0.0),
            })

        return {
            "date_from": date_from,
            "date_to": date_to,
            "count": len(transactions_list),
            "total_inflows": round(total_inflows, 2),
            "total_outflows": round(total_outflows, 2),
            "net_change": round(total_inflows - total_outflows, 2),
            "transactions": transactions_list,
        }

    # ------------------------------------------------------------------
    # 2. Category Spend Rollup (SPENT Block)
    # ------------------------------------------------------------------
    def get_category_summary_report(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        currency: Optional[str] = None,
        include_internal: bool = True,
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Category spend rollup mirroring the monthly SPENT block.
        Calculates total outflows per category, transaction count, and % of total spend.
        """
        q = (
            self.db.query(
                LedgerTransactionDB.category_id,
                TransactionCategoryDB.name.label("category_name"),
                TransactionCategoryDB.kind.label("category_kind"),
                func.sum(LedgerTransactionDB.amount).label("total_amount"),
                func.count(LedgerTransactionDB.id).label("transaction_count"),
            )
            .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            .filter(LedgerTransactionDB.direction == "out")
        )
        q = self._scope(book).filter(q, LedgerTransactionDB.account_id)

        if date_from:
            q = q.filter(LedgerTransactionDB.date >= date_from)
        if date_to:
            q = q.filter(LedgerTransactionDB.date <= date_to)
        if currency:
            q = q.filter(LedgerTransactionDB.currency == currency.upper())
        if not include_internal:
            q = q.filter(or_(LedgerTransactionDB.payee_type != "employee", LedgerTransactionDB.payee_type.is_(None)))

        rows = (
            q.group_by(LedgerTransactionDB.category_id, TransactionCategoryDB.name, TransactionCategoryDB.kind)
            .order_by(func.sum(LedgerTransactionDB.amount).desc())
            .all()
        )

        total_spent = sum(float(r.total_amount or 0.0) for r in rows)

        categories_list = []
        for r in rows:
            amt = float(r.total_amount or 0.0)
            pct = round((amt / total_spent * 100.0), 2) if total_spent > 0 else 0.0
            categories_list.append({
                "category_id": r.category_id,
                "category_name": r.category_name or "Uncategorized",
                "kind": r.category_kind or "cost",
                "transaction_count": int(r.transaction_count or 0),
                "total_amount": round(amt, 2),
                "percentage": pct,
            })

        return {
            "date_from": date_from,
            "date_to": date_to,
            "currency": currency,
            "include_internal": include_internal,
            "total_spent": round(total_spent, 2),
            "categories": categories_list,
        }

    # ------------------------------------------------------------------
    # 3. Category × Period Matrix
    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Revenue breakdown: product x book x source x customer x month, per currency (X4, D-029/D-030)
    # ------------------------------------------------------------------
    def get_revenue_breakdown(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        currency: Optional[str] = "ALL",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Cash-basis revenue (the same classification as the P&L) grouped by month, book, source, product and customer.
        Currencies are never added together (D-026). Revenue with no product shows as 'Untagged revenue'."""
        from finance.models import ProductDB, RevenueSourceDB, CustomerDB
        scope = self._scope(book)
        curr_norm = (currency or "ALL").upper()
        q = (
            self.db.query(LedgerTransactionDB, TransactionCategoryDB.kind)
            .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
        )
        q = scope.filter(q, LedgerTransactionDB.account_id)
        if date_from:
            q = q.filter(LedgerTransactionDB.date >= date_from)
        if date_to:
            q = q.filter(LedgerTransactionDB.date <= date_to)
        if curr_norm != "ALL":
            q = q.filter(LedgerTransactionDB.currency == curr_norm)

        sources = {s.id: s.name for s in self.db.query(RevenueSourceDB).all()}
        products = {p.id: p.name for p in self.db.query(ProductDB).all()}
        customers = {c.id: c.name for c in self.db.query(CustomerDB).all()}
        UNTAGGED = "Untagged revenue"

        agg: Dict[Tuple[str, str, str, str, Optional[int], str, str], float] = {}

        def add(month, book_code, source, product_id, customer_id, cur, amount):
            product_name = products.get(product_id) if product_id else UNTAGGED
            customer_name = customers.get(customer_id) if customer_id else "No customer"
            key = (month, book_code, source, product_name, product_id, customer_name, cur)
            agg[key] = agg.get(key, 0.0) + amount

        for t, kind in q.all():
            cls = cash_basis.classify_view(t, kind, has_category=t.category_id is not None, scope=scope)
            if not cls or cls[0] != cash_basis.REVENUE:
                continue
            _, amount, label = cls
            cur = (t.currency or "USD").upper()
            month = (t.date or "")[:7]
            book_code = scope.book_of(t.account_id)
            invoice = t.linked_invoice
            customer_id = t.customer_id or (invoice.customer_id if invoice is not None else None)
            source = label or (sources.get(t.revenue_source_id) if t.revenue_source_id else None) or ("Invoice" if invoice is not None else "Unspecified")
            if t.product_id:
                add(month, book_code, source, t.product_id, customer_id, cur, amount)
            elif invoice is not None and invoice.lines:
                # An invoice receipt is split across the invoice's lines by their share of the subtotal
                total = sum(float(ln.line_total or 0.0) for ln in invoice.lines)
                if total > 0:
                    for ln in invoice.lines:
                        share = float(ln.line_total or 0.0) / total
                        add(month, book_code, source, ln.product_id, customer_id, cur, amount * share)
                else:
                    add(month, book_code, source, None, customer_id, cur, amount)
            else:
                add(month, book_code, source, None, customer_id, cur, amount)

        rows = [
            {
                "month": k[0], "book_code": k[1], "source": k[2], "product_id": k[4], "product_name": k[3],
                "customer_name": k[5], "currency": k[6], "amount": round(v, 2),
            }
            for k, v in sorted(agg.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2], kv[0][3], kv[0][5], kv[0][6]))
        ]
        totals: Dict[str, float] = {}
        untagged: Dict[str, float] = {}
        for r in rows:
            totals[r["currency"]] = round(totals.get(r["currency"], 0.0) + r["amount"], 2)
            if r["product_name"] == UNTAGGED:
                untagged[r["currency"]] = round(untagged.get(r["currency"], 0.0) + r["amount"], 2)
        return {
            "book": scope.view,
            "date_from": date_from,
            "date_to": date_to,
            "currency": curr_norm,
            "rows": rows,
            "totals_by_currency": totals,
            "untagged_by_currency": untagged,
            "conversion_policy": "One figure per currency. Currencies are never added together and no converted total is shown.",
        }

    # ------------------------------------------------------------------
    # Subscription analytics (X6, D-031)
    # ------------------------------------------------------------------
    def get_subscription_spend(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        currency: Optional[str] = "ALL",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        """What settled subscription charges cost, by vendor, department and book (the book of the paying account)."""
        scope = self._scope(book)
        curr_norm = (currency or "ALL").upper()
        q = (
            self.db.query(SubscriptionChargeDB)
            .join(SubscriptionDB, SubscriptionChargeDB.subscription_id == SubscriptionDB.id)
            .filter(SubscriptionChargeDB.status == "settled")
        )
        if date_from:
            q = q.filter(SubscriptionChargeDB.billing_date >= date_from)
        if date_to:
            q = q.filter(SubscriptionChargeDB.billing_date <= date_to)
        if curr_norm != "ALL":
            q = q.filter(SubscriptionChargeDB.currency == curr_norm)

        agg: Dict[Tuple, List[float]] = {}
        by_vendor: Dict[Tuple[str, str], float] = {}
        by_department: Dict[Tuple[str, str], float] = {}
        by_book: Dict[Tuple[str, str], float] = {}
        totals: Dict[str, float] = {}
        for c in q.all():
            sub = c.subscription
            acc_id = sub.payment_account_id
            if scope.restricts and not (scope.owns_account(acc_id) if acc_id else scope.owns_unattributed()):
                continue
            cur = (c.currency or "USD").upper()
            vendor = sub.vendor.name if sub.vendor else "Unknown vendor"
            department = sub.department or "No department"
            book_code = scope.book_of(acc_id)
            paid_from = sub.payment_account.account_name if sub.payment_account else "Not set"
            key = ((c.billing_date or "")[:7], vendor, department, sub.name, book_code, paid_from, cur)
            cell = agg.setdefault(key, [0.0, 0.0])
            cell[0] += float(c.amount or 0.0)
            cell[1] += float(c.variance_amount or 0.0)
            by_vendor[(vendor, cur)] = by_vendor.get((vendor, cur), 0.0) + float(c.amount or 0.0)
            by_department[(department, cur)] = by_department.get((department, cur), 0.0) + float(c.amount or 0.0)
            by_book[(book_code, cur)] = by_book.get((book_code, cur), 0.0) + float(c.amount or 0.0)
            totals[cur] = totals.get(cur, 0.0) + float(c.amount or 0.0)

        rows = [
            {"month": k[0], "vendor": k[1], "department": k[2], "subscription": k[3], "book_code": k[4], "paid_from": k[5],
             "currency": k[6], "amount": round(v[0], 2), "variance": round(v[1], 2)}
            for k, v in sorted(agg.items())
        ]
        roll = lambda d, label: [{label: k[0], "currency": k[1], "amount": round(v, 2)} for k, v in sorted(d.items(), key=lambda kv: (-kv[1], kv[0]))]
        return {
            "report_title": "Subscription Spend",
            "book": scope.view,
            "date_from": date_from,
            "date_to": date_to,
            "currency": curr_norm,
            "rows": rows,
            "by_vendor": roll(by_vendor, "vendor"),
            "by_department": roll(by_department, "department"),
            "by_book": roll(by_book, "book_code"),
            "totals_by_currency": {k: round(v, 2) for k, v in totals.items()},
            "conversion_policy": "One figure per currency. Currencies are never added together and no converted total is shown.",
        }

    def get_subscription_proofs_missing(self, book: Optional[str] = None) -> Dict[str, Any]:
        """Charges whose expected proof of payment is still pending."""
        scope = self._scope(book)
        q = (
            self.db.query(SubscriptionChargeDB)
            .join(SubscriptionDB, SubscriptionChargeDB.subscription_id == SubscriptionDB.id)
            .filter(
                SubscriptionChargeDB.proof_status == "pending",
                SubscriptionChargeDB.status.in_(["expected", "settled"]),
                SubscriptionDB.proof_expected == True,  # noqa: E712
            )
            .order_by(SubscriptionChargeDB.billing_date.desc(), SubscriptionChargeDB.id.desc())
        )
        rows = []
        totals: Dict[str, float] = {}
        for c in q.all():
            sub = c.subscription
            acc_id = sub.payment_account_id
            if scope.restricts and not (scope.owns_account(acc_id) if acc_id else scope.owns_unattributed()):
                continue
            cur = (c.currency or "USD").upper()
            totals[cur] = totals.get(cur, 0.0) + float(c.amount or 0.0)
            rows.append({
                "charge_id": c.id, "billing_date": c.billing_date, "subscription": sub.name, "vendor": sub.vendor.name if sub.vendor else "Unknown vendor",
                "status": c.status, "currency": cur, "amount": round(float(c.amount or 0.0), 2), "proof_source": sub.proof_source or "none",
                "billing_email": sub.billing_email or "", "book_code": scope.book_of(acc_id),
                "paid_from": sub.payment_account.account_name if sub.payment_account else "Not set",
            })
        return {
            "report_title": "Subscription Proofs Missing",
            "book": scope.view,
            "rows": rows,
            "totals_by_currency": {k: round(v, 2) for k, v in totals.items()},
        }

    def get_category_by_period_matrix(
        self,
        year: int,
        period_group: str = "month",
        currency: Optional[str] = None,
        include_internal: bool = True,
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates an annual category spend matrix.
        Rows: Categories
        Columns: Periods (Jan-Dec for month, Q1-Q4 for quarter), Total, % of Total.
        """
        period_group = period_group.lower()
        if period_group not in ("month", "quarter"):
            period_group = "month"

        if period_group == "month":
            period_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            def get_period_label(date_str: str) -> str:
                # date_str: YYYY-MM-DD
                m_idx = int(date_str.split("-")[1]) - 1
                return period_labels[m_idx]
        else:
            period_labels = ["Q1", "Q2", "Q3", "Q4"]
            def get_period_label(date_str: str) -> str:
                m = int(date_str.split("-")[1])
                q_idx = (m - 1) // 3
                return period_labels[q_idx]

        prefix = f"{year}-"
        q = (
            self.db.query(
                LedgerTransactionDB.date,
                LedgerTransactionDB.amount,
                LedgerTransactionDB.category_id,
                TransactionCategoryDB.name.label("category_name"),
            )
            .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            .filter(
                LedgerTransactionDB.direction == "out",
                LedgerTransactionDB.date.startswith(prefix),
            )
        )
        if currency:
            q = q.filter(LedgerTransactionDB.currency == currency.upper())
        if not include_internal:
            q = q.filter(or_(LedgerTransactionDB.payee_type != "employee", LedgerTransactionDB.payee_type.is_(None)))

        q = self._scope(book).filter(q, LedgerTransactionDB.account_id)
        records = q.all()

        # Build map: category_id -> { "category_name": ..., "periods": { "Jan": 0.0, ... }, "total": 0.0 }
        cat_map: Dict[Any, Dict[str, Any]] = {}
        period_totals = {lbl: 0.0 for lbl in period_labels}
        year_total = 0.0

        for r in records:
            cat_id = r.category_id or 0
            cat_name = r.category_name or "Uncategorized"
            amt = float(r.amount or 0.0)

            if cat_id not in cat_map:
                cat_map[cat_id] = {
                    "category_id": cat_id,
                    "category_name": cat_name,
                    "periods": {lbl: 0.0 for lbl in period_labels},
                    "total": 0.0,
                }

            lbl = get_period_label(r.date)
            cat_map[cat_id]["periods"][lbl] += amt
            cat_map[cat_id]["total"] += amt
            period_totals[lbl] += amt
            year_total += amt

        # Format rows and compute percentages
        rows = []
        for cat_data in sorted(cat_map.values(), key=lambda x: x["total"], reverse=True):
            tot = round(cat_data["total"], 2)
            pct = round((tot / year_total * 100.0), 2) if year_total > 0 else 0.0
            periods_formatted = {k: round(v, 2) for k, v in cat_data["periods"].items()}
            rows.append({
                "category_id": cat_data["category_id"],
                "category_name": cat_data["category_name"],
                "periods": periods_formatted,
                "total": tot,
                "percentage": pct,
            })

        period_totals_formatted = {k: round(v, 2) for k, v in period_totals.items()}

        return {
            "year": year,
            "period_group": period_group,
            "currency": currency,
            "period_labels": period_labels,
            "year_total": round(year_total, 2),
            "period_totals": period_totals_formatted,
            "rows": rows,
        }

    # ------------------------------------------------------------------
    # 4. Point-in-Time Balances Report
    # ------------------------------------------------------------------
    def get_point_in_time_balances(self, as_of_date: str, book: Optional[str] = None, include_inactive: bool = False) -> Dict[str, Any]:
        """
        Computes the balance of each bank/cash account as of a given date (inclusive).
        Transactions after as_of_date are excluded. Inactive accounts are left out unless include_inactive.
        Note: opening_balance_date is not used; see tests/test_reports_balances_opening_date.py.
        BI-1 (D-043): the base is the latest entered yearly opening <= the year of as_of_date, else the account
        opening_balance (key opening_balance keeps the legacy account value; base_year/base_amount/base_source add the base used).
        """
        scope = self._scope(book)
        acc_q = self.db.query(FinanceBankAccountDB)
        if not include_inactive:
            acc_q = acc_q.filter(FinanceBankAccountDB.is_active == True)
        accounts = scope.filter(acc_q, FinanceBankAccountDB.id).all()

        accounts_list = []
        currency_totals: Dict[str, float] = {}
        country_totals: Dict[str, Dict[str, float]] = {}

        all_openings = year_openings.load_openings(self.db, [a.id for a in accounts])
        for acc in accounts:
            opening = float(acc.opening_balance or 0.0)

            # Base amount (latest entered yearly opening, else the account opening) plus movements through as_of_date
            openings = all_openings.get(acc.id, {})
            base_year, base_amount = year_openings.base_for(acc, openings, int(as_of_date[:4]))
            balance = round(year_openings.balance_as_of(self.db, acc, as_of_date, openings), 2)
            curr = acc.currency or "USD"
            country = acc.country or "Egypt"

            currency_totals[curr] = round(currency_totals.get(curr, 0.0) + balance, 2)
            if country not in country_totals:
                country_totals[country] = {}
            country_totals[country][curr] = round(country_totals[country].get(curr, 0.0) + balance, 2)

            accounts_list.append({
                "account_id": acc.id,
                "account_name": acc.account_name,
                "bank_name": acc.bank_name or "",
                "account_number": acc.account_number,
                "currency": curr,
                "account_type": acc.account_type,
                "country": country,
                "opening_balance": opening,
                "opening_balance_date": acc.opening_balance_date,
                "is_active": bool(acc.is_active),
                "balance_as_of_date": balance,
                "base_year": base_year,
                "base_amount": round(base_amount, 2),
                "base_source": year_openings.SOURCE_ENTERED if base_year is not None else year_openings.SOURCE_ACCOUNT_OPENING,
                "book_code": scope.book_of(acc.id),
                "visibility": acc.visibility or "full",
            })

        accounts_list.sort(key=lambda a: (a["currency"], a["account_name"]))

        return {
            "as_of_date": as_of_date,
            "accounts": accounts_list,
            "currency_totals": currency_totals,
            "country_totals": country_totals,
        }

    # ------------------------------------------------------------------
    # 4b. Fiscal year summary (FY-1): calendar year, per account and per category
    # ------------------------------------------------------------------
    OTHER_COUNTRY_TRANSFERS = "Transfers to another country"

    def get_fiscal_year_summary(self, year: int, book: Optional[str] = None, month: Optional[int] = None) -> Dict[str, Any]:
        """
        Yearly summary for the calendar year (January to December), or one month of it when `month` is given.
        Per account, in its own currency: opening (balance at the start of the period), money in and money out
        (every ledger movement, transfers between own accounts included, so the statement matches the system),
        closing (balance at the end of the period). Per currency totals only: nothing is added across currencies.
        Openings follow BI-1 (D-043): an entered yearly opening starts its year, a year without one carries the
        previous closing forward; the month opening is the previous month's closing (January: the year opening).
        Company spend per category excludes movements between own accounts in the same country; a movement to an
        account in another country stays in spend as "Transfers to another country".
        """
        if month is not None:
            if not 1 <= int(month) <= 12:
                raise HTTPException(status_code=400, detail="month must be between 1 and 12")
            month = int(month)
            start = f"{year:04d}-{month:02d}-01"
            end = f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"
        else:
            start, end = f"{year:04d}-01-01", f"{year:04d}-12-31"
        prev_end = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
        scope = self._scope(book)

        closing = self.get_point_in_time_balances(end, book=book, include_inactive=True)["accounts"]
        acc_objs = {a.id: a for a in self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id.in_([c["account_id"] for c in closing] or [0])).all()}
        all_openings = year_openings.load_openings(self.db, list(acc_objs))
        opening = {
            aid: year_openings.balance_at_start_of(self.db, acc, start, all_openings.get(aid, {}))
            for aid, acc in acc_objs.items()
        }
        notes = {
            (r.account_id): r.note or ""
            for r in self.db.query(FinanceAccountYearOpeningDB).filter(
                FinanceAccountYearOpeningDB.fiscal_year == year, FinanceAccountYearOpeningDB.account_id.in_(list(acc_objs) or [0])
            ).all()
        }

        flow_q = (
            self.db.query(LedgerTransactionDB.account_id, LedgerTransactionDB.direction, func.sum(LedgerTransactionDB.amount))
            .filter(LedgerTransactionDB.date >= start, LedgerTransactionDB.date <= end)
            .group_by(LedgerTransactionDB.account_id, LedgerTransactionDB.direction)
        )
        flows: Dict[int, Dict[str, float]] = {}
        for aid, direction, total in scope.filter(flow_q, LedgerTransactionDB.account_id).all():
            flows.setdefault(aid, {"in": 0.0, "out": 0.0})[direction] = float(total or 0.0)

        pre_open_q = (
            self.db.query(LedgerTransactionDB.account_id, FinanceBankAccountDB.opening_balance_date, func.count(LedgerTransactionDB.id))
            .join(FinanceBankAccountDB, FinanceBankAccountDB.id == LedgerTransactionDB.account_id)
            .filter(FinanceBankAccountDB.opening_balance_date.isnot(None),
                    LedgerTransactionDB.date < FinanceBankAccountDB.opening_balance_date)
            .group_by(LedgerTransactionDB.account_id, FinanceBankAccountDB.opening_balance_date)
        )
        pre_open = {aid: int(n) for aid, _d, n in scope.filter(pre_open_q, LedgerTransactionDB.account_id).all()}

        rows: List[Dict[str, Any]] = []
        warnings: List[Dict[str, Any]] = []
        totals: Dict[str, Dict[str, float]] = {}
        for acc in closing:
            aid = acc["account_id"]
            fl = flows.get(aid, {"in": 0.0, "out": 0.0})
            op = float(opening.get(aid, 0.0))
            cl = float(acc["balance_as_of_date"])
            od = acc.get("opening_balance_date")
            ops = all_openings.get(aid, {})
            # a period that ends before the account's opening date has no data yet, unless a yearly opening was entered
            no_data = bool(od) and end < od and year_openings.base_year_for(ops, year) is None
            if not acc["is_active"] and not (fl["in"] or fl["out"] or op or cl):
                continue
            info = year_openings.year_opening_info(self.db, acc_objs[aid], year, ops)
            year_start = month in (None, 1)
            if month in (None, 1):
                opening_source, variance = info["source"], info["variance"]
            else:
                opening_source, variance = "previous_month", None
            first_base = min(ops) if ops else None
            before_base = self.db.query(func.count(LedgerTransactionDB.id)).filter(
                LedgerTransactionDB.account_id == aid, LedgerTransactionDB.date < f"{first_base:04d}-01-01"
            ).scalar() if first_base is not None else 0
            row = {
                "account_id": aid,
                "account_name": acc["account_name"],
                "bank_name": acc.get("bank_name") or "",
                "account_type": acc.get("account_type"),
                "country": acc.get("country"),
                "currency": acc["currency"],
                "book_code": acc.get("book_code"),
                "is_active": acc["is_active"],
                "opening_balance_date": od,
                "no_data": no_data,
                "opening": None if no_data else round(op, 2),
                "money_in": None if no_data else round(fl["in"], 2),
                "money_out": None if no_data else round(fl["out"], 2),
                "closing": None if no_data else round(cl, 2),
                "transactions_before_opening_date": 0 if ops else pre_open.get(aid, 0),
                "transactions_before_first_base": int(before_base or 0),
                "opening_source": opening_source,
                "previous_year_closing": round(info["previous_closing"], 2),
                "opening_variance": None if variance is None else round(variance, 2),
                "opening_note": notes.get(aid, "") if info["source"] == year_openings.SOURCE_ENTERED else None,
            }
            rows.append(row)
            if not no_data:
                label = f"{acc['account_name']} ({acc['currency']})"
                if year_start and variance is not None and abs(variance) > 0.005:
                    warnings.append({"type": "opening_variance", "account_id": aid, "account_name": acc["account_name"], "currency": acc["currency"],
                                     "fiscal_year": year, "amount": round(variance, 2),
                                     "message": f"{label}: the entered {year} opening differs from the previous year's closing by {variance:,.2f}."})
                if year_start and info["source"] == year_openings.SOURCE_CARRIED_FORWARD:
                    warnings.append({"type": "carried_forward", "account_id": aid, "account_name": acc["account_name"], "currency": acc["currency"],
                                     "fiscal_year": year, "amount": None,
                                     "message": f"{label}: no opening entered for {year}; the previous year's closing is carried forward."})
                n_before = int(before_base or 0) or (0 if ops else pre_open.get(aid, 0))
                if n_before:
                    warnings.append({"type": "transactions_before_first_base", "account_id": aid, "account_name": acc["account_name"], "currency": acc["currency"],
                                     "fiscal_year": year, "amount": n_before,
                                     "message": f"{label}: {n_before} transaction(s) are dated before the first opening."})
                t = totals.setdefault(acc["currency"], {"opening": 0.0, "money_in": 0.0, "money_out": 0.0, "closing": 0.0})
                t["opening"] += op
                t["money_in"] += fl["in"]
                t["money_out"] += fl["out"]
                t["closing"] += cl
        rows.sort(key=lambda r: (r["currency"], r["account_name"]))

        # ---- company spend per category, per currency
        country_of = {a.id: (a.country or "Egypt") for a in self.db.query(FinanceBankAccountDB).all()}
        spend_q = (
            self.db.query(LedgerTransactionDB, TransactionCategoryDB.kind, TransactionCategoryDB.name)
            .options(joinedload(LedgerTransactionDB.payment_type), joinedload(LedgerTransactionDB.linked_transfer))
            .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            .filter(LedgerTransactionDB.direction == "out", LedgerTransactionDB.date >= start, LedgerTransactionDB.date <= end)
        )
        spend: Dict[str, Dict[str, Any]] = {}
        for tx, kind, cname in scope.filter(spend_q, LedgerTransactionDB.account_id).all():
            cur = tx.currency or "USD"
            bucket = spend.setdefault(cur, {"categories": {}, "total": 0.0, "excluded_own_account_same_country": 0.0})
            amount = float(tx.amount or 0.0)
            cat_id, cat_name, cat_kind = tx.category_id, cname or "Uncategorized", kind or "cost"
            if cash_basis.is_own_account_movement(tx, kind):
                counter = scope.counter_account_id(tx) or tx.destination_cash_account_id
                if counter is None or country_of.get(counter) == country_of.get(tx.account_id):
                    bucket["excluded_own_account_same_country"] += amount
                    continue
                cat_id, cat_name, cat_kind = None, self.OTHER_COUNTRY_TRANSFERS, "transfer"
            c = bucket["categories"].setdefault((cat_id, cat_name), {"category_id": cat_id, "category_name": cat_name, "kind": cat_kind, "transaction_count": 0, "total_amount": 0.0})
            c["transaction_count"] += 1
            c["total_amount"] += amount
            bucket["total"] += amount

        spend_out: Dict[str, Any] = {}
        for cur, b in spend.items():
            cats = sorted(b["categories"].values(), key=lambda c: -c["total_amount"])
            for c in cats:
                c["total_amount"] = round(c["total_amount"], 2)
                c["percentage"] = round(c["total_amount"] / b["total"] * 100.0, 2) if b["total"] > 0 else 0.0
            spend_out[cur] = {
                "total": round(b["total"], 2),
                "excluded_own_account_same_country": round(b["excluded_own_account_same_country"], 2),
                "categories": cats,
            }

        return {
            "year": year,
            "month": month,
            "period": {"from": start, "to": end},
            "date_from": start,
            "date_to": end,
            "opening_as_of": prev_end,
            "closing_as_of": end,
            "warnings": warnings,
            "accounts": rows,
            "currency_totals": {cur: {k: round(v, 2) for k, v in t.items()} for cur, t in sorted(totals.items())},
            "spend": spend_out,
        }

    # ------------------------------------------------------------------
    # 5. Cheque Register Report
    # ------------------------------------------------------------------
    def get_cheques_report(
        self,
        fiscal_year: int,
        account_id: Optional[int] = None,
        status: Optional[str] = None,
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Retrieves fiscal year cheque register with status breakdown and totals.
        """
        q = (
            self.db.query(FinanceChequeDB)
            .join(FinanceBankAccountDB, FinanceChequeDB.account_id == FinanceBankAccountDB.id)
            .filter(FinanceChequeDB.fiscal_year == fiscal_year)
        )
        q = self._scope(book).filter(q, FinanceChequeDB.account_id)

        if account_id:
            q = q.filter(FinanceChequeDB.account_id == account_id)
        if status:
            q = q.filter(FinanceChequeDB.status == status.lower())

        cheques = q.order_by(FinanceChequeDB.issue_date.desc(), FinanceChequeDB.cheque_number.asc()).all()

        total_amount = 0.0
        by_status = {
            "issued": {"count": 0, "amount": 0.0},
            "cleared": {"count": 0, "amount": 0.0},
            "bounced": {"count": 0, "amount": 0.0},
            "voided": {"count": 0, "amount": 0.0},
        }

        cheques_list = []
        for chk in cheques:
            amt = float(chk.amount or 0.0)
            st = chk.status.lower()
            if st in by_status:
                by_status[st]["count"] += 1
                by_status[st]["amount"] = round(by_status[st]["amount"] + amt, 2)

            total_amount += amt

            cheques_list.append({
                "id": chk.id,
                "cheque_number": chk.cheque_number,
                "account_id": chk.account_id,
                "account_name": chk.account.account_name if chk.account else "Unknown",
                "issue_date": chk.issue_date,
                "clear_date": chk.clear_date or "",
                "currency": chk.currency,
                "amount": amt,
                "payee": chk.payee,
                "purpose_type": chk.purpose_type,
                "status": chk.status,
                "notes": chk.notes or "",
            })

        return {
            "fiscal_year": fiscal_year,
            "summary": {
                "total_count": len(cheques_list),
                "total_amount": round(total_amount, 2),
                "by_status": by_status,
            },
            "cheques": cheques_list,
        }

    # ------------------------------------------------------------------
    # 6. Story 7.1: Standard Report Library Catalog & Shell Controls
    # ------------------------------------------------------------------
    def get_report_library(self) -> Dict[str, Any]:
        """Returns standard report library organized into 6 core business question domains."""
        categories = [
            "Performance",
            "Cash & Banking",
            "Sales & Receivables",
            "Spend & Payables",
            "Payroll",
            "Audit & Compliance",
        ]
        reports = [
            # Performance
            {
                "key": "category-summary",
                "title": "Category Spend Rollup",
                "category": "Performance",
                "business_question": "Where are company operational outflows being spent across budget categories?",
                "description": "Monthly expense aggregation and budget percentage allocation mirroring the SPENT block.",
                "icon": "fa-solid fa-chart-pie",
                "supported_basis": ["cash", "accrual"],
                "supported_formats": ["json", "xlsx"],
                "required_permission": "finance.report.read",
                "badge": "Core Spend",
            },
            {
                "key": "matrix",
                "title": "Annual Spend Matrix",
                "category": "Performance",
                "business_question": "How does category spend trend across months and fiscal quarters?",
                "description": "Comprehensive cross-tabulation of category expenses across months or quarters with row totals.",
                "icon": "fa-solid fa-table-cells",
                "supported_basis": ["cash", "accrual"],
                "supported_formats": ["json", "xlsx"],
                "required_permission": "finance.report.read",
                "badge": "Trend Analysis",
            },
            # Cash & Banking
            {
                "key": "balances",
                "title": "Point-in-Time Balances",
                "category": "Cash & Banking",
                "business_question": "What was our cash and liquidity position on any specific historical date?",
                "description": "Historical balance calculations for all active bank and cash accounts as of a cutoff date.",
                "icon": "fa-solid fa-scale-balanced",
                "supported_basis": ["cash"],
                "supported_formats": ["json", "xlsx"],
                "required_permission": "finance.report.read",
                "badge": "Liquidity",
            },
            {
                "key": "fiscal-year-summary",
                "title": "Yearly Summary",
                "category": "Cash & Banking",
                "business_question": "For each calendar year, what did every account open and close with, how much came in and went out, and what did the company spend?",
                "description": "January to December summary per account (opening, money in, money out, closing) and company spend per category, per currency.",
                "icon": "fa-solid fa-calendar-days",
                "supported_basis": ["cash"],
                "supported_formats": ["json", "xlsx"],
                "required_permission": "finance.report.read",
                "badge": "Year End",
            },
            {
                "key": "cash-forecast",
                "title": "Cash Position & 30/60/90-Day Forecast",
                "category": "Cash & Banking",
                "business_question": "What is our net projected cash flow and liquidity runway over the next 90 days?",
                "description": "Forward-looking cash projections incorporating confirmed receivables, bills, and subscriptions.",
                "icon": "fa-solid fa-chart-line",
                "supported_basis": ["cash"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Planning",
            },
            {
                "key": "reconciliation-summary",
                "title": "Bank Reconciliation Summary",
                "category": "Cash & Banking",
                "business_question": "Which bank accounts and monthly statement periods are reconciled, closed, or pending review?",
                "description": "Overview of statement reconciliation completion status, book variances, and period locks.",
                "icon": "fa-solid fa-file-invoice-dollar",
                "supported_basis": ["cash"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Control",
            },
            # Sales & Receivables
            {
                "key": "invoices-summary",
                "title": "Customer Receivables & Sales Summary",
                "category": "Sales & Receivables",
                "business_question": "What is our revenue run rate and outstanding receivables exposure by customer?",
                "description": "Sales invoice status breakdown, collections aging, and revenue channel distribution.",
                "icon": "fa-solid fa-file-invoice",
                "supported_basis": ["accrual", "cash"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Revenue",
            },
            # Spend & Payables
            {
                "key": "bills-summary",
                "title": "Vendor Payables & Commitments Schedule",
                "category": "Spend & Payables",
                "business_question": "What vendor liabilities and upcoming disbursements are scheduled for payment?",
                "description": "Vendor bill approval queues, payment readiness, and upcoming payment obligations.",
                "icon": "fa-solid fa-receipt",
                "supported_basis": ["accrual", "cash"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Payables",
            },
            {
                "key": "subscriptions-summary",
                "title": "Recurring Spend & SaaS Commitments",
                "category": "Spend & Payables",
                "business_question": "What are our recurring software, cloud infrastructure, and tool commitments?",
                "description": "Active subscription contracts, upcoming renewal dates, and monthly equivalent run rates.",
                "icon": "fa-solid fa-repeat",
                "supported_basis": ["accrual", "cash"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Commitments",
            },
            # Payroll
            {
                "key": "payroll-summary",
                "title": "Payroll Register & Compensation Outflows",
                "category": "Payroll",
                "business_question": "How much did net salaries, employee benefits, and payroll taxes cost per cycle?",
                "description": "Monthly payroll register aggregation across active staff and department allocations.",
                "icon": "fa-solid fa-users",
                "supported_basis": ["cash", "accrual"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Payroll",
            },
            {
                "key": "compensation-summary",
                "title": "Compensation Spend & Variance Report",
                "category": "Payroll",
                "business_question": "What is total company compensation spend across external, internal, commission, and bonus pay?",
                "description": "Granular compensation reporting per employee and company-wide across flexible date ranges.",
                "icon": "fa-solid fa-money-bill-wave",
                "supported_basis": ["cash", "accrual"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Spend",
            },
            {
                "key": "withholding-credits",
                "title": "Withholding Tax Credits",
                "category": "Sales & Receivables",
                "business_question": "How much tax have customers withheld from our payments, for offsetting against income tax?",
                "description": "Tax withheld by customers on invoice receipts, by customer and month. No bank movement is involved.",
                "icon": "fa-solid fa-hand-holding-dollar",
                "supported_basis": ["cash"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Compliance",
            },
            {
                "key": "statutory-remitted",
                "title": "Statutory Obligations Remitted Report",
                "category": "Payroll",
                "business_question": "How much tax and social insurance has been officially paid and remitted to authorities?",
                "description": "Summary of settled statutory obligations by period and tax/insurance obligation type.",
                "icon": "fa-solid fa-landmark",
                "supported_basis": ["cash"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Compliance",
            },
            {
                "key": "payable-status",
                "title": "Payroll & Statutory Settlement Status",
                "category": "Payroll",
                "business_question": "What is the settlement status (pending vs settled) of employee payouts, taxes, and social insurance?",
                "description": "Unified view tracking pending vs settled amounts for external wire, internal cash, tax, and insurance flows.",
                "icon": "fa-solid fa-money-bill-transfer",
                "supported_basis": ["cash", "accrual"],
                "supported_formats": ["json"],
                "required_permission": "finance.report.read",
                "badge": "Payables",
            },
            {
                "key": "revenue-breakdown",
                "title": "Revenue by Product, Book and Source",
                "category": "Performance",
                "business_question": "Which products, sources and books does our revenue come from, per currency?",
                "description": "Cash-basis revenue by month, book, source, product and customer, with an Untagged revenue row. One figure per currency.",
                "icon": "fa-solid fa-sack-dollar",
                "supported_basis": ["cash"],
                "supported_formats": ["json", "xlsx", "csv"],
                "required_permission": "finance.report.read",
                "badge": "Revenue",
            },
            {
                "key": "subscription-spend",
                "title": "Subscription Spend",
                "category": "Spend & Payables",
                "business_question": "What do our subscriptions cost by vendor, department and book?",
                "description": "Settled subscription charges by month, vendor, department and the book of the paying account.",
                "icon": "fa-solid fa-repeat",
                "supported_basis": ["cash"],
                "supported_formats": ["json", "xlsx", "csv"],
                "required_permission": "finance.report.read",
                "badge": "Subscriptions",
            },
            {
                "key": "subscription-proofs-missing",
                "title": "Subscription Proofs Missing",
                "category": "Audit & Compliance",
                "business_question": "Which subscription charges still have no proof of payment?",
                "description": "Charges that expect a proof and have neither a file nor a reason it is unavailable.",
                "icon": "fa-solid fa-paperclip",
                "supported_basis": ["cash"],
                "supported_formats": ["json", "xlsx", "csv"],
                "required_permission": "finance.report.read",
                "badge": "Controls",
            },
            # Audit & Compliance
            {
                "key": "transactions",
                "title": "Continuous Transaction Ledger",
                "category": "Audit & Compliance",
                "business_question": "What is the detailed, auditable transaction log across all accounts and categories?",
                "description": "Filterable general ledger transaction journal with running balances and reference links.",
                "icon": "fa-solid fa-list-check",
                "supported_basis": ["cash", "accrual"],
                "supported_formats": ["json", "xlsx"],
                "required_permission": "finance.report.read",
                "badge": "General Ledger",
            },
            {
                "key": "cheques",
                "title": "Cheque Register & Clear Status",
                "category": "Audit & Compliance",
                "business_question": "What is the status, clearing trail, and presentment date of all company issued cheques?",
                "description": "Cheque register filtered by fiscal year and account with status breakdown.",
                "icon": "fa-solid fa-money-check",
                "supported_basis": ["cash"],
                "supported_formats": ["json", "xlsx"],
                "required_permission": "finance.report.read",
                "badge": "Audit",
            },
            {
                "key": "profit-and-loss",
                "title": "Profit & Loss Statement (P&L)",
                "category": "Performance",
                "business_question": "What was the company's operating revenue, expense allocation, and net bottom line profit?",
                "description": "Standard income statement categorizing operational revenues, cost outflows, and net margin %.",
                "icon": "fa-solid fa-file-invoice-dollar",
                "supported_basis": ["cash", "accrual"],
                "supported_formats": ["json", "xlsx", "csv", "pdf"],
                "required_permission": "finance.report.read",
                "badge": "Core Financial",
            },
            {
                "key": "cash-flow",
                "title": "Statement of Cash Flows",
                "category": "Cash & Banking",
                "business_question": "How did cash inflows and outflows reconcile between operating, investing, and financing activities?",
                "description": "Comprehensive cash flow statement reconciling beginning to ending cash balances.",
                "icon": "fa-solid fa-money-bill-trend-up",
                "supported_basis": ["cash"],
                "supported_formats": ["json", "xlsx", "csv", "pdf"],
                "required_permission": "finance.report.read",
                "badge": "Cash Flow",
            },
            {
                "key": "ar-aging",
                "title": "Accounts Receivable (AR) Aging",
                "category": "Sales & Receivables",
                "business_question": "How overdue are client invoice balances partitioned across 30-day aging buckets?",
                "description": "Customer invoice aging schedule categorized into current, 1-30, 31-60, 61-90, and 90+ day tiers.",
                "icon": "fa-solid fa-user-clock",
                "supported_basis": ["accrual"],
                "supported_formats": ["json", "xlsx", "csv", "pdf"],
                "required_permission": "finance.report.read",
                "badge": "Aging",
            },
            {
                "key": "ap-aging",
                "title": "Accounts Payable (AP) Aging",
                "category": "Spend & Payables",
                "business_question": "What vendor bills and disbursements are due or past due across 30-day aging buckets?",
                "description": "Vendor bill aging schedule partitioned into current, 1-30, 31-60, 61-90, and 90+ day tiers.",
                "icon": "fa-solid fa-receipt",
                "supported_basis": ["accrual"],
                "supported_formats": ["json", "xlsx", "csv", "pdf"],
                "required_permission": "finance.report.read",
                "badge": "Aging",
            },
            {
                "key": "balance-sheet",
                "title": "Balance Sheet (Statement of Financial Position)",
                "category": "Audit & Compliance",
                "business_question": "What are company total assets, liabilities, and owners' equity balances as of a cutoff date?",
                "description": "Core balance sheet statement enforcing the fundamental accounting equation Assets = Liabilities + Equity.",
                "icon": "fa-solid fa-building-columns",
                "supported_basis": ["accrual"],
                "supported_formats": ["json", "xlsx", "csv", "pdf"],
                "required_permission": "finance.report.read",
                "badge": "Core Financial",
            },
            {
                "key": "trial-balance",
                "title": "Trial Balance Ledger Audit",
                "category": "Audit & Compliance",
                "business_question": "Do total debit balances equal total credit balances across all active chart of accounts?",
                "description": "Audit report verifying zero debit-credit variance across all posted ledger lines.",
                "icon": "fa-solid fa-scale-unbalanced",
                "supported_basis": ["accrual", "cash"],
                "supported_formats": ["json", "xlsx", "csv", "pdf"],
                "required_permission": "finance.report.read",
                "badge": "Audit",
            },
        ]
        return {
            "categories": categories,
            "reports": reports,
        }

    # ------------------------------------------------------------------
    # 7. Saved Report Views Management
    # ------------------------------------------------------------------
    def list_saved_views(
        self, report_key: Optional[str] = None, user_email: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        q = self.db.query(FinanceSavedReportViewDB)
        if report_key:
            q = q.filter(FinanceSavedReportViewDB.report_key == report_key)
        views = q.order_by(FinanceSavedReportViewDB.is_default.desc(), FinanceSavedReportViewDB.id.desc()).all()

        results = []
        for v in views:
            filters_parsed = {}
            if v.filters_json:
                try:
                    filters_parsed = json.loads(v.filters_json)
                except Exception:
                    filters_parsed = {}
            results.append({
                "id": v.id,
                "report_key": v.report_key,
                "view_name": v.view_name,
                "filters": filters_parsed,
                "created_by": v.created_by,
                "created_at": v.created_at,
                "is_default": v.is_default,
            })
        return results

    def create_saved_view(
        self,
        report_key: str,
        view_name: str,
        filters: Dict[str, Any],
        user_email: Optional[str] = None,
        is_default: bool = False,
    ) -> Dict[str, Any]:
        if not view_name or not view_name.strip():
            raise ValueError("View name cannot be empty.")

        if is_default:
            # Unset any existing default for this report
            self.db.query(FinanceSavedReportViewDB).filter(
                FinanceSavedReportViewDB.report_key == report_key,
                FinanceSavedReportViewDB.is_default == True,
            ).update({"is_default": False})

        new_view = FinanceSavedReportViewDB(
            report_key=report_key,
            view_name=view_name.strip(),
            filters_json=json.dumps(filters or {}),
            created_by=user_email,
            created_at=datetime.utcnow(),
            is_default=is_default,
        )
        self.db.add(new_view)
        self.db.commit()
        self.db.refresh(new_view)

        return {
            "id": new_view.id,
            "report_key": new_view.report_key,
            "view_name": new_view.view_name,
            "filters": filters or {},
            "created_by": new_view.created_by,
            "created_at": new_view.created_at,
            "is_default": new_view.is_default,
        }

    def delete_saved_view(self, view_id: int) -> bool:
        view = self.db.query(FinanceSavedReportViewDB).filter(FinanceSavedReportViewDB.id == view_id).first()
        if not view:
            return False
        self.db.delete(view)
        self.db.commit()
        return True

    # ------------------------------------------------------------------
    # 8. Contextual Drill-Down Records
    # ------------------------------------------------------------------
    def get_report_drilldown(
        self,
        report_key: str,
        drilldown_type: str,
        drilldown_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        currency: Optional[str] = None,
        entity: Optional[str] = None,
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Fetches the granular contributing ledger transactions or documents
        for a clicked total, cell, or category in any report without losing context.
        """
        scope = self._scope(book)
        records = []
        target_title = f"{report_key} - {drilldown_type}"
        total_amount = 0.0

        if drilldown_type in ("category", "category_spend"):
            q = (
                self.db.query(LedgerTransactionDB)
                .join(FinanceBankAccountDB, LedgerTransactionDB.account_id == FinanceBankAccountDB.id)
                .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            )
            if drilldown_id and drilldown_id.isdigit():
                cat_id = int(drilldown_id)
                q = q.filter(LedgerTransactionDB.category_id == cat_id)
                cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.id == cat_id).first()
                if cat:
                    target_title = f"Category: {cat.name}"
            elif drilldown_id:
                q = q.filter(TransactionCategoryDB.name.ilike(f"%{drilldown_id}%"))
                target_title = f"Category: {drilldown_id}"

            if date_from:
                q = q.filter(LedgerTransactionDB.date >= date_from)
            if date_to:
                q = q.filter(LedgerTransactionDB.date <= date_to)
            if currency and currency.upper() != "ALL":
                q = q.filter(LedgerTransactionDB.currency == currency.upper())

            # Operational outflows
            q = q.filter(LedgerTransactionDB.direction == "out")
            q = scope.filter(q, LedgerTransactionDB.account_id)
            txs = q.order_by(LedgerTransactionDB.date.desc(), LedgerTransactionDB.id.desc()).limit(150).all()

            for t in txs:
                records.append({
                    "id": t.id,
                    "date": t.date,
                    "account_name": t.account.account_name if t.account else "Unknown",
                    "description": t.description,
                    "reference": t.reference,
                    "category": t.category.name if t.category else "Uncategorized",
                    "counterparty": t.counterparty or "",
                    "amount": round(t.amount, 2),
                    "currency": t.currency,
                    "direction": t.direction,
                })
                total_amount += t.amount

        elif drilldown_type in ("account", "account_balance"):
            q = self.db.query(LedgerTransactionDB)
            if drilldown_id and drilldown_id.isdigit():
                acc_id = int(drilldown_id)
                q = q.filter(LedgerTransactionDB.account_id == acc_id)
                acc = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == acc_id).first()
                if acc:
                    target_title = f"Account: {acc.account_name}"
            if date_to:
                q = q.filter(LedgerTransactionDB.date <= date_to)
            q = scope.filter(q, LedgerTransactionDB.account_id)

            txs = q.order_by(LedgerTransactionDB.date.desc(), LedgerTransactionDB.id.desc()).limit(150).all()
            for t in txs:
                records.append({
                    "id": t.id,
                    "date": t.date,
                    "description": t.description,
                    "reference": t.reference,
                    "amount": round(t.amount, 2),
                    "currency": t.currency,
                    "direction": t.direction,
                    "running_balance": round(t.running_balance, 2),
                })
                total_amount += (t.amount if t.direction == "in" else -t.amount)

        elif drilldown_type in ("cheques", "cheque_status"):
            q = self.db.query(FinanceChequeDB)
            if drilldown_id and drilldown_id.lower() != "all":
                q = q.filter(FinanceChequeDB.status == drilldown_id.lower())
                target_title = f"Cheques Status: {drilldown_id.upper()}"
            chqs = q.order_by(FinanceChequeDB.issue_date.desc()).limit(150).all()
            for c in chqs:
                records.append({
                    "id": c.id,
                    "cheque_number": c.cheque_number,
                    "issue_date": c.issue_date,
                    "clear_date": c.clear_date or "",
                    "payee": c.payee,
                    "amount": round(c.amount, 2),
                    "currency": c.currency,
                    "status": c.status,
                    "purpose": c.purpose_type,
                })
                total_amount += c.amount

        return {
            "report_key": report_key,
            "drilldown_type": drilldown_type,
            "target_title": target_title,
            "total_records": len(records),
            "total_amount": round(total_amount, 2),
            "currency": currency or "USD",
            "records": records,
        }

    # ------------------------------------------------------------------
    # Core Accounting & Aging Reports (Story 7.2)
    # ------------------------------------------------------------------
    def get_profit_and_loss(
        self,
        entity: Optional[str] = "all",
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        basis: str = "cash",
        currency: str = "USD",
        comparison: str = "none",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        scope = self._scope(book)
        today = datetime.utcnow().date()
        d_to = date_to or today.strftime("%Y-%m-%d")
        d_from = date_from or today.replace(day=1).strftime("%Y-%m-%d")
        curr_norm = (currency or "USD").upper()
        basis_norm = (basis or "cash").lower()
        entity_norm = (entity or "all").strip().lower()

        if curr_norm == "ALL":
            # D-026: one statement per currency, side by side; currencies are never added together
            currencies = sorted({
                (c or "USD").upper()
                for (c,) in scope.filter(self.db.query(FinanceBankAccountDB.currency).filter(FinanceBankAccountDB.is_active == True), FinanceBankAccountDB.id).distinct()  # noqa: E712
            } | {
                (c or "USD").upper() for (c,) in self.db.query(SalesInvoiceDB.currency).distinct()
            })
            columns = [
                self.get_profit_and_loss(entity=entity, date_from=date_from, date_to=date_to, basis=basis, currency=c, comparison=comparison, book=book)
                for c in currencies
            ]
            return {
                "report_title": "Profit & Loss Statement",
                "entity": entity_norm if entity_norm != "all" else "Voyance Health (Consolidated)",
                "basis": basis_norm,
                "currency": "ALL",
                "period_start": d_from,
                "period_end": d_to,
                "comparison_type": comparison,
                "revenue_items": [],
                "total_revenue": 0.0,
                "expense_items": [],
                "total_expenses": 0.0,
                "net_income": 0.0,
                "net_margin_pct": 0.0,
                "by_currency": columns,
                "basis_note": ACCRUAL_PARTIAL_NOTE if basis_norm == "accrual" else None,
                "book": scope.view,
            }

        inter_book_totals: Dict[str, float] = {}  # label -> amount (cash basis, single-book views only)

        def compute_pnl_range(start_d: str, end_d: str):
            rev_items = []
            exp_items = []
            total_rev = 0.0
            total_exp = 0.0

            if basis_norm == "accrual":
                inv_q = self.db.query(SalesInvoiceDB).filter(
                    SalesInvoiceDB.status.notin_(["draft", "void"]),
                    SalesInvoiceDB.issue_date >= start_d,
                    SalesInvoiceDB.issue_date <= end_d,
                )
                if curr_norm != "ALL":
                    inv_q = inv_q.filter(SalesInvoiceDB.currency == curr_norm)
                invoices = [i for i in inv_q.all() if self._invoice_in_scope(scope, i)]
                cust_rev = {}
                for inv in invoices:
                    cname = (inv.customer.name if inv.customer else None) or f"Customer #{inv.customer_id}"
                    amt = float(inv.subtotal or 0.0)  # net of VAT (D-023)
                    cust_rev[cname] = cust_rev.get(cname, 0.0) + amt
                    total_rev += amt

                for cname, amt in sorted(cust_rev.items(), key=lambda x: x[1], reverse=True):
                    rev_items.append({
                        "category_name": f"Sales: {cname}",
                        "amount": round(amt, 2),
                        "percentage": round((amt / total_rev * 100) if total_rev > 0 else 0.0, 1),
                    })

                bill_q = self.db.query(BillDB).filter(
                    BillDB.status.in_(SPEND_STATUSES),
                    BillDB.issue_date >= start_d,
                    BillDB.issue_date <= end_d,
                )
                if curr_norm != "ALL":
                    bill_q = bill_q.filter(BillDB.currency == curr_norm)
                bills = self._filter_bills(scope, bill_q.all())
                cat_exp = {}
                for b in bills:
                    cat = (b.vendor.name if b.vendor else None) or f"Vendor #{b.vendor_id}"
                    amt = float(b.total or 0.0)
                    cat_exp[cat] = cat_exp.get(cat, 0.0) + amt
                    total_exp += amt

                for cname, amt in sorted(cat_exp.items(), key=lambda x: x[1], reverse=True):
                    exp_items.append({
                        "category_name": f"Operating: {cname}",
                        "amount": round(amt, 2),
                        "percentage": round((amt / total_exp * 100) if total_exp > 0 else 0.0, 1),
                    })
            else:
                tx_q = self.db.query(
                    LedgerTransactionDB,
                    TransactionCategoryDB.name.label("category_name"),
                    TransactionCategoryDB.kind.label("category_kind"),
                ).outerjoin(
                    TransactionCategoryDB,
                    LedgerTransactionDB.category_id == TransactionCategoryDB.id,
                ).filter(
                    LedgerTransactionDB.date >= start_d,
                    LedgerTransactionDB.date <= end_d,
                )
                tx_q = scope.filter(tx_q, LedgerTransactionDB.account_id)
                if curr_norm != "ALL":
                    tx_q = tx_q.filter(LedgerTransactionDB.currency == curr_norm)
                txs = tx_q.all()

                cat_rev = {}
                cat_exp = {}
                for t, cname, ckind in txs:
                    # D-026: own-account movements count nowhere, reversals reduce the side they reverse
                    cls = cash_basis.classify_view(t, ckind, has_category=t.category_id is not None, scope=scope)
                    if not cls:
                        continue
                    side, amt, label = cls
                    if side in (cash_basis.TRANSFER_IN, cash_basis.TRANSFER_OUT):
                        # Inter-book movement: shown on its own line, never operating revenue or spend (D-028)
                        if (start_d, end_d) == (d_from, d_to):
                            inter_book_totals[label] = inter_book_totals.get(label, 0.0) + amt
                        continue
                    if side == cash_basis.REVENUE:
                        cat_display = label or cname or "Sales Revenue"
                        cat_rev[cat_display] = cat_rev.get(cat_display, 0.0) + amt
                        total_rev += amt
                    else:
                        cat_display = cname or "Uncategorized Expense"
                        cat_exp[cat_display] = cat_exp.get(cat_display, 0.0) + amt
                        total_exp += amt

                for cname, amt in sorted(cat_rev.items(), key=lambda x: x[1], reverse=True):
                    rev_items.append({
                        "category_name": cname,
                        "amount": round(amt, 2),
                        "percentage": round((amt / total_rev * 100) if total_rev > 0 else 0.0, 1),
                    })
                for cname, amt in sorted(cat_exp.items(), key=lambda x: x[1], reverse=True):
                    exp_items.append({
                        "category_name": cname,
                        "amount": round(amt, 2),
                        "percentage": round((amt / total_exp * 100) if total_exp > 0 else 0.0, 1),
                    })

            return round(total_rev, 2), rev_items, round(total_exp, 2), exp_items

        tot_rev, rev_list, tot_exp, exp_list = compute_pnl_range(d_from, d_to)
        net_inc = round(tot_rev - tot_exp, 2)
        margin = round((net_inc / tot_rev * 100) if tot_rev > 0 else 0.0, 1)

        prior_rev = None
        prior_exp = None
        prior_net = None
        comp_start = None
        comp_end = None

        if comparison in ("prior_period", "prior_year"):
            dt_start = datetime.strptime(d_from, "%Y-%m-%d").date()
            dt_end = datetime.strptime(d_to, "%Y-%m-%d").date()
            if comparison == "prior_year":
                comp_start = dt_start.replace(year=dt_start.year - 1).strftime("%Y-%m-%d")
                comp_end = dt_end.replace(year=dt_end.year - 1).strftime("%Y-%m-%d")
            else:
                from datetime import timedelta
                span_days = (dt_end - dt_start).days + 1
                comp_end = (dt_start - timedelta(days=1)).strftime("%Y-%m-%d")
                comp_start = (dt_start - timedelta(days=span_days)).strftime("%Y-%m-%d")

            p_rev, _, p_exp, _ = compute_pnl_range(comp_start, comp_end)
            prior_rev = p_rev
            prior_exp = p_exp
            prior_net = round(p_rev - p_exp, 2)

        return {
            "report_title": "Profit & Loss Statement",
            "entity": entity_norm if entity_norm != "all" else "Voyance Health (Consolidated)",
            "basis": basis_norm,
            "currency": curr_norm,
            "period_start": d_from,
            "period_end": d_to,
            "comparison_type": comparison,
            "comparison_start": comp_start,
            "comparison_end": comp_end,
            "revenue_items": rev_list,
            "total_revenue": tot_rev,
            "prior_revenue": prior_rev,
            "expense_items": exp_list,
            "total_expenses": tot_exp,
            "prior_expenses": prior_exp,
            "net_income": net_inc,
            "prior_net_income": prior_net,
            "net_margin_pct": margin,
            "basis_note": ACCRUAL_PARTIAL_NOTE if basis_norm == "accrual" else None,
            "book": scope.view,
            "inter_book_items": [
                {"label": label, "amount": round(amt, 2)} for label, amt in sorted(inter_book_totals.items())
            ],
        }

    def get_balance_sheet(
        self,
        entity: Optional[str] = "all",
        as_of_date: Optional[str] = None,
        basis: str = "accrual",
        currency: str = "USD",
        comparison: str = "none",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        scope = self._scope(book)
        today = datetime.utcnow().date()
        cutoff = as_of_date or today.strftime("%Y-%m-%d")
        curr_norm = (currency or "USD").upper()

        # 1. Cash & Bank Accounts (Point in time)
        pit = self.get_point_in_time_balances(cutoff, book=book)
        cash_items = []
        total_cash = 0.0
        for acc in pit.get("accounts", []):
            if curr_norm != "ALL" and acc.get("currency") != curr_norm:
                continue
            bal = float(acc.get("balance_as_of_date") or 0.0)
            cash_items.append({
                "name": f"{acc.get('account_name')} ({acc.get('currency')})",
                "account_id": acc.get("account_id"),
                "account_number": acc.get("account_number"),
                "amount": round(bal, 2),
                "note": acc.get("bank_name"),
            })
            total_cash += bal

        # 2. Accounts Receivable (Unpaid Invoices as of cutoff)
        ar_q = self.db.query(SalesInvoiceDB).filter(
            SalesInvoiceDB.status.notin_(["draft", "void", "paid"]),
            SalesInvoiceDB.issue_date <= cutoff,
        )
        if curr_norm != "ALL":
            ar_q = ar_q.filter(SalesInvoiceDB.currency == curr_norm)
        total_ar = 0.0
        for inv in ar_q.all():
            if not self._invoice_in_scope(scope, inv):
                continue
            paid_sum = inv_status.settled_amount(getattr(inv, "payments", []))
            rem = max(0.0, float(inv.total or 0.0) - paid_sum)
            if rem > 0:
                total_ar += rem

        asset_items = list(cash_items)
        if total_ar > 0:
            asset_items.append({
                "name": "Accounts Receivable (Trade Debtors)",
                "amount": round(total_ar, 2),
                "note": "Open client receivables",
            })
        total_assets = round(total_cash + total_ar, 2)

        # 3. Accounts Payable (Unpaid Bills as of cutoff)
        bill_filter = [
            BillDB.status.in_(OPEN_STATUSES),
            BillDB.issue_date <= cutoff,
        ]
        ap_q = self.db.query(BillDB).filter(*bill_filter)
        if curr_norm != "ALL":
            ap_q = ap_q.filter(BillDB.currency == curr_norm)
        total_ap = 0.0
        for b in self._filter_bills(scope, ap_q.all()):
            rem = max(0.0, float(b.total or 0.0) - float(getattr(b, "amount_paid", 0.0) or 0.0))
            if rem > 0:
                total_ap += rem

        # 4. Cheques Payable (Issued/Pending as of cutoff)
        chq_q = self.db.query(FinanceChequeDB).filter(
            FinanceChequeDB.status == "issued",
            FinanceChequeDB.issue_date <= cutoff,
        )
        chq_q = scope.filter(chq_q, FinanceChequeDB.account_id)
        if curr_norm != "ALL":
            chq_q = chq_q.filter(FinanceChequeDB.currency == curr_norm)
        total_chq_payable = round(sum(float(c.amount or 0.0) for c in chq_q.all()), 2)

        liab_items = []
        if total_ap > 0:
            liab_items.append({
                "name": "Accounts Payable (Trade Creditors)",
                "amount": round(total_ap, 2),
                "note": "Open vendor liabilities",
            })
        if total_chq_payable > 0:
            liab_items.append({
                "name": "Cheques Payable (Issued / In Transit)",
                "amount": round(total_chq_payable, 2),
                "note": "Issued uncleared cheques",
            })
        total_liab = round(total_ap + total_chq_payable, 2)

        # 5. Equity (Assets - Liabilities = Equity)
        retained_earnings = round(total_assets - total_liab, 2)
        equity_items = [{
            "name": "Retained Earnings & Cumulative Net Income",
            "amount": retained_earnings,
            "note": "Book balance reconciliation",
        }]
        total_equity = retained_earnings
        total_liab_and_equity = round(total_liab + total_equity, 2)

        return {
            "report_title": "Balance Sheet",
            "entity": entity or "Voyance Health (Consolidated)",
            "as_of_date": cutoff,
            "currency": curr_norm,
            "basis": basis,
            "assets": {
                "title": "Assets",
                "items": asset_items,
                "total": total_assets,
            },
            "liabilities": {
                "title": "Liabilities",
                "items": liab_items,
                "total": total_liab,
            },
            "equity": {
                "title": "Equity",
                "items": equity_items,
                "total": total_equity,
            },
            "total_assets": total_assets,
            "total_liabilities_and_equity": total_liab_and_equity,
            "is_balanced": abs(total_assets - total_liab_and_equity) < 0.01,
            "variance": round(total_assets - total_liab_and_equity, 2),
        }

    def get_trial_balance(
        self,
        entity: Optional[str] = "all",
        as_of_date: Optional[str] = None,
        currency: str = "USD",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        scope = self._scope(book)
        today = datetime.utcnow().date()
        cutoff = as_of_date or today.strftime("%Y-%m-%d")
        curr_norm = (currency or "USD").upper()

        lines = []
        total_debits = 0.0
        total_credits = 0.0

        # Asset accounts (Bank / Cash)
        pit = self.get_point_in_time_balances(cutoff, book=book)
        for acc in pit.get("accounts", []):
            if curr_norm != "ALL" and acc.get("currency") != curr_norm:
                continue
            bal = float(acc.get("balance_as_of_date") or 0.0)
            code = f"1000-{acc.get('account_id')}"
            name = f"{acc.get('account_name')} ({acc.get('currency')})"
            if bal >= 0:
                lines.append({"code": code, "name": name, "type": "asset", "debit": round(bal, 2), "credit": 0.0})
                total_debits += bal
            else:
                lines.append({"code": code, "name": name, "type": "asset", "debit": 0.0, "credit": round(abs(bal), 2)})
                total_credits += abs(bal)

        # Accounts Receivable (Asset - Debit)
        ar_q = self.db.query(SalesInvoiceDB).filter(
            SalesInvoiceDB.status.notin_(["draft", "void", "paid"]),
            SalesInvoiceDB.issue_date <= cutoff,
        )
        if curr_norm != "ALL":
            ar_q = ar_q.filter(SalesInvoiceDB.currency == curr_norm)
        total_ar = 0.0
        for inv in ar_q.all():
            if not self._invoice_in_scope(scope, inv):
                continue
            paid_sum = inv_status.settled_amount(getattr(inv, "payments", []))
            rem = max(0.0, float(inv.total or 0.0) - paid_sum)
            total_ar += rem
        if total_ar > 0:
            lines.append({"code": "1100-AR", "name": "Accounts Receivable (Trade)", "type": "asset", "debit": round(total_ar, 2), "credit": 0.0})
            total_debits += total_ar

        # Accounts Payable (Liability - Credit)
        ap_q = self.db.query(BillDB).filter(
            BillDB.status.in_(OPEN_STATUSES),
            BillDB.issue_date <= cutoff,
        )
        if curr_norm != "ALL":
            ap_q = ap_q.filter(BillDB.currency == curr_norm)
        total_ap = sum(max(0.0, float(b.total or 0.0) - float(getattr(b, "amount_paid", 0.0) or 0.0)) for b in self._filter_bills(scope, ap_q.all()))
        if total_ap > 0:
            lines.append({"code": "2000-AP", "name": "Accounts Payable (Trade)", "type": "liability", "debit": 0.0, "credit": round(total_ap, 2)})
            total_credits += total_ap

        # Cheques Payable (Liability - Credit)
        chq_q = self.db.query(FinanceChequeDB).filter(
            FinanceChequeDB.status == "issued",
            FinanceChequeDB.issue_date <= cutoff,
        )
        chq_q = scope.filter(chq_q, FinanceChequeDB.account_id)
        if curr_norm != "ALL":
            chq_q = chq_q.filter(FinanceChequeDB.currency == curr_norm)
        total_chq = sum(float(c.amount or 0.0) for c in chq_q.all())
        if total_chq > 0:
            lines.append({"code": "2100-CP", "name": "Cheques Payable", "type": "liability", "debit": 0.0, "credit": round(total_chq, 2)})
            total_credits += total_chq

        # Balancing Equity line (Retained Earnings) ensuring Debits == Credits!
        diff = round(total_debits - total_credits, 2)
        if diff >= 0:
            lines.append({"code": "3000-EQ", "name": "Retained Earnings / Owners' Equity", "type": "equity", "debit": 0.0, "credit": diff})
            total_credits += diff
        else:
            lines.append({"code": "3000-EQ", "name": "Retained Deficit / Owners' Equity", "type": "equity", "debit": abs(diff), "credit": 0.0})
            total_debits += abs(diff)

        return {
            "report_title": "Trial Balance",
            "entity": entity or "Voyance Health (Consolidated)",
            "as_of_date": cutoff,
            "currency": curr_norm,
            "lines": lines,
            "total_debits": round(total_debits, 2),
            "total_credits": round(total_credits, 2),
            "variance": round(total_debits - total_credits, 2),
            "is_balanced": abs(total_debits - total_credits) < 0.01,
        }

    def get_cash_flow_statement(
        self,
        entity: Optional[str] = "all",
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        currency: str = "USD",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        scope = self._scope(book)
        today = datetime.utcnow().date()
        d_to = date_to or today.strftime("%Y-%m-%d")
        d_from = date_from or today.replace(day=1).strftime("%Y-%m-%d")
        curr_norm = (currency or "USD").upper()

        # Closing balance (balance at the end of d_to)
        pit_end = self.get_point_in_time_balances(d_to, book=book)
        in_scope = [a for a in pit_end.get("accounts", []) if curr_norm == "ALL" or a.get("currency") == curr_norm]
        end_cash = sum(float(a.get("balance_as_of_date") or 0.0) for a in in_scope)

        # Opening balance: at the START of d_from, before that day's transactions (BI-1: the first day is no longer
        # counted twice). Year-boundary differences between an entered yearly opening and the previous closing
        # are listed as explicit fiscal-year adjustments.
        acc_objs = {a.id: a for a in self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id.in_([a["account_id"] for a in in_scope] or [0])).all()}
        all_openings = year_openings.load_openings(self.db, list(acc_objs))
        beg_cash = 0.0
        adjustments: List[Dict[str, Any]] = []
        for aid, acc_obj in acc_objs.items():
            ops = all_openings.get(aid, {})
            beg_cash += year_openings.balance_at_start_of(self.db, acc_obj, d_from, ops)
            for y in sorted(ops):
                if d_from < f"{y:04d}-01-01" <= d_to:
                    variance = year_openings.year_opening_info(self.db, acc_obj, y, ops)["variance"]
                    if variance is not None and abs(variance) > 0.005:
                        adjustments.append({"account_id": aid, "account_name": acc_obj.account_name, "currency": acc_obj.currency,
                                            "year": y, "amount": round(variance, 2)})
        adjustments_total = round(sum(a["amount"] for a in adjustments), 2)

        # Inflows & Outflows during period
        tx_q = self.db.query(LedgerTransactionDB).filter(
            LedgerTransactionDB.date >= d_from,
            LedgerTransactionDB.date <= d_to,
        )
        tx_q = scope.filter(tx_q, LedgerTransactionDB.account_id)
        if curr_norm != "ALL":
            tx_q = tx_q.filter(LedgerTransactionDB.currency == curr_norm)
        txs = tx_q.all()

        op_in = 0.0
        op_out = 0.0
        ib_in = 0.0   # inter-book legs, split out in single-book views so the statement still reconciles
        ib_out = 0.0
        for t in txs:
            amt = float(t.amount or 0.0)
            inter = scope.restricts and scope.inter_book(t)
            if t.direction == "in":
                if inter:
                    ib_in += amt
                else:
                    op_in += amt
            else:
                if inter:
                    ib_out += amt
                else:
                    op_out += amt

        operating_items = [
            {"name": "Cash Receipts from Customers & Operational Inflows", "amount": round(op_in, 2), "activity_type": "operating"},
            {"name": "Cash Payments for Suppliers & Operational Outflows", "amount": -round(op_out, 2), "activity_type": "operating"},
        ]
        net_op = round(op_in - op_out, 2)
        net_inv = 0.0
        financing_items = []
        if scope.restricts and (ib_in or ib_out):
            to_label = books.TRANSFERRED_TO_OVERSEAS if scope.view == books.LOCAL else books.TRANSFERRED_TO_LOCAL
            from_label = books.INCOME_FROM_OVERSEAS if scope.view == books.LOCAL else books.RECEIVED_FROM_LOCAL
            if ib_in:
                financing_items.append({"name": from_label, "amount": round(ib_in, 2), "activity_type": "financing"})
            if ib_out:
                financing_items.append({"name": to_label, "amount": -round(ib_out, 2), "activity_type": "financing"})
        net_fin = round(ib_in - ib_out, 2)
        net_change = round(net_op + net_inv + net_fin, 2)
        unexplained = round(end_cash - (beg_cash + net_change + adjustments_total), 2)

        return {
            "report_title": "Statement of Cash Flows",
            "entity": entity or "Voyance Health (Consolidated)",
            "currency": curr_norm,
            "date_from": d_from,
            "date_to": d_to,
            "operating_activities": operating_items,
            "net_cash_operating": net_op,
            "investing_activities": [],
            "net_cash_investing": net_inv,
            "financing_activities": financing_items,
            "net_cash_financing": net_fin,
            "net_change_in_cash": net_change,
            "beginning_cash_balance": round(beg_cash, 2),
            "ending_cash_balance": round(end_cash, 2),
            "fiscal_year_adjustments": adjustments,
            "fiscal_year_adjustments_total": adjustments_total,
            "unexplained_difference": unexplained,
            "is_reconciled": abs(unexplained) <= 0.01,
        }

    def get_ar_aging_report(
        self,
        entity: Optional[str] = "all",
        as_of_date: Optional[str] = None,
        currency: str = "USD",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        scope = self._scope(book)
        today = datetime.utcnow().date()
        cutoff_str = as_of_date or today.strftime("%Y-%m-%d")
        cutoff_dt = datetime.strptime(cutoff_str, "%Y-%m-%d").date()
        curr_norm = (currency or "USD").upper()

        q = self.db.query(SalesInvoiceDB).filter(
            SalesInvoiceDB.status.notin_(["draft", "void", "paid"]),
            SalesInvoiceDB.issue_date <= cutoff_str,
        )
        if curr_norm != "ALL":
            q = q.filter(SalesInvoiceDB.currency == curr_norm)

        invoices = [i for i in q.all() if self._invoice_in_scope(scope, i)]
        by_customer = {}

        totals = {"current": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_over_90": 0.0, "total": 0.0}
        total_open = 0

        for inv in invoices:
            paid_sum = inv_status.settled_amount(getattr(inv, "payments", []))
            bal = max(0.0, float(inv.total or 0.0) - paid_sum)
            if bal <= 0.01:
                continue

            total_open += 1
            due_str = inv.due_date or inv.issue_date
            try:
                due_dt = datetime.strptime(due_str, "%Y-%m-%d").date()
            except Exception:
                due_dt = cutoff_dt
            overdue_days = (cutoff_dt - due_dt).days

            cid = inv.customer_id or 0
            cname = (inv.customer.name if inv.customer else None) or f"Customer #{cid}"

            if cid not in by_customer:
                by_customer[cid] = {
                    "id": cid,
                    "name": cname,
                    "buckets": {"current": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_over_90": 0.0, "total": 0.0},
                    "outstanding_count": 0,
                }

            row = by_customer[cid]
            row["outstanding_count"] += 1
            row["buckets"]["total"] += bal
            totals["total"] += bal

            if overdue_days <= 0:
                row["buckets"]["current"] += bal
                totals["current"] += bal
            elif overdue_days <= 30:
                row["buckets"]["days_1_30"] += bal
                totals["days_1_30"] += bal
            elif overdue_days <= 60:
                row["buckets"]["days_31_60"] += bal
                totals["days_31_60"] += bal
            elif overdue_days <= 90:
                row["buckets"]["days_61_90"] += bal
                totals["days_61_90"] += bal
            else:
                row["buckets"]["days_over_90"] += bal
                totals["days_over_90"] += bal

        rows = []
        for c in by_customer.values():
            b = c["buckets"]
            rows.append({
                "id": c["id"],
                "name": c["name"],
                "buckets": {k: round(v, 2) for k, v in b.items()},
                "outstanding_count": c["outstanding_count"],
            })

        rows.sort(key=lambda x: x["buckets"]["total"], reverse=True)

        return {
            "report_title": "Accounts Receivable (AR) Aging",
            "aging_type": "ar",
            "entity": entity or "Voyance Health (Consolidated)",
            "as_of_date": cutoff_str,
            "currency": curr_norm,
            "rows": rows,
            "totals": {k: round(v, 2) for k, v in totals.items()},
            "total_open_count": total_open,
        }

    def get_ap_aging_report(
        self,
        entity: Optional[str] = "all",
        as_of_date: Optional[str] = None,
        currency: str = "USD",
        book: Optional[str] = None,
    ) -> Dict[str, Any]:
        scope = self._scope(book)
        today = datetime.utcnow().date()
        cutoff_str = as_of_date or today.strftime("%Y-%m-%d")
        cutoff_dt = datetime.strptime(cutoff_str, "%Y-%m-%d").date()
        curr_norm = (currency or "USD").upper()

        q = self.db.query(BillDB).filter(
            BillDB.status.in_(OPEN_STATUSES),
            BillDB.issue_date <= cutoff_str,
        )
        if curr_norm != "ALL":
            q = q.filter(BillDB.currency == curr_norm)

        bills = self._filter_bills(scope, q.all())
        by_vendor = {}

        totals = {"current": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_over_90": 0.0, "total": 0.0}
        total_open = 0

        for b in bills:
            bal = max(0.0, float(b.total or 0.0) - float(getattr(b, "amount_paid", 0.0) or 0.0))
            if bal <= 0.01:
                continue

            total_open += 1
            due_str = b.due_date or b.issue_date
            try:
                due_dt = datetime.strptime(due_str, "%Y-%m-%d").date()
            except Exception:
                due_dt = cutoff_dt
            overdue_days = (cutoff_dt - due_dt).days

            vid = b.vendor_id or 0
            vname = (b.vendor.name if b.vendor else None) or f"Vendor #{vid}"

            if vid not in by_vendor:
                by_vendor[vid] = {
                    "id": vid,
                    "name": vname,
                    "buckets": {"current": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_over_90": 0.0, "total": 0.0},
                    "outstanding_count": 0,
                }

            row = by_vendor[vid]
            row["outstanding_count"] += 1
            row["buckets"]["total"] += bal
            totals["total"] += bal

            if overdue_days <= 0:
                row["buckets"]["current"] += bal
                totals["current"] += bal
            elif overdue_days <= 30:
                row["buckets"]["days_1_30"] += bal
                totals["days_1_30"] += bal
            elif overdue_days <= 60:
                row["buckets"]["days_31_60"] += bal
                totals["days_31_60"] += bal
            elif overdue_days <= 90:
                row["buckets"]["days_61_90"] += bal
                totals["days_61_90"] += bal
            else:
                row["buckets"]["days_over_90"] += bal
                totals["days_over_90"] += bal

        rows = []
        for v in by_vendor.values():
            b = v["buckets"]
            rows.append({
                "id": v["id"],
                "name": v["name"],
                "buckets": {k: round(v, 2) for k, v in b.items()},
                "outstanding_count": v["outstanding_count"],
            })

        rows.sort(key=lambda x: x["buckets"]["total"], reverse=True)

        return {
            "report_title": "Accounts Payable (AP) Aging",
            "aging_type": "ap",
            "entity": entity or "Voyance Health (Consolidated)",
            "as_of_date": cutoff_str,
            "currency": curr_norm,
            "rows": rows,
            "totals": {k: round(v, 2) for k, v in totals.items()},
            "total_open_count": total_open,
        }

    # ------------------------------------------------------------------
    # 13. Story 7.3: Controlled Exports & Audit Logging
    # ------------------------------------------------------------------
    def record_export_audit(
        self,
        report_key: str,
        export_format: str,
        user_email: Optional[str],
        row_count: int,
        file_name: str,
        filters: Dict[str, Any],
    ) -> FinanceExportAuditDB:
        record = FinanceExportAuditDB(
            report_key=report_key,
            export_format=export_format.lower(),
            user_email=user_email,
            row_count=row_count,
            file_name=file_name,
            filters_json=json.dumps(filters or {}),
            created_at=datetime.utcnow(),
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)
        return record

    def list_export_audits(self, report_key: Optional[str] = None, limit: int = 50) -> List[FinanceExportAuditDB]:
        q = self.db.query(FinanceExportAuditDB)
        if report_key:
            q = q.filter(FinanceExportAuditDB.report_key == report_key)
        return q.order_by(FinanceExportAuditDB.id.desc()).limit(limit).all()

    def generate_report_export(
        self,
        report_key: str,
        export_format: str,
        filters: Dict[str, Any],
        user_email: Optional[str] = None,
        can_view_sensitive: bool = True,
    ) -> Tuple[bytes, str, str]:
        export_fmt = (export_format or "xlsx").lower()
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        file_stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

        metadata = {
            "entity": filters.get("entity", "Voyance Health (Consolidated)"),
            "basis": filters.get("basis", "cash"),
            "currency": filters.get("currency", "USD"),
            "book": {"local": "Local", "overseas": "Overseas", "consolidated": "Consolidated"}.get(str(filters.get("book") or "").lower(), "All accounts"),
            "period": f"{filters.get('date_from', 'Beginning')} to {filters.get('date_to', 'Current')}" if filters.get("date_from") or filters.get("date_to") else "As Of Cutoff",
            "generated_at": now_str,
            "requesting_user": user_email or "System User",
        }

        # Calculate underlying report data
        row_count = 0
        data: Dict[str, Any] = {}

        if report_key == "profit-and-loss":
            data = self.get_profit_and_loss(
                book=filters.get("book"),
                entity=filters.get("entity", "all"),
                basis=filters.get("basis", "cash"),
                currency=filters.get("currency", "USD"),
                date_from=filters.get("date_from"),
                date_to=filters.get("date_to"),
                comparison=filters.get("comparison", "none"),
            )
            row_count = len(data.get("revenue_items", [])) + len(data.get("expense_items", []))
        elif report_key == "balance-sheet":
            data = self.get_balance_sheet(
                book=filters.get("book"),
                entity=filters.get("entity", "all"),
                as_of_date=filters.get("as_of_date") or filters.get("date_to"),
                currency=filters.get("currency", "USD"),
                basis=filters.get("basis", "accrual"),
            )
            row_count = (
                len(data.get("assets", {}).get("items", []))
                + len(data.get("liabilities", {}).get("items", []))
                + len(data.get("equity", {}).get("items", []))
            )
        elif report_key == "trial-balance":
            data = self.get_trial_balance(
                book=filters.get("book"),
                entity=filters.get("entity", "all"),
                as_of_date=filters.get("as_of_date") or filters.get("date_to"),
                currency=filters.get("currency", "USD"),
            )
            row_count = len(data.get("lines", []))
        elif report_key == "cash-flow":
            data = self.get_cash_flow_statement(
                book=filters.get("book"),
                entity=filters.get("entity", "all"),
                date_from=filters.get("date_from"),
                date_to=filters.get("date_to"),
                currency=filters.get("currency", "USD"),
            )
            row_count = (
                len(data.get("operating_activities", []))
                + len(data.get("investing_activities", []))
                + len(data.get("financing_activities", []))
            )
        elif report_key == "ar-aging":
            data = self.get_ar_aging_report(
                book=filters.get("book"),
                entity=filters.get("entity", "all"),
                as_of_date=filters.get("as_of_date") or filters.get("date_to"),
                currency=filters.get("currency", "USD"),
            )
            row_count = len(data.get("rows", []))
        elif report_key == "ap-aging":
            data = self.get_ap_aging_report(
                book=filters.get("book"),
                entity=filters.get("entity", "all"),
                as_of_date=filters.get("as_of_date") or filters.get("date_to"),
                currency=filters.get("currency", "USD"),
            )
            row_count = len(data.get("rows", []))
        elif report_key == "category-summary":
            data = self.get_category_summary(
                date_from=filters.get("date_from"),
                date_to=filters.get("date_to"),
                currency=filters.get("currency", "USD"),
            )
            row_count = len(data.get("categories", []))
        elif report_key == "matrix":
            yr = int(filters.get("fiscal_year", datetime.utcnow().year))
            data = self.get_annual_category_matrix(
                year=yr,
                currency=filters.get("currency", "USD"),
                period_group=filters.get("period_group", "month"),
            )
            row_count = len(data.get("rows", []))
        elif report_key == "balances":
            data = self.get_point_in_time_balances(
                book=filters.get("book"),
                as_of_date=filters.get("as_of_date") or filters.get("date_to")
            )
            row_count = len(data.get("accounts", []))
        elif report_key == "fiscal-year-summary":
            data = self.get_fiscal_year_summary(
                year=int(filters.get("year") or datetime.utcnow().year),
                book=filters.get("book"),
                month=int(filters["month"]) if filters.get("month") else None,
            )
            row_count = len(data.get("accounts", []))
        elif report_key == "transactions":
            acc_id = int(filters["account_id"]) if filters.get("account_id") else None
            cat_id = int(filters["category_id"]) if filters.get("category_id") else None
            data = self.get_transaction_ledger(
                account_id=acc_id,
                category_id=cat_id,
                direction=filters.get("direction"),
                date_from=filters.get("date_from"),
                date_to=filters.get("date_to"),
                search=filters.get("search"),
            )
            row_count = len(data.get("transactions", []))
        elif report_key == "revenue-breakdown":
            data = self.get_revenue_breakdown(
                date_from=filters.get("date_from"),
                date_to=filters.get("date_to"),
                currency=filters.get("currency", "ALL"),
                book=filters.get("book"),
            )
            row_count = len(data.get("rows", []))
        elif report_key == "subscription-spend":
            data = self.get_subscription_spend(
                date_from=filters.get("date_from"),
                date_to=filters.get("date_to"),
                currency=filters.get("currency", "ALL"),
                book=filters.get("book"),
            )
            row_count = len(data.get("rows", []))
        elif report_key == "subscription-proofs-missing":
            data = self.get_subscription_proofs_missing(book=filters.get("book"))
            row_count = len(data.get("rows", []))
        elif report_key == "cheques":
            data = self.get_cheque_register(
                fiscal_year=str(filters.get("fiscal_year", datetime.utcnow().year)),
                status=filters.get("status"),
            )
            row_count = len(data.get("cheques", []))
        else:
            # Fallback to category summary
            data = self.get_category_summary(
                date_from=filters.get("date_from"),
                date_to=filters.get("date_to"),
                currency=filters.get("currency", "USD"),
            )
            row_count = len(data.get("categories", []))

        # Format generation
        if export_fmt == "csv":
            file_bytes = export_report_csv(data, report_key, metadata, can_view_sensitive)
            file_name = f"{report_key}_{file_stamp}.csv"
            mime = "text/csv"
        elif export_fmt == "pdf":
            # For PDF, generate a clean CSV formatted with metadata headers and UTF-8 bom/content
            file_bytes = export_report_csv(data, report_key, metadata, can_view_sensitive)
            file_name = f"{report_key}_{file_stamp}.pdf"
            mime = "application/pdf"
        else:
            # Default XLSX
            mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            file_name = f"{report_key}_{file_stamp}.xlsx"
            if report_key == "profit-and-loss":
                file_bytes = export_profit_and_loss_xlsx(data, metadata, can_view_sensitive)
            elif report_key == "balance-sheet":
                file_bytes = export_balance_sheet_xlsx(data, metadata, can_view_sensitive)
            elif report_key == "trial-balance":
                file_bytes = export_trial_balance_xlsx(data, metadata, can_view_sensitive)
            elif report_key == "cash-flow":
                file_bytes = export_cash_flow_xlsx(data, metadata, can_view_sensitive)
            elif report_key in ("ar-aging", "ap-aging"):
                file_bytes = export_aging_xlsx(data, metadata, can_view_sensitive)
            elif report_key == "category-summary":
                file_bytes = export_category_summary_xlsx(data)
            elif report_key == "matrix":
                file_bytes = export_category_matrix_xlsx(data)
            elif report_key == "balances":
                file_bytes = export_balances_xlsx(data)
            elif report_key == "fiscal-year-summary":
                file_bytes = export_fiscal_year_summary_xlsx(data)
            elif report_key == "transactions":
                file_bytes = export_transactions_xlsx(data)
            elif report_key in FLAT_REPORTS:
                file_bytes = export_flat_xlsx(report_key, data, metadata)
            elif report_key == "cheques":
                file_bytes = export_cheques_xlsx(data)
            else:
                file_bytes = export_category_summary_xlsx(data)

        # Audit record
        self.record_export_audit(
            report_key=report_key,
            export_format=export_fmt,
            user_email=user_email,
            row_count=row_count,
            file_name=file_name,
            filters=filters,
        )

        return file_bytes, file_name, mime

    # ------------------------------------------------------------------
    # 14. Story 7.3: Scheduled Report Deliveries
    # ------------------------------------------------------------------
    def create_schedule(
        self,
        report_key: str,
        report_title: str,
        frequency: str,
        recipients: List[str],
        export_format: str,
        filters: Dict[str, Any],
        created_by: Optional[str] = None,
    ) -> FinanceReportScheduleDB:
        sch = FinanceReportScheduleDB(
            report_key=report_key,
            report_title=report_title,
            frequency=frequency.lower(),
            recipients_json=json.dumps(recipients or []),
            export_format=export_format.lower(),
            filters_json=json.dumps(filters or {}),
            is_active=True,
            created_by=created_by,
            created_at=datetime.utcnow(),
        )
        self.db.add(sch)
        self.db.commit()
        self.db.refresh(sch)
        return {
            "id": sch.id,
            "report_key": sch.report_key,
            "report_title": sch.report_title,
            "frequency": sch.frequency,
            "recipients": recipients or [],
            "export_format": sch.export_format,
            "filters": filters or {},
            "is_active": sch.is_active,
            "created_by": sch.created_by,
            "created_at": sch.created_at,
        }

    def list_schedules(self, report_key: Optional[str] = None) -> List[Dict[str, Any]]:
        q = self.db.query(FinanceReportScheduleDB)
        if report_key:
            q = q.filter(FinanceReportScheduleDB.report_key == report_key)
        items = q.order_by(FinanceReportScheduleDB.id.desc()).all()

        results = []
        for it in items:
            recips = []
            if it.recipients_json:
                try:
                    recips = json.loads(it.recipients_json)
                except Exception:
                    recips = []
            filts = {}
            if it.filters_json:
                try:
                    filts = json.loads(it.filters_json)
                except Exception:
                    filts = {}
            results.append({
                "id": it.id,
                "report_key": it.report_key,
                "report_title": it.report_title,
                "frequency": it.frequency,
                "recipients": recips,
                "export_format": it.export_format,
                "filters": filts,
                "is_active": it.is_active,
                "created_by": it.created_by,
                "created_at": it.created_at,
            })
        return results

    def delete_schedule(self, schedule_id: int) -> bool:
        sch = self.db.query(FinanceReportScheduleDB).filter(FinanceReportScheduleDB.id == schedule_id).first()
        if not sch:
            return False
        self.db.delete(sch)
        self.db.commit()
        return True

    # ------------------------------------------------------------------
    # FUX-419: Compensation Spend & Variance Reporting
    # ------------------------------------------------------------------
    def get_employee_compensation_report(
        self,
        employee_id: int,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        currency: str = "USD",
    ) -> Dict[str, Any]:
        """
        Per-employee compensation report: total external, internal, commission, bonus,
        and grand total for a given employee across an arbitrary date range.
        """
        emp = self.db.query(EmployeeDB).filter(EmployeeDB.id == employee_id).first()
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee #{employee_id} not found"
            )

        results = self.payroll_read_service.get_employee_pay_lines(
            employee_id=employee_id,
            start=start_date,
            end=end_date,
            currency=currency,
        )

        by_type: Dict[str, float] = {}
        total_ext = 0.0
        total_int = 0.0
        total_comm = 0.0
        total_bonus = 0.0
        grand_total = 0.0
        run_ids = set()
        line_items = []

        for line, run in results:
            run_ids.add(run.id)
            ctype = line.compensation_type or "internal_usd_cash"
            amt = float(line.base_salary or 0.0) + float(line.allowances_total or 0.0)
            by_type[ctype] = round(by_type.get(ctype, 0.0) + amt, 2)
            grand_total += amt

            if ctype == "external_usd":
                total_ext += amt
            elif ctype == "internal_usd_cash":
                total_int += amt
            elif "commission" in ctype:
                total_comm += amt
            elif "bonus" in ctype:
                total_bonus += amt
            else:
                total_int += amt

            line_items.append({
                "id": line.id,
                "payroll_run_id": run.id,
                "period_label": run.period_label,
                "compensation_type": ctype,
                "base_salary": round(float(line.base_salary or 0.0), 2),
                "allowances_total": round(float(line.allowances_total or 0.0), 2),
                "deductions_total": round(float(line.deductions_total or 0.0), 2),
                "tax_amount": round(float(line.tax_amount or 0.0), 2),
                "net_pay": round(float(line.net_pay or 0.0), 2),
                "employer_cost_extra": round(float(line.employer_cost_extra or 0.0), 2),
                "payment_status": line.payment_status or "pending",
                "paid_at": line.paid_at.isoformat() if line.paid_at else None,
                "linked_payment_id": line.linked_payment_id,
            })

        return {
            "employee_id": emp.id,
            "employee_name": emp.name,
            "department": emp.dept or "General",
            "start_date": start_date,
            "end_date": end_date,
            "currency": currency or "USD",
            "by_compensation_type": by_type,
            "total_external": round(total_ext, 2),
            "total_internal": round(total_int, 2),
            "total_commission": round(total_comm, 2),
            "total_bonus": round(total_bonus, 2),
            "grand_total": round(grand_total, 2),
            "payroll_runs_count": len(run_ids),
            "lines": line_items,
        }

    def get_company_compensation_report(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        currency: str = "USD",
        breakdown_employees: bool = True,
    ) -> Dict[str, Any]:
        """
        Company salary spend report: aggregate total compensation across all employees
        for a selected period, broken down by compensation type, with per-employee breakdown.
        """
        query = (
            self.db.query(PayrollLineDB, PayrollRunDB)
            .join(PayrollRunDB, PayrollLineDB.payroll_run_id == PayrollRunDB.id)
            .filter(PayrollRunDB.status != "cancelled")
        )

        if start_date:
            query = query.filter(PayrollRunDB.period_end >= start_date)
        if end_date:
            query = query.filter(PayrollRunDB.period_start <= end_date)
        if currency and currency.upper() != "ALL":
            query = query.filter(PayrollRunDB.currency == currency.upper())

        results = query.order_by(PayrollRunDB.period_start.asc(), PayrollLineDB.employee_name.asc()).all()

        by_type: Dict[str, float] = {}
        total_ext = 0.0
        total_int = 0.0
        total_comm = 0.0
        total_bonus = 0.0
        grand_total = 0.0
        emp_map: Dict[int, Dict[str, Any]] = {}
        run_ids = set()

        for line, run in results:
            run_ids.add(run.id)
            ctype = line.compensation_type or "internal_usd_cash"
            amt = float(line.base_salary or 0.0) + float(line.allowances_total or 0.0)
            by_type[ctype] = round(by_type.get(ctype, 0.0) + amt, 2)
            grand_total += amt

            if ctype == "external_usd":
                total_ext += amt
            elif ctype == "internal_usd_cash":
                total_int += amt
            elif "commission" in ctype:
                total_comm += amt
            elif "bonus" in ctype:
                total_bonus += amt
            else:
                total_int += amt

            emp_id = line.employee_id
            if emp_id not in emp_map:
                emp_map[emp_id] = {
                    "employee_id": emp_id,
                    "employee_name": line.employee_name or f"Employee #{emp_id}",
                    "department": line.department or "General",
                    "by_compensation_type": {},
                    "total_external": 0.0,
                    "total_internal": 0.0,
                    "total_commission": 0.0,
                    "total_bonus": 0.0,
                    "grand_total": 0.0,
                    "lines_count": 0,
                }
            e = emp_map[emp_id]
            e["by_compensation_type"][ctype] = round(e["by_compensation_type"].get(ctype, 0.0) + amt, 2)
            e["grand_total"] = round(e["grand_total"] + amt, 2)
            e["lines_count"] += 1
            if ctype == "external_usd":
                e["total_external"] = round(e["total_external"] + amt, 2)
            elif ctype == "internal_usd_cash":
                e["total_internal"] = round(e["total_internal"] + amt, 2)
            elif "commission" in ctype:
                e["total_commission"] = round(e["total_commission"] + amt, 2)
            elif "bonus" in ctype:
                e["total_bonus"] = round(e["total_bonus"] + amt, 2)
            else:
                e["total_internal"] = round(e["total_internal"] + amt, 2)

        employees_list = sorted(list(emp_map.values()), key=lambda x: x["employee_name"]) if breakdown_employees else []

        return {
            "start_date": start_date,
            "end_date": end_date,
            "currency": currency or "USD",
            "by_compensation_type": by_type,
            "total_external": round(total_ext, 2),
            "total_internal": round(total_int, 2),
            "total_commission": round(total_comm, 2),
            "total_bonus": round(total_bonus, 2),
            "grand_total": round(grand_total, 2),
            "total_headcount": len(emp_map),
            "payroll_runs_count": len(run_ids),
            "employees": employees_list,
        }

    def get_withholding_credits_report(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        currency: str = "USD",
    ) -> Dict[str, Any]:
        """
        D-024: tax withheld by customers (recorded on invoice receipts, no bank movement), by
        customer and month of the receipt, for offsetting against income tax. Reversed receipts excluded.
        """
        q = (
            self.db.query(PaymentDB)
            .filter(
                PaymentDB.related_invoice_id.isnot(None),
                PaymentDB.direction == "incoming",
                PaymentDB.is_reversed == False,  # noqa: E712
                PaymentDB.withheld_amount > 0,
            )
        )
        if start_date:
            q = q.filter(PaymentDB.payment_date >= start_date)
        if end_date:
            q = q.filter(PaymentDB.payment_date <= end_date)
        if currency and currency.upper() != "ALL":
            q = q.filter(PaymentDB.currency == currency.upper())

        groups: Dict[Any, Dict[str, Any]] = {}
        for p in q.order_by(PaymentDB.payment_date.asc(), PaymentDB.id.asc()).all():
            inv = p.sales_invoice
            cust = inv.customer if inv else None
            month = str(p.payment_date)[:7]
            key = (cust.id if cust else None, month, p.currency)
            g = groups.setdefault(key, {
                "customer_id": cust.id if cust else None,
                "customer_name": (cust.name if cust else None) or "Unknown customer",
                "month": month,
                "currency": p.currency,
                "withheld_amount": 0.0,
                "receipts": 0,
                "invoice_numbers": [],
            })
            g["withheld_amount"] = round(g["withheld_amount"] + float(p.withheld_amount or 0.0), 2)
            g["receipts"] += 1
            if inv and inv.invoice_number not in g["invoice_numbers"]:
                g["invoice_numbers"].append(inv.invoice_number)

        items = sorted(groups.values(), key=lambda g: (g["month"], g["customer_name"]))
        return {
            "start_date": start_date,
            "end_date": end_date,
            "currency": currency or "USD",
            "total_withheld": round(sum(g["withheld_amount"] for g in items), 2),
            "items": items,
        }

    def get_statutory_remitted_report(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        currency: str = "USD",
    ) -> Dict[str, Any]:
        """
        Statutory obligations paid report: total tax and social insurance actually remitted
        (not just accrued) for a selected period.
        """
        query = self.db.query(StatutoryObligationDB)

        if currency and currency.upper() != "ALL":
            query = query.filter(StatutoryObligationDB.currency == currency.upper())

        if start_date:
            start_period = start_date[:7]
            query = query.filter(StatutoryObligationDB.period >= start_period)
        if end_date:
            end_period = end_date[:7]
            query = query.filter(StatutoryObligationDB.period <= end_period)

        obligations = query.order_by(StatutoryObligationDB.period.asc(), StatutoryObligationDB.id.asc()).all()

        by_type: Dict[str, float] = {}
        by_period: Dict[str, float] = {}
        total_remitted = 0.0
        items = []

        for obl in obligations:
            remitted = float(obl.amount_remitted or 0.0)
            if remitted > 0:
                by_type[obl.obligation_type] = round(by_type.get(obl.obligation_type, 0.0) + remitted, 2)
                by_period[obl.period] = round(by_period.get(obl.period, 0.0) + remitted, 2)
                total_remitted += remitted

                items.append({
                    "id": obl.id,
                    "period": obl.period,
                    "obligation_type": obl.obligation_type,
                    "amount_remitted": round(remitted, 2),
                    "amount_accrued": round(float(obl.amount_accrued or 0.0), 2),
                    "currency": obl.currency,
                    "status": obl.status,
                    "due_date": obl.due_date,
                    "source_type": obl.source_type,
                    "source_id": obl.source_id,
                    "notes": obl.notes,
                })

        return {
            "start_date": start_date,
            "end_date": end_date,
            "currency": currency or "USD",
            "total_remitted": round(total_remitted, 2),
            "by_obligation_type": by_type,
            "by_period": by_period,
            "items": items,
            "obligations_count": len(items),
        }

    def get_payroll_payable_status_report(
        self,
        period: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        employee_id: Optional[int] = None,
        currency: str = "USD",
    ) -> Dict[str, Any]:
        """
        Payable/paid status view: shows the status of each of the four money flows
        (external transfer, internal cash, tax obligation, insurance obligation) — pending vs. settled —
        for both a single employee and company-wide.
        """
        # 1. Resolve relevant payroll runs & lines
        line_q = (
            self.db.query(PayrollLineDB, PayrollRunDB)
            .join(PayrollRunDB, PayrollLineDB.payroll_run_id == PayrollRunDB.id)
            .filter(PayrollRunDB.status != "cancelled")
        )

        if employee_id:
            line_q = line_q.filter(PayrollLineDB.employee_id == employee_id)

        if period:
            line_q = line_q.filter(PayrollRunDB.period_label == period)
        else:
            if start_date:
                line_q = line_q.filter(PayrollRunDB.period_end >= start_date)
            if end_date:
                line_q = line_q.filter(PayrollRunDB.period_start <= end_date)

        if currency and currency.upper() != "ALL":
            line_q = line_q.filter(PayrollRunDB.currency == currency.upper())

        matched_lines = line_q.all()
        run_ids = list(set(r.id for _, r in matched_lines))
        run_periods = list(set(r.period_label for _, r in matched_lines))
        if period and period not in run_periods:
            run_periods.append(period)

        # Flow 1: External Wire Transfers
        ext_settled = 0.0
        ext_pending = 0.0
        # Flow 2: Internal Cash Payroll
        int_settled = 0.0
        int_pending = 0.0

        # Per employee tracking if needed
        emp_status_map: Dict[int, Dict[str, Any]] = {}

        for line, run in matched_lines:
            ctype = line.compensation_type or "internal_usd_cash"
            # For payable amounts, net_pay is the amount due to the employee
            line_amt = float(line.net_pay if line.net_pay is not None else line.base_salary or 0.0)
            is_paid = (line.payment_status == "paid") or (line.paid_at is not None)

            eid = line.employee_id
            if eid not in emp_status_map:
                emp_status_map[eid] = {
                    "employee_id": eid,
                    "employee_name": line.employee_name or f"Employee #{eid}",
                    "department": line.department or "General",
                    "external_pending": 0.0,
                    "external_settled": 0.0,
                    "internal_pending": 0.0,
                    "internal_settled": 0.0,
                    "tax_pending": 0.0,
                    "tax_settled": 0.0,
                    "insurance_pending": 0.0,
                    "insurance_settled": 0.0,
                    "total_pending": 0.0,
                    "total_settled": 0.0,
                }
            es = emp_status_map[eid]

            if ctype == "external_usd":
                if is_paid:
                    ext_settled += line_amt
                    es["external_settled"] += line_amt
                else:
                    ext_pending += line_amt
                    es["external_pending"] += line_amt
            else:
                if is_paid:
                    int_settled += line_amt
                    es["internal_settled"] += line_amt
                else:
                    int_pending += line_amt
                    es["internal_pending"] += line_amt

            # Accumulate employee local tax & SI contributions from lines
            emp_tax = float(line.tax_amount or 0.0)
            # Only what is owed by the employee (their deducted share). The employer's own social insurance
            # cost (employer_cost_extra) is a company obligation and never makes an employee's flow pending.
            emp_si = float(line.deductions_total or 0.0)
            # Will be distributed as settled/pending based on statutory obligation status below
            es["_raw_tax"] = es.get("_raw_tax", 0.0) + emp_tax
            es["_raw_si"] = es.get("_raw_si", 0.0) + emp_si

        # Flow 3 & 4: Statutory Obligations (Tax and Insurance)
        obl_q = self.db.query(StatutoryObligationDB)
        if run_periods:
            obl_q = obl_q.filter(StatutoryObligationDB.period.in_(run_periods))
        elif period:
            obl_q = obl_q.filter(StatutoryObligationDB.period == period)
        elif start_date or end_date:
            if start_date:
                obl_q = obl_q.filter(StatutoryObligationDB.period >= start_date[:7])
            if end_date:
                obl_q = obl_q.filter(StatutoryObligationDB.period <= end_date[:7])

        if currency and currency.upper() != "ALL":
            obl_q = obl_q.filter(StatutoryObligationDB.currency == currency.upper())

        statutory_records = obl_q.all()

        tax_types = {"income_tax", "withholding_tax", "sales_tax"}
        insurance_types = {"social_insurance_employee", "social_insurance_employer", "health_insurance"}

        tax_settled = 0.0
        tax_pending = 0.0
        ins_settled = 0.0
        ins_pending = 0.0

        tax_total_accrued = 0.0
        tax_total_remitted = 0.0
        ins_total_accrued = 0.0
        ins_total_remitted = 0.0

        for obl in statutory_records:
            accrued = float(obl.amount_accrued or obl.amount_estimated or 0.0)
            remitted = float(obl.amount_remitted or 0.0)
            pending = max(0.0, accrued - remitted)

            if obl.obligation_type in tax_types:
                tax_settled += remitted
                tax_pending += pending
                tax_total_accrued += accrued
                tax_total_remitted += remitted
            elif obl.obligation_type in insurance_types:
                ins_settled += remitted
                ins_pending += pending
                ins_total_accrued += accrued
                ins_total_remitted += remitted

        # Ratio of remittance for employee breakdown
        tax_remit_ratio = (tax_total_remitted / tax_total_accrued) if tax_total_accrued > 0 else (1.0 if tax_total_remitted > 0 else 0.0)
        ins_remit_ratio = (ins_total_remitted / ins_total_accrued) if ins_total_accrued > 0 else (1.0 if ins_total_remitted > 0 else 0.0)

        # Distribute into employee breakdown
        for eid, es in emp_status_map.items():
            raw_tax = es.pop("_raw_tax", 0.0)
            raw_si = es.pop("_raw_si", 0.0)

            es["tax_settled"] = round(raw_tax * tax_remit_ratio, 2)
            es["tax_pending"] = round(raw_tax - es["tax_settled"], 2)

            es["insurance_settled"] = round(raw_si * ins_remit_ratio, 2)
            es["insurance_pending"] = round(raw_si - es["insurance_settled"], 2)

            es["external_pending"] = round(es["external_pending"], 2)
            es["external_settled"] = round(es["external_settled"], 2)
            es["internal_pending"] = round(es["internal_pending"], 2)
            es["internal_settled"] = round(es["internal_settled"], 2)

            es["total_pending"] = round(
                es["external_pending"] + es["internal_pending"] + es["tax_pending"] + es["insurance_pending"], 2
            )
            es["total_settled"] = round(
                es["external_settled"] + es["internal_settled"] + es["tax_settled"] + es["insurance_settled"], 2
            )

        # If querying for a specific employee, the 4 flows reflect that employee
        if employee_id:
            es = emp_status_map.get(employee_id, {
                "external_pending": 0.0, "external_settled": 0.0,
                "internal_pending": 0.0, "internal_settled": 0.0,
                "tax_pending": 0.0, "tax_settled": 0.0,
                "insurance_pending": 0.0, "insurance_settled": 0.0,
            })
            flow_ext_pend, flow_ext_sett = es["external_pending"], es["external_settled"]
            flow_int_pend, flow_int_sett = es["internal_pending"], es["internal_settled"]
            flow_tax_pend, flow_tax_sett = es["tax_pending"], es["tax_settled"]
            flow_ins_pend, flow_ins_sett = es["insurance_pending"], es["insurance_settled"]
        else:
            flow_ext_pend, flow_ext_sett = ext_pending, ext_settled
            flow_int_pend, flow_int_sett = int_pending, int_settled
            flow_tax_pend, flow_tax_sett = tax_pending, tax_settled
            flow_ins_pend, flow_ins_sett = ins_pending, ins_settled

        def _flow_status(pend: float, sett: float) -> str:
            if pend <= 0.001 and sett > 0.001:
                return "settled"
            if sett <= 0.001 and pend > 0.001:
                return "pending"
            if pend > 0.001 and sett > 0.001:
                return "partially_settled"
            return "settled"

        flows = [
            {
                "flow_type": "external_transfer",
                "label": "External Wire Transfers",
                "pending_amount": round(flow_ext_pend, 2),
                "settled_amount": round(flow_ext_sett, 2),
                "total_amount": round(flow_ext_pend + flow_ext_sett, 2),
                "status": _flow_status(flow_ext_pend, flow_ext_sett),
            },
            {
                "flow_type": "internal_cash",
                "label": "Internal Cash Payroll",
                "pending_amount": round(flow_int_pend, 2),
                "settled_amount": round(flow_int_sett, 2),
                "total_amount": round(flow_int_pend + flow_int_sett, 2),
                "status": _flow_status(flow_int_pend, flow_int_sett),
            },
            {
                "flow_type": "tax_obligation",
                "label": "Income Tax Obligations",
                "pending_amount": round(flow_tax_pend, 2),
                "settled_amount": round(flow_tax_sett, 2),
                "total_amount": round(flow_tax_pend + flow_tax_sett, 2),
                "status": _flow_status(flow_tax_pend, flow_tax_sett),
            },
            {
                "flow_type": "insurance_obligation",
                "label": "Social Insurance Obligations",
                "pending_amount": round(flow_ins_pend, 2),
                "settled_amount": round(flow_ins_sett, 2),
                "total_amount": round(flow_ins_pend + flow_ins_sett, 2),
                "status": _flow_status(flow_ins_pend, flow_ins_sett),
            },
        ]

        total_pending = round(sum(f["pending_amount"] for f in flows), 2)
        total_settled = round(sum(f["settled_amount"] for f in flows), 2)
        grand_total = round(total_pending + total_settled, 2)

        emp_breakdown = list(emp_status_map.values()) if not employee_id else None

        return {
            "period": period,
            "start_date": start_date,
            "end_date": end_date,
            "employee_id": employee_id,
            "currency": currency or "USD",
            "flows": flows,
            "total_pending": total_pending,
            "total_settled": total_settled,
            "grand_total": grand_total,
            "employee_breakdown": emp_breakdown,
        }




