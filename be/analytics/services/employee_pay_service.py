"""
be/analytics/services/employee_pay_service.py
Service layer for Employee Pay Analytics view (FUX-3I).
Composes data across HR and Finance domains using public service/repository interfaces only.
"""
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple, Set
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from repositories.interfaces import EmployeeRepository
from finance.services.payroll_read_service import PayrollReadService
from finance.services.compensation_plan_service import CompensationPlanService
from logging_config import get_logger

logger = get_logger("analytics")


def _get_bucket_and_label(period_start: str, group_by: str) -> Tuple[str, str]:
    """Derives bucket identifier and display label from run period_start."""
    month_str = period_start[:7]
    dt = datetime.strptime(month_str, "%Y-%m")
    if group_by == "quarter":
        q = (dt.month - 1) // 3 + 1
        bucket = f"{dt.year}-Q{q}"
        label = f"Q{q} {dt.year}"
        return bucket, label
    else:
        bucket = month_str
        label = dt.strftime("%b %Y")
        return bucket, label


class EmployeePayService:
    def __init__(
        self,
        db: Session,
        employee_repo: EmployeeRepository,
        payroll_read_service: PayrollReadService,
        comp_plan_service: CompensationPlanService,
    ):
        self.db = db
        self.employee_repo = employee_repo
        self.payroll_read_service = payroll_read_service
        self.comp_plan_service = comp_plan_service

    def get_employee_pay_view(
        self,
        employee_id: int,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        group_by: str = "month",
        currency: str = "USD",
        can_view_payments: bool = True,
        can_view_plan: bool = True,
    ) -> Dict[str, Any]:
        """
        Builds the employee pay analytics response.
        Enforces permissions by omitting unauthorized sections (Decision 3).
        """
        if group_by not in ("month", "quarter"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid group_by '{group_by}'. Must be 'month' or 'quarter'.",
            )

        emp = self.employee_repo.get_by_id(employee_id)
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee #{employee_id} not found",
            )

        response: Dict[str, Any] = {
            "employee": {
                "id": emp["id"],
                "name": emp.get("name") or "",
                "department": emp.get("dept") or "General",
            },
            "period": {
                "start_date": start_date,
                "end_date": end_date,
                "group_by": group_by,
                "currency": currency,
            },
            "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

        # 1. Payments section (finance.report.read)
        if can_view_payments:
            pay_lines = self.payroll_read_service.get_employee_pay_lines(
                employee_id=employee_id,
                start=start_date,
                end=end_date,
                currency=currency,
            )
            currencies_available = self.payroll_read_service.get_available_currencies(employee_id)
            response["currencies_available"] = currencies_available

            # Group lines into buckets
            buckets: Dict[str, Dict[str, Any]] = {}
            run_ids: Set[int] = set()

            for line, run in pay_lines:
                run_ids.add(run.id)
                bucket_key, label = _get_bucket_and_label(run.period_start, group_by)

                if bucket_key not in buckets:
                    buckets[bucket_key] = {
                        "bucket": bucket_key,
                        "label": label,
                        "base_external": 0.0,
                        "base_internal": 0.0,
                        "commission": 0.0,
                        "bonus": 0.0,
                        "line_statuses": [],
                        "paid_dates": [],
                    }

                b = buckets[bucket_key]
                amt = round(float(line.base_salary or 0.0) + float(line.allowances_total or 0.0), 2)
                ctype = (line.compensation_type or "").strip().lower()

                if ctype == "external_usd":
                    b["base_external"] += amt
                elif ctype == "internal_usd_cash":
                    b["base_internal"] += amt
                elif "commission" in ctype:
                    b["commission"] += amt
                elif "bonus" in ctype:
                    b["bonus"] += amt
                else:
                    logger.warning(
                        "Unknown compensation_type '%s' for line %s (employee %s); counting as base internal",
                        line.compensation_type, line.id, employee_id
                    )
                    b["base_internal"] += amt

                # Status tracking (Decision 6: Draft runs are included with payment_status = 'draft')
                if run.status == "draft":
                    line_status = "draft"
                else:
                    line_status = (line.payment_status or "pending").lower()
                b["line_statuses"].append(line_status)

                paid_val = line.paid_at or run.paid_at
                if paid_val:
                    b["paid_dates"].append(paid_val)

            series: List[Dict[str, Any]] = []
            for b_key in sorted(buckets.keys()):
                b = buckets[b_key]
                st_set = set(b["line_statuses"])
                if st_set == {"paid"}:
                    p_status = "paid"
                elif st_set == {"draft"}:
                    p_status = "draft"
                elif st_set == {"pending"}:
                    p_status = "pending"
                else:
                    p_status = "mixed"

                paid_at_str = None
                if b["paid_dates"]:
                    max_dt = max(b["paid_dates"])
                    paid_at_str = max_dt.isoformat() if hasattr(max_dt, "isoformat") else str(max_dt)

                b_ext = round(b["base_external"], 2)
                b_int = round(b["base_internal"], 2)
                b_comm = round(b["commission"], 2)
                b_bon = round(b["bonus"], 2)
                b_tot = round(b_ext + b_int + b_comm + b_bon, 2)

                series.append({
                    "bucket": b["bucket"],
                    "label": b["label"],
                    "base_external": b_ext,
                    "base_internal": b_int,
                    "commission": b_comm,
                    "bonus": b_bon,
                    "total": b_tot,
                    "payment_status": p_status,
                    "paid_at": paid_at_str,
                })

            totals = {
                "base_external": round(sum(s["base_external"] for s in series), 2),
                "base_internal": round(sum(s["base_internal"] for s in series), 2),
                "commission": round(sum(s["commission"] for s in series), 2),
                "bonus": round(sum(s["bonus"] for s in series), 2),
                "total": round(sum(s["total"] for s in series), 2),
                "cycles": len(run_ids),
                "buckets_with_commission": sum(1 for s in series if s["commission"] > 0),
            }

            response["payments"] = {
                "totals": totals,
                "series": series,
            }

        # 2. Plan / raises section (hr.salary.read)
        if can_view_plan:
            pay_history = self.comp_plan_service.get_pay_history(employee_id)
            changes = [
                {
                    "date": h.get("date") or "",
                    "previous_total": round(float(h.get("previous_internal_usd") or 0.0) + float(h.get("previous_external_usd") or 0.0), 2),
                    "new_total": round(float(h.get("new_total_usd") or (float(h.get("new_internal_usd") or 0.0) + float(h.get("new_external_usd") or 0.0))), 2),
                    "new_internal": round(float(h.get("new_internal_usd") or 0.0), 2),
                    "new_external": round(float(h.get("new_external_usd") or 0.0), 2),
                    "pct_change": str(h.get("pct_change") or ""),
                    "reason": str(h.get("reason") or ""),
                }
                for h in pay_history
            ]

            active_plan = self.comp_plan_service.get_active_plan(employee_id)
            ext = active_plan.get("external_usd")
            int_cash = active_plan.get("internal_usd_cash")
            ext_amt = round(float(ext.amount), 2) if ext and ext.amount else 0.0
            int_amt = round(float(int_cash.amount), 2) if int_cash and int_cash.amount else 0.0
            eff_dates = [c.effective_start_date for c in (ext, int_cash) if c and c.effective_start_date]
            eff_date = max(eff_dates) if eff_dates else (changes[0]["date"] if changes else None)

            if ext_amt == 0.0 and int_amt == 0.0 and changes:
                int_amt = changes[0]["new_internal"]
                ext_amt = changes[0]["new_external"]
                eff_date = changes[0]["date"]

            current = {
                "internal": int_amt,
                "external": ext_amt,
                "total": round(int_amt + ext_amt, 2),
                "effective_date": eff_date,
            }

            response["plan"] = {
                "current": current,
                "changes": changes,
            }

        return response
