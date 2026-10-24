"""
be/analytics/exporters.py
Export generators for Employee Pay Analytics (XLSX and CSV).
Features formula injection neutralization and permission-scoped sheet/row inclusion.
"""
import io
import csv
from typing import Dict, Any, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side


def sanitize_cell_value(val: Any) -> Any:
    """Formula injection defense: neutralizes spreadsheet formula triggers."""
    if isinstance(val, str) and val:
        if val[0] in ("=", "+", "-", "@", "\t", "\r"):
            return f"'{val}"
    return val


def export_employee_pay_xlsx(
    pay_data: Dict[str, Any],
    can_view_payments: bool,
    can_view_plan: bool,
) -> bytes:
    """
    Generates an XLSX workbook for employee pay analytics:
    - Sheet 'Monthly': period, base external, base internal, base total, commission, bonus, total, payment status, paid date
    - Sheet 'Raises': date, previous, new, delta, %, reason
    Includes only sheets the caller is permitted to see.
    """
    wb = openpyxl.Workbook()
    # Remove default empty sheet later or rename it
    sheets_created = []

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")

    if can_view_payments and "payments" in pay_data:
        ws_monthly = wb.active if not sheets_created else wb.create_sheet(title="Monthly")
        ws_monthly.title = "Monthly"
        sheets_created.append(ws_monthly)

        headers = [
            "Period",
            "Base External",
            "Base Internal",
            "Base Total",
            "Commission",
            "Bonus",
            "Total",
            "Payment Status",
            "Paid Date",
        ]
        ws_monthly.append([sanitize_cell_value(h) for h in headers])
        for col_idx in range(1, len(headers) + 1):
            cell = ws_monthly.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill

        series = pay_data.get("payments", {}).get("series", [])
        for item in series:
            b_ext = item.get("base_external", 0.0)
            b_int = item.get("base_internal", 0.0)
            b_tot = round(b_ext + b_int, 2)
            row = [
                sanitize_cell_value(item.get("bucket", "")),
                b_ext,
                b_int,
                b_tot,
                item.get("commission", 0.0),
                item.get("bonus", 0.0),
                item.get("total", 0.0),
                sanitize_cell_value(item.get("payment_status", "")),
                sanitize_cell_value(item.get("paid_at") or "—"),
            ]
            ws_monthly.append(row)

    if can_view_plan and "plan" in pay_data:
        ws_raises = wb.active if not sheets_created else wb.create_sheet(title="Raises")
        ws_raises.title = "Raises"
        sheets_created.append(ws_raises)

        headers = ["Date", "Previous", "New", "Delta", "%", "Reason"]
        ws_raises.append([sanitize_cell_value(h) for h in headers])
        for col_idx in range(1, len(headers) + 1):
            cell = ws_raises.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill

        changes = pay_data.get("plan", {}).get("changes", [])
        for ch in changes:
            prev = ch.get("previous_total", 0.0)
            new_tot = ch.get("new_total", 0.0)
            delta = round(new_tot - prev, 2)
            row = [
                sanitize_cell_value(ch.get("date", "")),
                prev,
                new_tot,
                delta,
                sanitize_cell_value(ch.get("pct_change", "")),
                sanitize_cell_value(ch.get("reason", "")),
            ]
            ws_raises.append(row)

    stream = io.BytesIO()
    wb.save(stream)
    return stream.getvalue()


def export_employee_pay_csv(
    pay_data: Dict[str, Any],
    dataset: str = "monthly",
) -> str:
    """
    Generates CSV content for either 'monthly' or 'raises' dataset.
    All cells are sanitized against formula injection.
    """
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")

    if dataset == "raises":
        headers = ["Date", "Previous", "New", "Delta", "%", "Reason"]
        writer.writerow([sanitize_cell_value(h) for h in headers])
        changes = pay_data.get("plan", {}).get("changes", [])
        for ch in changes:
            prev = ch.get("previous_total", 0.0)
            new_tot = ch.get("new_total", 0.0)
            delta = round(new_tot - prev, 2)
            writer.writerow([
                sanitize_cell_value(ch.get("date", "")),
                prev,
                new_tot,
                delta,
                sanitize_cell_value(ch.get("pct_change", "")),
                sanitize_cell_value(ch.get("reason", "")),
            ])
    else:  # default "monthly"
        headers = [
            "Period",
            "Base External",
            "Base Internal",
            "Base Total",
            "Commission",
            "Bonus",
            "Total",
            "Payment Status",
            "Paid Date",
        ]
        writer.writerow([sanitize_cell_value(h) for h in headers])
        series = pay_data.get("payments", {}).get("series", [])
        for item in series:
            b_ext = item.get("base_external", 0.0)
            b_int = item.get("base_internal", 0.0)
            b_tot = round(b_ext + b_int, 2)
            writer.writerow([
                sanitize_cell_value(item.get("bucket", "")),
                b_ext,
                b_int,
                b_tot,
                item.get("commission", 0.0),
                item.get("bonus", 0.0),
                item.get("total", 0.0),
                sanitize_cell_value(item.get("payment_status", "")),
                sanitize_cell_value(item.get("paid_at") or "—"),
            ])

    return output.getvalue()
