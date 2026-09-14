"""
be/finance/services/excel_exporter.py
Generates professionally styled Excel (.xlsx) workbooks for Finance reports using openpyxl.
Includes frozen headers, dark navy branding, currency/date formats, and auto column widths.
"""
import io
import csv
from typing import Dict, Any, List, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


# Consistent Design Tokens for Voyance / HRFlow Finance Reports
HEADER_FILL = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
HEADER_FONT = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
HEADER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)

TITLE_FONT = Font(name="Segoe UI", size=14, bold=True, color="0F172A")
SUBTITLE_FONT = Font(name="Segoe UI", size=10, italic=True, color="475569")

TOTAL_FILL = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
TOTAL_FONT = Font(name="Segoe UI", size=10, bold=True, color="0F172A")

ZEBRA_FILL = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

CELL_FONT = Font(name="Segoe UI", size=10, color="1E293B")

THIN_BORDER = Border(
    left=Side(style="thin", color="E2E8F0"),
    right=Side(style="thin", color="E2E8F0"),
    top=Side(style="thin", color="E2E8F0"),
    bottom=Side(style="thin", color="E2E8F0"),
)

TOTAL_BORDER = Border(
    left=Side(style="thin", color="E2E8F0"),
    right=Side(style="thin", color="E2E8F0"),
    top=Side(style="thin", color="334155"),
    bottom=Side(style="double", color="334155"),
)

NUM_FORMAT_CURRENCY = "#,##0.00"
NUM_FORMAT_PERCENT = "0.0%"


def sanitize_cell_value(val: Any) -> Any:
    """Formula injection defense: neutralizes spreadsheet formula execution triggers."""
    if isinstance(val, str) and val:
        if val[0] in ("=", "+", "-", "@", "\t", "\r"):
            return f"'{val}"
    return val


def mask_account_number(acc_num: Optional[str]) -> str:
    """Masks bank account number for unprivileged export roles."""
    if not acc_num:
        return "—"
    clean = str(acc_num).strip()
    if len(clean) <= 4:
        return "••••"
    return f"••••{clean[-4:]}"


def write_standard_metadata_header(
    ws,
    title: str,
    metadata: Dict[str, Any],
    row_start: int = 1,
) -> int:
    """Writes standardized header block with metadata into worksheet and returns the next content row."""
    ws.cell(row=row_start, column=1, value=sanitize_cell_value(title)).font = TITLE_FONT
    meta_parts = []
    if metadata.get("entity"):
        meta_parts.append(f"Entity: {metadata['entity']}")
    if metadata.get("basis"):
        meta_parts.append(f"Basis: {str(metadata['basis']).upper()}")
    if metadata.get("currency"):
        meta_parts.append(f"Currency: {metadata['currency']}")
    if metadata.get("period"):
        meta_parts.append(f"Period: {metadata['period']}")
    if metadata.get("generated_at"):
        meta_parts.append(f"Generated: {metadata['generated_at']}")
    if metadata.get("requesting_user"):
        meta_parts.append(f"User: {metadata['requesting_user']}")

    sub = " | ".join(meta_parts)
    ws.cell(row=row_start + 1, column=1, value=sanitize_cell_value(sub)).font = SUBTITLE_FONT
    return row_start + 3


def _auto_fit_columns(ws, min_width: int = 12, max_width: int = 40):
    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        max_len = 0
        for cell in col:
            val = str(cell.value or "")
            if "\n" in val:
                val = max(val.split("\n"), key=len)
            max_len = max(max_len, len(val))
        ws.column_dimensions[col_letter].width = min(max(max_len + 3, min_width), max_width)


def _save_workbook_to_bytes(wb: openpyxl.Workbook) -> bytes:
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output.getvalue()


