"""
be/finance/services/reports_service.py
Service layer for financial reporting, aggregation, point-in-time balance calculations,
category spend rollups, and period matrices.
"""
from typing import Dict, Any, List, Optional
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
        if search:
            like_term = f"%{search.strip()}%"
            q = q.filter(
                or_(
                    LedgerTransactionDB.reference.ilike(like_term),
                    LedgerTransactionDB.description.ilike(like_term),
                    LedgerTransactionDB.cheque_number.ilike(like_term),
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
