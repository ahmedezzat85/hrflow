"""
be/finance/services/reports_service.py
Service layer for financial reporting, aggregation, point-in-time balance calculations,
category spend rollups, and period matrices.
"""
import json
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_

from finance.models import (
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    FinanceChequeDB,
    SalesInvoiceDB,
    BillDB,
    SubscriptionDB,
    FinanceSavedReportViewDB,
    FinanceExportAuditDB,
    FinanceReportScheduleDB,
)
from finance.services.excel_exporter import (
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
)


class ReportsService:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # 0. Executive Finance Summary & Trustworthy KPIs
    # ------------------------------------------------------------------
    def get_finance_summary(
        self,
        entity: Optional[str] = "all",
        period: str = "MTD",
        basis: str = "cash",
        currency: str = "USD",
    ) -> Dict[str, Any]:
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

        # 2. Revenue & Operating Spend
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
            invoices = inv_q.all()
            revenue = round(sum(float(i.total or 0.0) for i in invoices), 2)

            bill_q = self.db.query(BillDB).filter(BillDB.status != "void")
            if start_date:
                bill_q = bill_q.filter(BillDB.issue_date >= start_date)
            if end_date:
                bill_q = bill_q.filter(BillDB.issue_date <= end_date)
            if curr_norm != "ALL":
                bill_q = bill_q.filter(BillDB.currency == curr_norm)
            bills = bill_q.all()
            operating_spend = round(sum(float(b.total or 0.0) for b in bills), 2)
        else:
            # Cash basis: ledger transactions
            tx_q = (
                self.db.query(LedgerTransactionDB)
                .join(FinanceBankAccountDB, LedgerTransactionDB.account_id == FinanceBankAccountDB.id)
                .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            )
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

            # Exclude internal transfers
            tx_q = tx_q.filter(
                LedgerTransactionDB.source != "transfer",
                or_(TransactionCategoryDB.kind == None, TransactionCategoryDB.kind != "transfer"),
            )
            all_txs = tx_q.all()

            revenue = round(
                sum(
                    float(t.amount or 0.0)
                    for t in all_txs
                    if t.direction == "in"
                    and (
                        (t.category and t.category.kind == "revenue")
                        or t.linked_invoice_id
                        or not t.category
                        or t.category.kind != "cost"
                    )
                ),
                2,
            )
            operating_spend = round(
                sum(
                    float(t.amount or 0.0)
                    for t in all_txs
                    if t.direction == "out"
                    and (
                        (t.category and t.category.kind == "cost")
                        or t.linked_bill_id
                        or t.source in ("bill_payment", "subscription_charge", "cheque")
                        or not t.category
                        or t.category.kind != "revenue"
                    )
                ),
                2,
            )

        net_result = round(revenue - operating_spend, 2)
        if revenue > 0:
            margin_pct = round((net_result / revenue) * 100, 1)
            margin_valid = True
        else:
            margin_pct = None
            margin_valid = False

        open_inv_count = self.db.query(SalesInvoiceDB).filter(SalesInvoiceDB.status.in_(["sent", "draft", "overdue", "partially_paid"])).count()
        unpaid_bills_count = self.db.query(BillDB).filter(BillDB.status.in_(["unpaid", "overdue", "partially_paid"])).count()
        active_sub_count = self.db.query(SubscriptionDB).filter(SubscriptionDB.is_active == True).count()

        now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        conversion_policy = (
            "Consolidated totals across currencies without conversion; select a specific currency for single-currency ledger reconciliation."
            if curr_norm == "ALL"
            else f"Filtered strictly to {curr_norm} accounts and transactions (1:1 single currency)."
        )

        display_currency = curr_norm if curr_norm != "ALL" else "USD"

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
                    "Actual cash inflows received and categorized as revenue"
                    if basis_norm == "cash"
                    else "Recognized revenue from all non-void sales invoices issued in period"
                ),
                "formula": (
                    "SUM(ledger_inflows WHERE source!='transfer' AND kind!='transfer')"
                    if basis_norm == "cash"
                    else "SUM(sales_invoices.total WHERE status NOT IN ('void', 'draft'))"
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
                    "Actual cash outflows paid for expenses, bills, and charges"
                    if basis_norm == "cash"
                    else "Recognized costs from all non-void vendor bills issued in period"
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
            "period": period_norm,
            "basis": basis_norm,
            "entity": entity_norm,
            "conversion_policy": conversion_policy,
            "data_scope": f"{entity_norm}_{curr_norm.lower()}",
            "open_invoices_count": open_inv_count,
            "unpaid_bills_count": unpaid_bills_count,
            "active_subscriptions_count": active_sub_count,
            "generated_at": now_iso,
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
    ) -> Dict[str, Any]:
        q = (
            self.db.query(LedgerTransactionDB)
            .join(FinanceBankAccountDB, LedgerTransactionDB.account_id == FinanceBankAccountDB.id)
            .outerjoin(TransactionCategoryDB, LedgerTransactionDB.category_id == TransactionCategoryDB.id)
            .outerjoin(PaymentTypeDB, LedgerTransactionDB.payment_type_id == PaymentTypeDB.id)
        )

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
    def get_category_by_period_matrix(
        self,
        year: int,
        period_group: str = "month",
        currency: Optional[str] = None,
        include_internal: bool = True,
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
    def get_point_in_time_balances(self, as_of_date: str) -> Dict[str, Any]:
        """
        Computes the balance of each bank/cash account as of a given date (inclusive).
        Transactions after as_of_date are excluded.
        """
        accounts = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True).all()

        accounts_list = []
        currency_totals: Dict[str, float] = {}
        country_totals: Dict[str, Dict[str, float]] = {}

        for acc in accounts:
            opening = float(acc.opening_balance or 0.0)

            # Sum inflows on or before as_of_date
            inflows = (
                self.db.query(func.sum(LedgerTransactionDB.amount))
                .filter(
                    LedgerTransactionDB.account_id == acc.id,
                    LedgerTransactionDB.date <= as_of_date,
                    LedgerTransactionDB.direction == "in",
                )
                .scalar() or 0.0
            )

            # Sum outflows on or before as_of_date
            outflows = (
                self.db.query(func.sum(LedgerTransactionDB.amount))
                .filter(
                    LedgerTransactionDB.account_id == acc.id,
                    LedgerTransactionDB.date <= as_of_date,
                    LedgerTransactionDB.direction == "out",
                )
                .scalar() or 0.0
            )

            balance = round(opening + float(inflows) - float(outflows), 2)
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
                "balance_as_of_date": balance,
            })

        accounts_list.sort(key=lambda a: (a["currency"], a["account_name"]))

        return {
            "as_of_date": as_of_date,
            "accounts": accounts_list,
            "currency_totals": currency_totals,
            "country_totals": country_totals,
        }

    # ------------------------------------------------------------------
    # 5. Cheque Register Report
    # ------------------------------------------------------------------
    def get_cheques_report(
        self,
        fiscal_year: int,
        account_id: Optional[int] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Retrieves fiscal year cheque register with status breakdown and totals.
        """
        q = (
            self.db.query(FinanceChequeDB)
            .join(FinanceBankAccountDB, FinanceChequeDB.account_id == FinanceBankAccountDB.id)
            .filter(FinanceChequeDB.fiscal_year == fiscal_year)
        )

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
    ) -> Dict[str, Any]:
        """
        Fetches the granular contributing ledger transactions or documents
        for a clicked total, cell, or category in any report without losing context.
        """
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
    ) -> Dict[str, Any]:
        today = datetime.utcnow().date()
        d_to = date_to or today.strftime("%Y-%m-%d")
        d_from = date_from or today.replace(day=1).strftime("%Y-%m-%d")
        curr_norm = (currency or "USD").upper()
        basis_norm = (basis or "cash").lower()
        entity_norm = (entity or "all").strip().lower()

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
                invoices = inv_q.all()
                cust_rev = {}
                for inv in invoices:
                    cname = (inv.customer.name if inv.customer else None) or f"Customer #{inv.customer_id}"
                    amt = float(inv.total or 0.0)
                    cust_rev[cname] = cust_rev.get(cname, 0.0) + amt
                    total_rev += amt

                for cname, amt in sorted(cust_rev.items(), key=lambda x: x[1], reverse=True):
                    rev_items.append({
                        "category_name": f"Sales: {cname}",
                        "amount": round(amt, 2),
                        "percentage": round((amt / total_rev * 100) if total_rev > 0 else 0.0, 1),
                    })

                bill_q = self.db.query(BillDB).filter(
                    BillDB.status != "void",
                    BillDB.issue_date >= start_d,
                    BillDB.issue_date <= end_d,
                )
                if curr_norm != "ALL":
                    bill_q = bill_q.filter(BillDB.currency == curr_norm)
                bills = bill_q.all()
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
                if curr_norm != "ALL":
                    tx_q = tx_q.filter(LedgerTransactionDB.currency == curr_norm)
                txs = tx_q.all()

                cat_rev = {}
                cat_exp = {}
                for t, cname, ckind in txs:
                    cat_display = cname or ("Sales Revenue" if t.direction == "in" else "Uncategorized Expense")
                    amt = float(t.amount or 0.0)
                    if t.direction == "in":
                        cat_rev[cat_display] = cat_rev.get(cat_display, 0.0) + amt
                        total_rev += amt
                    else:
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
        }

    def get_balance_sheet(
        self,
        entity: Optional[str] = "all",
        as_of_date: Optional[str] = None,
        basis: str = "accrual",
        currency: str = "USD",
        comparison: str = "none",
    ) -> Dict[str, Any]:
        today = datetime.utcnow().date()
        cutoff = as_of_date or today.strftime("%Y-%m-%d")
        curr_norm = (currency or "USD").upper()

        # 1. Cash & Bank Accounts (Point in time)
        pit = self.get_point_in_time_balances(cutoff)
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
            paid_sum = sum(float(p.amount or 0.0) for p in getattr(inv, "payments", []) if getattr(p, "status", "") != "reversed")
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
            BillDB.status.notin_(["void", "paid"]),
            BillDB.issue_date <= cutoff,
        ]
        ap_q = self.db.query(BillDB).filter(*bill_filter)
        if curr_norm != "ALL":
            ap_q = ap_q.filter(BillDB.currency == curr_norm)
        total_ap = 0.0
        for b in ap_q.all():
            rem = max(0.0, float(b.total or 0.0) - float(getattr(b, "amount_paid", 0.0) or 0.0))
            if rem > 0:
                total_ap += rem

        # 4. Cheques Payable (Issued/Pending as of cutoff)
        chq_q = self.db.query(FinanceChequeDB).filter(
            FinanceChequeDB.status == "issued",
            FinanceChequeDB.issue_date <= cutoff,
        )
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
    ) -> Dict[str, Any]:
        today = datetime.utcnow().date()
        cutoff = as_of_date or today.strftime("%Y-%m-%d")
        curr_norm = (currency or "USD").upper()

        lines = []
        total_debits = 0.0
        total_credits = 0.0

        # Asset accounts (Bank / Cash)
        pit = self.get_point_in_time_balances(cutoff)
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
            paid_sum = sum(float(p.amount or 0.0) for p in getattr(inv, "payments", []) if getattr(p, "status", "") != "reversed")
            rem = max(0.0, float(inv.total or 0.0) - paid_sum)
            total_ar += rem
        if total_ar > 0:
            lines.append({"code": "1100-AR", "name": "Accounts Receivable (Trade)", "type": "asset", "debit": round(total_ar, 2), "credit": 0.0})
            total_debits += total_ar

        # Accounts Payable (Liability - Credit)
        ap_q = self.db.query(BillDB).filter(
            BillDB.status.notin_(["void", "paid"]),
            BillDB.issue_date <= cutoff,
        )
        if curr_norm != "ALL":
            ap_q = ap_q.filter(BillDB.currency == curr_norm)
        total_ap = sum(max(0.0, float(b.total or 0.0) - float(getattr(b, "amount_paid", 0.0) or 0.0)) for b in ap_q.all())
        if total_ap > 0:
            lines.append({"code": "2000-AP", "name": "Accounts Payable (Trade)", "type": "liability", "debit": 0.0, "credit": round(total_ap, 2)})
            total_credits += total_ap

        # Cheques Payable (Liability - Credit)
        chq_q = self.db.query(FinanceChequeDB).filter(
            FinanceChequeDB.status == "issued",
            FinanceChequeDB.issue_date <= cutoff,
        )
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
    ) -> Dict[str, Any]:
        today = datetime.utcnow().date()
        d_to = date_to or today.strftime("%Y-%m-%d")
        d_from = date_from or today.replace(day=1).strftime("%Y-%m-%d")
        curr_norm = (currency or "USD").upper()

        # Opening balance
        pit_start = self.get_point_in_time_balances(d_from)
        beg_cash = 0.0
        for acc in pit_start.get("accounts", []):
            if curr_norm == "ALL" or acc.get("currency") == curr_norm:
                beg_cash += float(acc.get("balance_as_of_date") or 0.0)

        # Closing balance
        pit_end = self.get_point_in_time_balances(d_to)
        end_cash = 0.0
        for acc in pit_end.get("accounts", []):
            if curr_norm == "ALL" or acc.get("currency") == curr_norm:
                end_cash += float(acc.get("balance_as_of_date") or 0.0)

        # Inflows & Outflows during period
        tx_q = self.db.query(LedgerTransactionDB).filter(
            LedgerTransactionDB.date >= d_from,
            LedgerTransactionDB.date <= d_to,
        )
        if curr_norm != "ALL":
            tx_q = tx_q.filter(LedgerTransactionDB.currency == curr_norm)
        txs = tx_q.all()

        op_in = 0.0
        op_out = 0.0
        for t in txs:
            amt = float(t.amount or 0.0)
            if t.direction == "in":
                op_in += amt
            else:
                op_out += amt

        operating_items = [
            {"name": "Cash Receipts from Customers & Operational Inflows", "amount": round(op_in, 2), "activity_type": "operating"},
            {"name": "Cash Payments for Suppliers & Operational Outflows", "amount": -round(op_out, 2), "activity_type": "operating"},
        ]
        net_op = round(op_in - op_out, 2)
        net_inv = 0.0
        net_fin = 0.0
        net_change = round(net_op + net_inv + net_fin, 2)

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
            "financing_activities": [],
            "net_cash_financing": net_fin,
            "net_change_in_cash": net_change,
            "beginning_cash_balance": round(beg_cash, 2),
            "ending_cash_balance": round(end_cash, 2),
            "is_reconciled": True,
        }

    def get_ar_aging_report(
        self,
        entity: Optional[str] = "all",
        as_of_date: Optional[str] = None,
        currency: str = "USD",
    ) -> Dict[str, Any]:
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

        invoices = q.all()
        by_customer = {}

        totals = {"current": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_over_90": 0.0, "total": 0.0}
        total_open = 0

        for inv in invoices:
            paid_sum = sum(float(p.amount or 0.0) for p in getattr(inv, "payments", []) if getattr(p, "status", "") != "reversed")
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
    ) -> Dict[str, Any]:
        today = datetime.utcnow().date()
        cutoff_str = as_of_date or today.strftime("%Y-%m-%d")
        cutoff_dt = datetime.strptime(cutoff_str, "%Y-%m-%d").date()
        curr_norm = (currency or "USD").upper()

        q = self.db.query(BillDB).filter(
            BillDB.status.notin_(["void", "paid"]),
            BillDB.issue_date <= cutoff_str,
        )
        if curr_norm != "ALL":
            q = q.filter(BillDB.currency == curr_norm)

        bills = q.all()
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
            "period": f"{filters.get('date_from', 'Beginning')} to {filters.get('date_to', 'Current')}" if filters.get("date_from") or filters.get("date_to") else "As Of Cutoff",
            "generated_at": now_str,
            "requesting_user": user_email or "System User",
        }

        # Calculate underlying report data
        row_count = 0
        data: Dict[str, Any] = {}

        if report_key == "profit-and-loss":
            data = self.get_profit_and_loss(
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
                entity=filters.get("entity", "all"),
                as_of_date=filters.get("as_of_date") or filters.get("date_to"),
                currency=filters.get("currency", "USD"),
            )
            row_count = len(data.get("lines", []))
        elif report_key == "cash-flow":
            data = self.get_cash_flow_statement(
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
                entity=filters.get("entity", "all"),
                as_of_date=filters.get("as_of_date") or filters.get("date_to"),
                currency=filters.get("currency", "USD"),
            )
            row_count = len(data.get("rows", []))
        elif report_key == "ap-aging":
            data = self.get_ap_aging_report(
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
                as_of_date=filters.get("as_of_date") or filters.get("date_to")
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
            elif report_key == "transactions":
                file_bytes = export_transactions_xlsx(data)
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