# ----------------------------------------------------------------------
# 1. Transactions Ledger Report
# ----------------------------------------------------------------------
def export_transactions_xlsx(report: Dict[str, Any]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Transactions Ledger"
    ws.views.sheetView[0].showGridLines = True

    # Title & Metadata
    ws.cell(row=1, column=1, value="HRFlow — Transaction Ledger Report").font = TITLE_FONT
    sub = f"Date Range: {report.get('date_from', 'All')} to {report.get('date_to', 'All')} | Count: {report.get('count', 0)}"
    ws.cell(row=2, column=1, value=sub).font = SUBTITLE_FONT

    # Summary KPI row
    ws.cell(row=4, column=1, value="Total Inflows:").font = TOTAL_FONT
    c_in = ws.cell(row=4, column=2, value=report.get("total_inflows", 0.0))
    c_in.font = TOTAL_FONT
    c_in.number_format = NUM_FORMAT_CURRENCY

    ws.cell(row=4, column=4, value="Total Outflows:").font = TOTAL_FONT
    c_out = ws.cell(row=4, column=5, value=report.get("total_outflows", 0.0))
    c_out.font = TOTAL_FONT
    c_out.number_format = NUM_FORMAT_CURRENCY

    ws.cell(row=4, column=7, value="Net Change:").font = TOTAL_FONT
    c_net = ws.cell(row=4, column=8, value=report.get("net_change", 0.0))
    c_net.font = TOTAL_FONT
    c_net.number_format = NUM_FORMAT_CURRENCY

    headers = [
        "Date", "Account", "Direction", "Category", "Payment Type",
        "Amount", "Currency", "Reference", "Description", "Cheque #", "Running Balance"
    ]
    start_row = 6
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=start_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    ws.row_dimensions[start_row].height = 26
    ws.freeze_panes = f"A{start_row + 1}"

    current_row = start_row + 1
    for i, tx in enumerate(report.get("transactions", [])):
        row_cells = [
            ws.cell(row=current_row, column=1, value=tx.get("date")),
            ws.cell(row=current_row, column=2, value=tx.get("account_name")),
            ws.cell(row=current_row, column=3, value=tx.get("direction", "").upper()),
            ws.cell(row=current_row, column=4, value=tx.get("category_name")),
            ws.cell(row=current_row, column=5, value=tx.get("payment_type_name")),
            ws.cell(row=current_row, column=6, value=float(tx.get("amount", 0.0))),
            ws.cell(row=current_row, column=7, value=tx.get("currency")),
            ws.cell(row=current_row, column=8, value=tx.get("reference")),
            ws.cell(row=current_row, column=9, value=tx.get("description")),
            ws.cell(row=current_row, column=10, value=tx.get("cheque_number")),
            ws.cell(row=current_row, column=11, value=float(tx.get("running_balance", 0.0))),
        ]
        fill = ZEBRA_FILL if i % 2 == 1 else None
        for col_idx, c in enumerate(row_cells, start=1):
            c.font = CELL_FONT
            c.border = THIN_BORDER
            if fill:
                c.fill = fill
            if col_idx in (1, 3, 7, 10):
                c.alignment = Alignment(horizontal="center")
            elif col_idx in (6, 11):
                c.alignment = Alignment(horizontal="right")
                c.number_format = NUM_FORMAT_CURRENCY
        current_row += 1

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 2. Category Spend Rollup (SPENT Block)
# ----------------------------------------------------------------------
def export_category_summary_xlsx(report: Dict[str, Any]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Category Spend Rollup"
    ws.views.sheetView[0].showGridLines = True

    ws.cell(row=1, column=1, value="HRFlow — Category Spend Rollup (SPENT Block)").font = TITLE_FONT
    sub = f"Period: {report.get('date_from', 'Start')} to {report.get('date_to', 'Current')} | Currency Filter: {report.get('currency', 'All')}"
    ws.cell(row=2, column=1, value=sub).font = SUBTITLE_FONT

    headers = ["Category", "Type", "Transactions", "Total Spent", "% of Total Spend"]
    start_row = 4
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=start_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    ws.row_dimensions[start_row].height = 24
    ws.freeze_panes = f"A{start_row + 1}"

    current_row = start_row + 1
    categories = report.get("categories", [])
    for i, cat in enumerate(categories):
        c_name = ws.cell(row=current_row, column=1, value=cat.get("category_name"))
        c_kind = ws.cell(row=current_row, column=2, value=cat.get("kind", "").capitalize())
        c_cnt = ws.cell(row=current_row, column=3, value=cat.get("transaction_count", 0))
        c_amt = ws.cell(row=current_row, column=4, value=float(cat.get("total_amount", 0.0)))
        c_pct = ws.cell(row=current_row, column=5, value=float(cat.get("percentage", 0.0)) / 100.0)

        fill = ZEBRA_FILL if i % 2 == 1 else None
        for col_idx, c in enumerate([c_name, c_kind, c_cnt, c_amt, c_pct], start=1):
            c.font = CELL_FONT
            c.border = THIN_BORDER
            if fill:
                c.fill = fill
            if col_idx in (2, 3):
                c.alignment = Alignment(horizontal="center")
            elif col_idx == 4:
                c.alignment = Alignment(horizontal="right")
                c.number_format = NUM_FORMAT_CURRENCY
            elif col_idx == 5:
                c.alignment = Alignment(horizontal="right")
                c.number_format = NUM_FORMAT_PERCENT
        current_row += 1

    # Totals Row
    ws.cell(row=current_row, column=1, value="Total Spend").font = TOTAL_FONT
    ws.cell(row=current_row, column=2, value="")
    ws.cell(row=current_row, column=3, value=sum(c.get("transaction_count", 0) for c in categories))
    c_tot_amt = ws.cell(row=current_row, column=4, value=float(report.get("total_spent", 0.0)))
    c_tot_pct = ws.cell(row=current_row, column=5, value=1.0 if categories else 0.0)

    for col_idx in range(1, 6):
        c = ws.cell(row=current_row, column=col_idx)
        c.fill = TOTAL_FILL
        c.font = TOTAL_FONT
        c.border = TOTAL_BORDER
        if col_idx == 3:
            c.alignment = Alignment(horizontal="center")
        elif col_idx == 4:
            c.alignment = Alignment(horizontal="right")
            c.number_format = NUM_FORMAT_CURRENCY
        elif col_idx == 5:
            c.alignment = Alignment(horizontal="right")
            c.number_format = NUM_FORMAT_PERCENT

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 3. Category × Period Matrix
# ----------------------------------------------------------------------
def export_category_matrix_xlsx(report: Dict[str, Any]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Spend Matrix"
    ws.views.sheetView[0].showGridLines = True

    year = report.get("year", 2026)
    period_group = report.get("period_group", "month")
    ws.cell(row=1, column=1, value=f"HRFlow — Annual Category Spend Matrix ({year})").font = TITLE_FONT
    ws.cell(row=2, column=1, value=f"Grouped by: {period_group.capitalize()} | Total Spend: {report.get('year_total', 0.0):,.2f}").font = SUBTITLE_FONT

    period_labels = report.get("period_labels", [])
    headers = ["Category"] + period_labels + ["Total", "% of Total"]

    start_row = 4
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=start_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    ws.row_dimensions[start_row].height = 24
    ws.freeze_panes = f"B{start_row + 1}"

    current_row = start_row + 1
    rows = report.get("rows", [])
    for i, r in enumerate(rows):
        ws.cell(row=current_row, column=1, value=r.get("category_name")).font = CELL_FONT
        ws.cell(row=current_row, column=1).border = THIN_BORDER
        fill = ZEBRA_FILL if i % 2 == 1 else None
        if fill:
            ws.cell(row=current_row, column=1).fill = fill

        periods = r.get("periods", {})
        col_cursor = 2
        for lbl in period_labels:
            val = float(periods.get(lbl, 0.0))
            c = ws.cell(row=current_row, column=col_cursor, value=val)
            c.font = CELL_FONT
            c.border = THIN_BORDER
            c.alignment = Alignment(horizontal="right")
            c.number_format = NUM_FORMAT_CURRENCY
            if fill:
                c.fill = fill
            col_cursor += 1

        c_tot = ws.cell(row=current_row, column=col_cursor, value=float(r.get("total", 0.0)))
        c_tot.font = TOTAL_FONT
        c_tot.border = THIN_BORDER
        c_tot.alignment = Alignment(horizontal="right")
        c_tot.number_format = NUM_FORMAT_CURRENCY
        if fill:
            c_tot.fill = fill

        c_pct = ws.cell(row=current_row, column=col_cursor + 1, value=float(r.get("percentage", 0.0)) / 100.0)
        c_pct.font = CELL_FONT
        c_pct.border = THIN_BORDER
        c_pct.alignment = Alignment(horizontal="right")
        c_pct.number_format = NUM_FORMAT_PERCENT
        if fill:
            c_pct.fill = fill

        current_row += 1

    # Total Row across all categories
    ws.cell(row=current_row, column=1, value="Total Spend").font = TOTAL_FONT
    period_totals = report.get("period_totals", {})
    col_cursor = 2
    for lbl in period_labels:
        val = float(period_totals.get(lbl, 0.0))
        c = ws.cell(row=current_row, column=col_cursor, value=val)
        c.font = TOTAL_FONT
        c.border = TOTAL_BORDER
        c.fill = TOTAL_FILL
        c.alignment = Alignment(horizontal="right")
        c.number_format = NUM_FORMAT_CURRENCY
        col_cursor += 1

    c_yr_tot = ws.cell(row=current_row, column=col_cursor, value=float(report.get("year_total", 0.0)))
    c_yr_tot.font = TOTAL_FONT
    c_yr_tot.border = TOTAL_BORDER
    c_yr_tot.fill = TOTAL_FILL
    c_yr_tot.alignment = Alignment(horizontal="right")
    c_yr_tot.number_format = NUM_FORMAT_CURRENCY

    c_yr_pct = ws.cell(row=current_row, column=col_cursor + 1, value=1.0 if rows else 0.0)
    c_yr_pct.font = TOTAL_FONT
    c_yr_pct.border = TOTAL_BORDER
    c_yr_pct.fill = TOTAL_FILL
    c_yr_pct.alignment = Alignment(horizontal="right")
    c_yr_pct.number_format = NUM_FORMAT_PERCENT

    ws.cell(row=current_row, column=1).fill = TOTAL_FILL
    ws.cell(row=current_row, column=1).border = TOTAL_BORDER

    _auto_fit_columns(ws, min_width=10)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 4. Point-in-Time Balances Report
# ----------------------------------------------------------------------
def export_balances_xlsx(report: Dict[str, Any]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Account Balances"
    ws.views.sheetView[0].showGridLines = True

    as_of = report.get("as_of_date", "Today")
    ws.cell(row=1, column=1, value=f"HRFlow — Point-in-Time Balances Report").font = TITLE_FONT
    ws.cell(row=2, column=1, value=f"As of Date: {as_of} (excluding subsequent transactions)").font = SUBTITLE_FONT

    headers = ["Account Name", "Bank Name", "Account Number", "Type", "Country", "Currency", "Balance as of Date"]
    start_row = 4
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=start_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    ws.row_dimensions[start_row].height = 24
    ws.freeze_panes = f"A{start_row + 1}"

    current_row = start_row + 1
    accounts = report.get("accounts", [])
    for i, acc in enumerate(accounts):
        row_cells = [
            ws.cell(row=current_row, column=1, value=acc.get("account_name")),
            ws.cell(row=current_row, column=2, value=acc.get("bank_name") or "—"),
            ws.cell(row=current_row, column=3, value=acc.get("account_number")),
            ws.cell(row=current_row, column=4, value=acc.get("account_type", "").upper()),
            ws.cell(row=current_row, column=5, value=acc.get("country") or "—"),
            ws.cell(row=current_row, column=6, value=acc.get("currency")),
            ws.cell(row=current_row, column=7, value=float(acc.get("balance_as_of_date", 0.0))),
        ]
        fill = ZEBRA_FILL if i % 2 == 1 else None
        for col_idx, c in enumerate(row_cells, start=1):
            c.font = CELL_FONT
            c.border = THIN_BORDER
            if fill:
                c.fill = fill
            if col_idx in (4, 6):
                c.alignment = Alignment(horizontal="center")
            elif col_idx == 7:
                c.alignment = Alignment(horizontal="right")
                c.number_format = NUM_FORMAT_CURRENCY
        current_row += 1

    # Currency summary block below
    current_row += 2
    ws.cell(row=current_row, column=1, value="Currency Rollup Summary").font = TOTAL_FONT
    current_row += 1
    ws.cell(row=current_row, column=1, value="Currency").font = HEADER_FONT
    ws.cell(row=current_row, column=1).fill = HEADER_FILL
    ws.cell(row=current_row, column=2, value="Total Balance").font = HEADER_FONT
    ws.cell(row=current_row, column=2).fill = HEADER_FILL

    current_row += 1
    for curr, tot in report.get("currency_totals", {}).items():
        c1 = ws.cell(row=current_row, column=1, value=curr)
        c2 = ws.cell(row=current_row, column=2, value=float(tot))
        c1.font = CELL_FONT
        c1.border = THIN_BORDER
        c2.font = TOTAL_FONT
        c2.border = THIN_BORDER
        c2.alignment = Alignment(horizontal="right")
        c2.number_format = NUM_FORMAT_CURRENCY
        current_row += 1

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 5. Cheque Register Report
# ----------------------------------------------------------------------
def export_cheques_xlsx(report: Dict[str, Any]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Cheque Register"
    ws.views.sheetView[0].showGridLines = True

    fy = report.get("fiscal_year", "All")
    ws.cell(row=1, column=1, value=f"HRFlow — Cheque Register Report (FY {fy})").font = TITLE_FONT

    # Summary KPI row
    summary = report.get("summary", {})
    sub = f"Total Cheques: {summary.get('total_count', 0)} | Total Amount: {summary.get('total_amount', 0.0):,.2f}"
    ws.cell(row=2, column=1, value=sub).font = SUBTITLE_FONT

    headers = [
        "Cheque #", "Issue Date", "Clear Date", "Bank Account", "Currency",
        "Amount", "Payee", "Purpose", "Status", "Notes"
    ]
    start_row = 4
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=start_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    ws.row_dimensions[start_row].height = 24
    ws.freeze_panes = f"A{start_row + 1}"

    current_row = start_row + 1
    cheques = report.get("cheques", [])
    for i, chk in enumerate(cheques):
        row_cells = [
            ws.cell(row=current_row, column=1, value=chk.get("cheque_number")),
            ws.cell(row=current_row, column=2, value=chk.get("issue_date")),
            ws.cell(row=current_row, column=3, value=chk.get("clear_date") or "—"),
            ws.cell(row=current_row, column=4, value=chk.get("account_name")),
            ws.cell(row=current_row, column=5, value=chk.get("currency")),
            ws.cell(row=current_row, column=6, value=float(chk.get("amount", 0.0))),
            ws.cell(row=current_row, column=7, value=chk.get("payee")),
            ws.cell(row=current_row, column=8, value=chk.get("purpose_type", "").replace("_", " ").title()),
            ws.cell(row=current_row, column=9, value=chk.get("status", "").upper()),
            ws.cell(row=current_row, column=10, value=chk.get("notes") or ""),
        ]
        fill = ZEBRA_FILL if i % 2 == 1 else None
        for col_idx, c in enumerate(row_cells, start=1):
            c.font = CELL_FONT
            c.border = THIN_BORDER
            if fill:
                c.fill = fill
            if col_idx in (1, 2, 3, 5, 9):
                c.alignment = Alignment(horizontal="center")
            elif col_idx == 6:
                c.alignment = Alignment(horizontal="right")
                c.number_format = NUM_FORMAT_CURRENCY
        current_row += 1

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 6. Profit & Loss Statement
# ----------------------------------------------------------------------
def export_profit_and_loss_xlsx(report: Dict[str, Any], metadata: Dict[str, Any], can_view_sensitive: bool = True) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Profit & Loss"
    ws.views.sheetView[0].showGridLines = True

    start_row = write_standard_metadata_header(ws, report.get("report_title", "Profit & Loss Statement"), metadata)

    # KPI Banner Row
    curr = metadata.get("currency", report.get("currency", "USD"))
    ws.cell(row=start_row, column=1, value="Total Revenue:").font = TOTAL_FONT
    c_rev = ws.cell(row=start_row, column=2, value=float(report.get("total_revenue", 0.0)))
    c_rev.font = TOTAL_FONT
    c_rev.number_format = NUM_FORMAT_CURRENCY

    ws.cell(row=start_row, column=4, value="Total Expenses:").font = TOTAL_FONT
    c_exp = ws.cell(row=start_row, column=5, value=float(report.get("total_expenses", 0.0)))
    c_exp.font = TOTAL_FONT
    c_exp.number_format = NUM_FORMAT_CURRENCY

    ws.cell(row=start_row, column=7, value="Net Income:").font = TOTAL_FONT
    c_net = ws.cell(row=start_row, column=8, value=float(report.get("net_income", 0.0)))
    c_net.font = TOTAL_FONT
    c_net.number_format = NUM_FORMAT_CURRENCY

    ws.cell(row=start_row, column=10, value="Margin:").font = TOTAL_FONT
    c_mar = ws.cell(row=start_row, column=11, value=float(report.get("net_margin_pct", 0.0)) / 100.0)
    c_mar.font = TOTAL_FONT
    c_mar.number_format = NUM_FORMAT_PERCENT

    cur_row = start_row + 2

    # Revenue Section
    ws.cell(row=cur_row, column=1, value="1. Operating Revenue & Inflows").font = Font(name="Segoe UI", size=11, bold=True, color="10B981")
    cur_row += 1
    for col_idx, h in enumerate(["Revenue Category", "Amount", "% of Revenue"], start=1):
        cell = ws.cell(row=cur_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    cur_row += 1

    for it in report.get("revenue_items", []):
        ws.cell(row=cur_row, column=1, value=sanitize_cell_value(it.get("category_name"))).font = CELL_FONT
        c = ws.cell(row=cur_row, column=2, value=float(it.get("amount", 0.0)))
        c.font = CELL_FONT
        c.number_format = NUM_FORMAT_CURRENCY
        p = ws.cell(row=cur_row, column=3, value=float(it.get("percentage", 0.0)) / 100.0)
        p.font = CELL_FONT
        p.number_format = NUM_FORMAT_PERCENT
        cur_row += 1

    # Expense Section
    cur_row += 1
    ws.cell(row=cur_row, column=1, value="2. Operating Expenses & Allocations").font = Font(name="Segoe UI", size=11, bold=True, color="EF4444")
    cur_row += 1
    for col_idx, h in enumerate(["Expense Category", "Amount", "% of Expenses"], start=1):
        cell = ws.cell(row=cur_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    cur_row += 1

    for it in report.get("expense_items", []):
        ws.cell(row=cur_row, column=1, value=sanitize_cell_value(it.get("category_name"))).font = CELL_FONT
        c = ws.cell(row=cur_row, column=2, value=float(it.get("amount", 0.0)))
        c.font = CELL_FONT
        c.number_format = NUM_FORMAT_CURRENCY
        p = ws.cell(row=cur_row, column=3, value=float(it.get("percentage", 0.0)) / 100.0)
        p.font = CELL_FONT
        p.number_format = NUM_FORMAT_PERCENT
        cur_row += 1

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 7. Balance Sheet
# ----------------------------------------------------------------------
def export_balance_sheet_xlsx(report: Dict[str, Any], metadata: Dict[str, Any], can_view_sensitive: bool = True) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Balance Sheet"
    ws.views.sheetView[0].showGridLines = True

    start_row = write_standard_metadata_header(ws, report.get("report_title", "Balance Sheet"), metadata)

    # Balance check row
    status_str = "BALANCED ✓" if report.get("is_balanced") else f"VARIANCE: {report.get('variance', 0.0):,.2f}"
    ws.cell(row=start_row, column=1, value=f"Accounting Equation Status: {status_str}").font = TOTAL_FONT

    cur_row = start_row + 2
    for section_key, section_title in [("assets", "1. Assets"), ("liabilities", "2. Liabilities"), ("equity", "3. Equity")]:
        sec = report.get(section_key, {})
        ws.cell(row=cur_row, column=1, value=section_title).font = TITLE_FONT
        cur_row += 1
        for col_idx, h in enumerate(["Account / Item", "Note", "Balance"], start=1):
            cell = ws.cell(row=cur_row, column=col_idx, value=h)
            cell.fill = HEADER_FILL
            cell.font = HEADER_FONT
            cell.border = THIN_BORDER
        cur_row += 1

        for it in sec.get("items", []):
            acc_name = it.get("name", "")
            if not can_view_sensitive and "#" in acc_name:
                acc_name = mask_account_number(acc_name)
            ws.cell(row=cur_row, column=1, value=sanitize_cell_value(acc_name)).font = CELL_FONT
            ws.cell(row=cur_row, column=2, value=sanitize_cell_value(it.get("note", ""))).font = CELL_FONT
            c = ws.cell(row=cur_row, column=3, value=float(it.get("amount", 0.0)))
            c.font = CELL_FONT
            c.number_format = NUM_FORMAT_CURRENCY
            cur_row += 1

        # Section total
        ws.cell(row=cur_row, column=1, value=f"Total {sec.get('title', section_key.title())}").font = TOTAL_FONT
        c_tot = ws.cell(row=cur_row, column=3, value=float(sec.get("total", 0.0)))
        c_tot.font = TOTAL_FONT
        c_tot.number_format = NUM_FORMAT_CURRENCY
        c_tot.border = TOTAL_BORDER
        cur_row += 2

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 8. Trial Balance
# ----------------------------------------------------------------------
def export_trial_balance_xlsx(report: Dict[str, Any], metadata: Dict[str, Any], can_view_sensitive: bool = True) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Trial Balance"
    ws.views.sheetView[0].showGridLines = True

    start_row = write_standard_metadata_header(ws, report.get("report_title", "Trial Balance"), metadata)

    cur_row = start_row
    headers = ["Account Code", "Account Name", "Account Type", "Debit", "Credit"]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=cur_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    cur_row += 1

    for line in report.get("lines", []):
        acc_name = line.get("name", "")
        if not can_view_sensitive and "#" in acc_name:
            acc_name = mask_account_number(acc_name)
        ws.cell(row=cur_row, column=1, value=sanitize_cell_value(line.get("code"))).font = CELL_FONT
        ws.cell(row=cur_row, column=2, value=sanitize_cell_value(acc_name)).font = CELL_FONT
        ws.cell(row=cur_row, column=3, value=sanitize_cell_value(line.get("type"))).font = CELL_FONT
        d_cell = ws.cell(row=cur_row, column=4, value=float(line.get("debit", 0.0)))
        d_cell.font = CELL_FONT
        d_cell.number_format = NUM_FORMAT_CURRENCY
        c_cell = ws.cell(row=cur_row, column=5, value=float(line.get("credit", 0.0)))
        c_cell.font = CELL_FONT
        c_cell.number_format = NUM_FORMAT_CURRENCY
        cur_row += 1

    # Totals Row
    ws.cell(row=cur_row, column=1, value="TOTALS").font = TOTAL_FONT
    d_tot = ws.cell(row=cur_row, column=4, value=float(report.get("total_debits", 0.0)))
    d_tot.font = TOTAL_FONT
    d_tot.number_format = NUM_FORMAT_CURRENCY
    d_tot.border = TOTAL_BORDER
    c_tot = ws.cell(row=cur_row, column=5, value=float(report.get("total_credits", 0.0)))
    c_tot.font = TOTAL_FONT
    c_tot.number_format = NUM_FORMAT_CURRENCY
    c_tot.border = TOTAL_BORDER

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 9. Statement of Cash Flows
# ----------------------------------------------------------------------
def export_cash_flow_xlsx(report: Dict[str, Any], metadata: Dict[str, Any], can_view_sensitive: bool = True) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Cash Flows"
    ws.views.sheetView[0].showGridLines = True

    start_row = write_standard_metadata_header(ws, report.get("report_title", "Statement of Cash Flows"), metadata)

    cur_row = start_row
    ws.cell(row=cur_row, column=1, value="Cash & Cash Equivalents at Beginning of Period").font = TOTAL_FONT
    b_cell = ws.cell(row=cur_row, column=2, value=float(report.get("beginning_cash_balance", 0.0)))
    b_cell.font = TOTAL_FONT
    b_cell.number_format = NUM_FORMAT_CURRENCY
    cur_row += 2

    for sec_name, items, net_val in [
        ("Operating Activities", report.get("operating_activities", []), report.get("net_cash_operating", 0.0)),
        ("Investing Activities", report.get("investing_activities", []), report.get("net_cash_investing", 0.0)),
        ("Financing Activities", report.get("financing_activities", []), report.get("net_cash_financing", 0.0)),
    ]:
        ws.cell(row=cur_row, column=1, value=f"Cash Flows from {sec_name}").font = TITLE_FONT
        cur_row += 1
        for it in items:
            ws.cell(row=cur_row, column=1, value=sanitize_cell_value(it.get("name"))).font = CELL_FONT
            c = ws.cell(row=cur_row, column=2, value=float(it.get("amount", 0.0)))
            c.font = CELL_FONT
            c.number_format = NUM_FORMAT_CURRENCY
            cur_row += 1

        ws.cell(row=cur_row, column=1, value=f"Net Cash from {sec_name}").font = TOTAL_FONT
        net_c = ws.cell(row=cur_row, column=2, value=float(net_val))
        net_c.font = TOTAL_FONT
        net_c.number_format = NUM_FORMAT_CURRENCY
        cur_row += 2

    ws.cell(row=cur_row, column=1, value="Net Increase / (Decrease) in Cash").font = TOTAL_FONT
    c_diff = ws.cell(row=cur_row, column=2, value=float(report.get("net_change_in_cash", 0.0)))
    c_diff.font = TOTAL_FONT
    c_diff.number_format = NUM_FORMAT_CURRENCY
    cur_row += 1

    ws.cell(row=cur_row, column=1, value="Cash & Cash Equivalents at End of Period").font = TOTAL_FONT
    c_end = ws.cell(row=cur_row, column=2, value=float(report.get("ending_cash_balance", 0.0)))
    c_end.font = TOTAL_FONT
    c_end.number_format = NUM_FORMAT_CURRENCY
    c_end.border = TOTAL_BORDER

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 10. Aging Reports (AR and AP)
# ----------------------------------------------------------------------
def export_aging_xlsx(report: Dict[str, Any], metadata: Dict[str, Any], can_view_sensitive: bool = True) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Aging Report"
    ws.views.sheetView[0].showGridLines = True

    start_row = write_standard_metadata_header(ws, report.get("report_title", "Aging Report"), metadata)

    cur_row = start_row
    entity_col_name = "Customer" if report.get("aging_type") == "ar" else "Vendor"
    headers = [entity_col_name, "Invoices/Bills", "Current", "1 - 30 Days", "31 - 60 Days", "61 - 90 Days", "90+ Days", "Total Outstanding"]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=cur_row, column=col_idx, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = THIN_BORDER
    cur_row += 1

    for r in report.get("rows", []):
        b = r.get("buckets", {})
        ws.cell(row=cur_row, column=1, value=sanitize_cell_value(r.get("name"))).font = CELL_FONT
        ws.cell(row=cur_row, column=2, value=r.get("outstanding_count", 0)).font = CELL_FONT

        for idx, key in enumerate(["current", "days_1_30", "days_31_60", "days_61_90", "days_over_90", "total"], start=3):
            c = ws.cell(row=cur_row, column=idx, value=float(b.get(key, 0.0)))
            c.font = CELL_FONT
            c.number_format = NUM_FORMAT_CURRENCY
        cur_row += 1

    # Totals Row
    t = report.get("totals", {})
    ws.cell(row=cur_row, column=1, value="TOTALS").font = TOTAL_FONT
    ws.cell(row=cur_row, column=2, value=report.get("total_open_count", 0)).font = TOTAL_FONT
    for idx, key in enumerate(["current", "days_1_30", "days_31_60", "days_61_90", "days_over_90", "total"], start=3):
        c = ws.cell(row=cur_row, column=idx, value=float(t.get(key, 0.0)))
        c.font = TOTAL_FONT
        c.number_format = NUM_FORMAT_CURRENCY
        c.border = TOTAL_BORDER

    _auto_fit_columns(ws)
    return _save_workbook_to_bytes(wb)


# ----------------------------------------------------------------------
# 11. Generic Clean CSV Exporter with Metadata Header & Formula Defense
# ----------------------------------------------------------------------
def export_report_csv(report_data: Dict[str, Any], report_key: str, metadata: Dict[str, Any], can_view_sensitive: bool = True) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    # Standardized metadata comments at top
    writer.writerow(["# Report:", sanitize_cell_value(report_data.get("report_title", report_key))])
    writer.writerow(["# Entity:", sanitize_cell_value(metadata.get("entity", "All"))])
    writer.writerow(["# Basis:", sanitize_cell_value(str(metadata.get("basis", "cash")).upper())])
    writer.writerow(["# Currency:", sanitize_cell_value(metadata.get("currency", "USD"))])
    writer.writerow(["# Period:", sanitize_cell_value(metadata.get("period", "All"))])
    writer.writerow(["# Generated At:", sanitize_cell_value(metadata.get("generated_at", ""))])
    writer.writerow(["# Requesting User:", sanitize_cell_value(metadata.get("requesting_user", ""))])
    writer.writerow([])  # Blank spacer row

    if report_key == "profit-and-loss":
        writer.writerow(["Section", "Category", "Amount", "Percentage"])
        for it in report_data.get("revenue_items", []):
            writer.writerow(["Revenue", sanitize_cell_value(it.get("category_name")), it.get("amount", 0.0), f"{it.get('percentage', 0.0)}%"])
        for it in report_data.get("expense_items", []):
            writer.writerow(["Expense", sanitize_cell_value(it.get("category_name")), it.get("amount", 0.0), f"{it.get('percentage', 0.0)}%"])
        writer.writerow(["SUMMARY", "Net Income", report_data.get("net_income", 0.0), f"{report_data.get('net_margin_pct', 0.0)}%"])

    elif report_key == "balance-sheet":
        writer.writerow(["Section", "Account", "Note", "Balance"])
        for sec in ["assets", "liabilities", "equity"]:
            s_data = report_data.get(sec, {})
            for it in s_data.get("items", []):
                acc = it.get("name", "")
                if not can_view_sensitive and "#" in acc:
                    acc = mask_account_number(acc)
                writer.writerow([sec.upper(), sanitize_cell_value(acc), sanitize_cell_value(it.get("note", "")), it.get("amount", 0.0)])
            writer.writerow([sec.upper(), f"Total {sec.title()}", "", s_data.get("total", 0.0)])

    elif report_key == "trial-balance":
        writer.writerow(["Account Code", "Account Name", "Account Type", "Debit", "Credit"])
        for l in report_data.get("lines", []):
            acc = l.get("name", "")
            if not can_view_sensitive and "#" in acc:
                acc = mask_account_number(acc)
            writer.writerow([sanitize_cell_value(l.get("code")), sanitize_cell_value(acc), sanitize_cell_value(l.get("type")), l.get("debit", 0.0), l.get("credit", 0.0)])
        writer.writerow(["TOTALS", "", "", report_data.get("total_debits", 0.0), report_data.get("total_credits", 0.0)])

    elif report_key in ("ar-aging", "ap-aging"):
        entity_name = "Customer" if report_key == "ar-aging" else "Vendor"
        writer.writerow([entity_name, "Open Items", "Current", "1 - 30 Days", "31 - 60 Days", "61 - 90 Days", "90+ Days", "Total Due"])
        for r in report_data.get("rows", []):
            b = r.get("buckets", {})
            writer.writerow([
                sanitize_cell_value(r.get("name")),
                r.get("outstanding_count", 0),
                b.get("current", 0.0),
                b.get("days_1_30", 0.0),
                b.get("days_31_60", 0.0),
                b.get("days_61_90", 0.0),
                b.get("days_over_90", 0.0),
                b.get("total", 0.0),
            ])
        t = report_data.get("totals", {})
        writer.writerow([
            "TOTALS",
            report_data.get("total_open_count", 0),
            t.get("current", 0.0),
            t.get("days_1_30", 0.0),
            t.get("days_31_60", 0.0),
            t.get("days_61_90", 0.0),
            t.get("days_over_90", 0.0),
            t.get("total", 0.0),
        ])

    elif report_key == "transactions":
        writer.writerow(["Date", "Account", "Direction", "Category", "Payment Type", "Amount", "Currency", "Reference", "Description", "Cheque #", "Running Balance"])
        for t in report_data.get("transactions", []):
            acc = t.get("account_name", "")
            if not can_view_sensitive:
                acc = mask_account_number(acc)
            writer.writerow([
                sanitize_cell_value(t.get("date")),
                sanitize_cell_value(acc),
                sanitize_cell_value(t.get("direction")),
                sanitize_cell_value(t.get("category")),
                sanitize_cell_value(t.get("payment_type")),
                t.get("amount", 0.0),
                sanitize_cell_value(t.get("currency")),
                sanitize_cell_value(t.get("reference")),
                sanitize_cell_value(t.get("description")),
                sanitize_cell_value(t.get("cheque_number")),
                t.get("running_balance", 0.0),
            ])
    else:
        writer.writerow(["Item", "Value"])
        for k, v in report_data.items():
            if isinstance(v, (str, int, float, bool)):
                writer.writerow([sanitize_cell_value(k), sanitize_cell_value(v)])

    return output.getvalue().encode("utf-8")

