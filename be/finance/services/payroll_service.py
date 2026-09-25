"""
be/finance/services/payroll_service.py
Service layer for Guided Payroll Runs, Net-Payment Readiness Verification,
Maker-Checker Approvals, Payment Execution, and GL Journal Posting.
"""
import hashlib
import json
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import desc
import csv
import io
from fastapi import HTTPException, status

from models_db import EmployeeDB, EmployeeBankAccountDB, AuditLogDB, EmployeeSocialInsuranceDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    PayrollAdjustmentDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    StatutoryObligationDB,
    AccountTransferDB,
    PayrollSettingsDB,
)
from finance.schemas import PayrollAdjustmentCreate, PayrollAdjustmentUpdate
from finance.repositories.compensation_plan_repository import CompensationPlanRepository
from repositories.social_insurance_repository import SocialInsuranceRepository
from finance.services.payroll_calculation_helper import validate_and_calculate_internal_statutory

# In-memory store for active previews and draft adjustments during runner execution
_PREVIEW_CACHE: Dict[str, Dict[str, Any]] = {}


class PayrollService:
    def __init__(self, db: Session):
        self.db = db
        self.social_insurance_repo = SocialInsuranceRepository(db)

    def get_payroll_settings(self) -> PayrollSettingsDB:
        """Fetch current organization-wide payroll rate settings, initializing defaults if needed."""
        settings = self.db.query(PayrollSettingsDB).filter(PayrollSettingsDB.id == 1).first()
        if not settings:
            settings = PayrollSettingsDB(
                id=1,
                employee_rate=0.11,
                employer_rate=0.18,
                updated_at=datetime.utcnow(),
                updated_by="system",
            )
            self.db.add(settings)
            self.db.commit()
            self.db.refresh(settings)
        return settings

    def update_payroll_settings(
        self,
        employee_rate: Optional[float] = None,
        employer_rate: Optional[float] = None,
        user_email: Optional[str] = None,
    ) -> PayrollSettingsDB:
        """Update organization-wide social insurance contribution rates."""
        settings = self.get_payroll_settings()
        old_emp_rate = settings.employee_rate
        old_org_rate = settings.employer_rate

        if employee_rate is not None:
            if not (0.0 <= float(employee_rate) <= 1.0):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Employee contribution rate must be between 0.0 and 1.0 (0% to 100%)",
                )
            settings.employee_rate = round(float(employee_rate), 4)

        if employer_rate is not None:
            if not (0.0 <= float(employer_rate) <= 1.0):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Employer contribution rate must be between 0.0 and 1.0 (0% to 100%)",
                )
            settings.employer_rate = round(float(employer_rate), 4)

        settings.updated_at = datetime.utcnow()
        settings.updated_by = user_email or "system"

        try:
            audit = AuditLogDB(
                timestamp=datetime.utcnow().isoformat() + "Z",
                actor_email=user_email or "system@hrflow.internal",
                action="payroll.settings.rates_updated",
                target_type="payroll_settings",
                target_id="1",
                details=json.dumps({
                    "old_employee_rate": old_emp_rate,
                    "new_employee_rate": settings.employee_rate,
                    "old_employer_rate": old_org_rate,
                    "new_employer_rate": settings.employer_rate,
                }),
            )
            self.db.add(audit)
        except Exception:
            pass

        self.db.commit()
        self.db.refresh(settings)
        return settings

    def list_runs(
        self,
        status_filter: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Lists payroll runs with period, totals, and lifecycle status."""
        query = self.db.query(PayrollRunDB)
        if status_filter and status_filter.lower() != "all":
            query = query.filter(PayrollRunDB.status == status_filter.lower())
        if search:
            s = f"%{search}%"
            query = query.filter(PayrollRunDB.period_label.ilike(s))

        runs = query.order_by(desc(PayrollRunDB.id)).offset(offset).limit(limit).all()
        return [self._format_run_summary(r) for r in runs]

    def get_run(self, run_id: int) -> Dict[str, Any]:
        """Returns full detail of a payroll run including lines, exceptions, and execution status."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")
        return self._format_run_detail(run)

    def _resolve_fx_rate(
        self,
        fx_rate_source: Optional[str],
        fx_rate_value: Optional[float],
        period_start: str,
        period_end: str,
    ) -> float:
        """Resolves the FX rate (USD to EGP) per policy or manual override, locked for the run."""
        if fx_rate_value is not None and fx_rate_value > 0:
            return round(float(fx_rate_value), 4)

        tx_query = self.db.query(AccountTransferDB).filter(
            AccountTransferDB.from_currency == "USD",
            AccountTransferDB.to_currency == "EGP",
        )
        if fx_rate_source == "payment_date":
            transfer = tx_query.filter(AccountTransferDB.date <= period_end).order_by(desc(AccountTransferDB.date)).first()
        else:
            transfer = tx_query.filter(AccountTransferDB.date <= period_start).order_by(desc(AccountTransferDB.date)).first()
            if not transfer:
                transfer = tx_query.order_by(desc(AccountTransferDB.date)).first()

        if transfer and transfer.from_amount and transfer.from_amount > 0:
            return round(transfer.to_amount / transfer.from_amount, 4)

        return 50.0

    def _generate_source_version(self, lines: List[Dict[str, Any]], ext_id: Any, int_id: Any, fx: Any) -> str:
        """Generates an opaque cryptographic hash representing the authoritative source inputs for the preview."""
        raw = f"ext:{ext_id}|int:{int_id}|fx:{fx}"
        for l in sorted(lines, key=lambda x: (x.get("employee_id", 0), x.get("compensation_type", ""))):
            raw += f"|{l.get('employee_id')}:{l.get('compensation_type')}:{l.get('net_pay')}:{l.get('bank_account_masked')}"
        return f"src-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:12]}"

    def preview_run(
        self,
        period_label: str,
        period_start: str,
        period_end: str,
        payment_date: Optional[str] = None,
        bank_account_id: Optional[int] = None,
        external_funding_account_id: Optional[int] = None,
        internal_funding_account_id: Optional[int] = None,
        fx_rate_source: Optional[str] = "first_of_month",
        fx_rate_value: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Evaluates active employee records and active compensation plans to preview net payments,
        detect route-specific readiness exceptions, and compare net variance vs prior period.
        """
        # 1. Resolve Bank Accounts
        bank_account = None
        if bank_account_id:
            bank_account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == bank_account_id).first()
        if not bank_account:
            bank_account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True).first()

        ext_account = None
        if external_funding_account_id:
            ext_account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == external_funding_account_id).first()

        int_account = None
        if internal_funding_account_id:
            int_account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == internal_funding_account_id).first()

        # Resolve FX rate
        resolved_fx = self._resolve_fx_rate(fx_rate_source, fx_rate_value, period_start, period_end)
        pay_date = payment_date or period_end

        # 2. Fetch Active Employees & Plans
        employees = (
            self.db.query(EmployeeDB)
            .filter(EmployeeDB.status.ilike("active"))
            .order_by(EmployeeDB.name.asc())
            .all()
        )

        comp_repo = CompensationPlanRepository(self.db)
        settings = self.get_payroll_settings()
        emp_rate = float(settings.employee_rate)
        org_rate = float(settings.employer_rate)

        lines: List[Dict[str, Any]] = []
        recipients: List[Dict[str, Any]] = []
        exceptions: List[Dict[str, Any]] = []
        has_blocking = False
        tot_net = 0.0
        tot_gross = 0.0
        tot_deductions = 0.0
        tot_employer_cost = 0.0
        tot_emp_tax_egp = 0.0
        tot_si_egp = 0.0

        for emp in employees:
            bank_rec = emp.bank_account
            bank_name = bank_rec.bank_name if bank_rec else None
            iban = bank_rec.iban if bank_rec else None
            masked_acc = f"••••{iban[-4:]}" if iban and len(iban) >= 4 else None

            comps = comp_repo.get_components_for_period(emp.id, period_start, period_end)
            if not comps:
                has_blocking = True
                exceptions.append({
                    "id": f"exc-plan-{emp.id}",
                    "employee_id": emp.id,
                    "employee_name": emp.name,
                    "severity": "blocking",
                    "code": "MISSING_COMP_PLAN",
                    "title": "No Active Compensation Plan",
                    "description": f"{emp.name} has no active external/internal compensation plan configured for this period. Configure their plan under Salary before running payroll.",
                    "correction_path": f"/admin?section=salary&employee_id={emp.id}",
                    "is_resolved": False,
                })
                continue

            has_external_route = any(c.component_type == "external_usd" for c in comps)
            if has_external_route and (not bank_rec or not iban):
                has_blocking = True
                exceptions.append({
                    "id": f"exc-bank-{emp.id}",
                    "employee_id": emp.id,
                    "employee_name": emp.name,
                    "severity": "blocking",
                    "code": "MISSING_BANK_DETAILS",
                    "title": "Missing Bank Wire Details",
                    "description": f"{emp.name} is scheduled for external bank payment but does not have verified wire / IBAN details on file.",
                    "correction_path": f"/admin?section=employees&employee_id={emp.id}",
                    "is_resolved": False,
                })

            # Check social insurance configuration
            social_ins = self.social_insurance_repo.get_insurance_for_period(emp.id, period_start, period_end)
            insured_flag = bool(social_ins.insured_flag) if social_ins else False
            insured_base = float(social_ins.insured_base) if (social_ins and social_ins.insured_base is not None) else None
            insured_currency = social_ins.currency if social_ins else None

            # Check internal salary presence & basis
            int_comp = next((c for c in comps if c.component_type != "external_usd"), None)
            internal_salary = float(int_comp.amount or 0.0) if int_comp else float(emp.internal_salary_usd or 0.0)
            salary_basis = getattr(int_comp, "salary_basis", "NET") if int_comp else "NET"

            stat_res, stat_exceptions = validate_and_calculate_internal_statutory(
                employee_id=emp.id,
                employee_name=emp.name,
                internal_usd_amount=internal_salary,
                salary_basis=salary_basis,
                locked_fx_rate=resolved_fx,
                insured_flag=insured_flag,
                insured_base=insured_base,
                insured_currency=insured_currency,
                employee_rate=emp_rate,
                employer_rate=org_rate,
                bonus_usd=0.0,
                commission_usd=0.0,
            )
            if stat_exceptions:
                exceptions.extend(stat_exceptions)
                if any(e.get("severity") == "blocking" for e in stat_exceptions):
                    has_blocking = True

            base_int = 0.0
            base_ext = 0.0
            for comp in comps:
                comp_type = comp.component_type
                amount = round(float(comp.amount or 0.0), 2)
                if comp_type == "external_usd":
                    deduction = 0.0
                    net = amount
                    cost = 0.0
                    base_ext += amount
                    is_ins = False
                    base_snap = 0.0
                    emp_r_snap = 0.0
                    org_r_snap = 0.0
                    sal_basis_snap = None
                    conf_int_sal_snap = 0.0
                    ins_base_egp_snap = 0.0
                    fx_rate_snap = resolved_fx
                    base_gross_egp_val = 0.0
                    var_gross_egp_val = 0.0
                    emp_si_egp_val = 0.0
                    org_si_egp_val = 0.0
                    tot_si_egp_val = 0.0
                    emp_tax_egp_val = 0.0
                    emp_si_usd_eq_val = 0.0
                    emp_tax_usd_eq_val = 0.0
                    fin_int_net_egp_val = 0.0
                    fin_int_pay_usd_val = None
                else:
                    deduction = stat_res["deductions_total_usd"]
                    net = stat_res["net_pay_usd"]
                    cost = stat_res["employer_cost_extra_usd"]
                    base_int += net
                    is_ins = insured_flag
                    base_snap = stat_res["insured_base_egp"]
                    emp_r_snap = stat_res["employee_rate"]
                    org_r_snap = stat_res["employer_rate"]
                    sal_basis_snap = stat_res["salary_basis"]
                    conf_int_sal_snap = stat_res["configured_internal_salary_usd"]
                    ins_base_egp_snap = stat_res["insured_base_egp"]
                    fx_rate_snap = stat_res["fx_rate"]
                    base_gross_egp_val = stat_res["base_gross_egp"]
                    var_gross_egp_val = stat_res["variable_gross_egp"]
                    emp_si_egp_val = stat_res["employee_social_insurance_egp"]
                    org_si_egp_val = stat_res["employer_social_insurance_egp"]
                    tot_si_egp_val = stat_res["total_social_insurance_egp"]
                    emp_tax_egp_val = stat_res["employee_tax_egp"]
                    emp_si_usd_eq_val = stat_res["employee_social_insurance_usd_equivalent"]
                    emp_tax_usd_eq_val = stat_res["employee_tax_usd_equivalent"]
                    fin_int_net_egp_val = stat_res["final_internal_net_egp"]
                    fin_int_pay_usd_val = stat_res["final_internal_payment_usd"]

                    tot_emp_tax_egp += emp_tax_egp_val
                    tot_si_egp += tot_si_egp_val

                tot_gross += amount
                tot_deductions += deduction
                tot_net += net
                tot_employer_cost += cost

                lines.append({
                    "id": emp.id,
                    "payroll_run_id": 0,
                    "employee_id": emp.id,
                    "employee_name": emp.name,
                    "department": emp.dept or "General",
                    "compensation_type": comp_type,
                    "base_salary": amount,
                    "deductions_total": deduction,
                    "net_pay": net,
                    "amount": net,
                    "employer_cost_extra": cost,
                    "is_insurable": is_ins,
                    "insured_base_snapshot": base_snap,
                    "employee_rate_snapshot": emp_r_snap,
                    "employer_rate_snapshot": org_r_snap,
                    "salary_basis_snapshot": sal_basis_snap,
                    "configured_internal_salary_usd_snapshot": conf_int_sal_snap,
                    "insured_base_egp_snapshot": ins_base_egp_snap,
                    "fx_rate_snapshot": fx_rate_snap,
                    "base_gross_egp": base_gross_egp_val,
                    "variable_gross_egp": var_gross_egp_val,
                    "employee_social_insurance_egp": emp_si_egp_val,
                    "employer_social_insurance_egp": org_si_egp_val,
                    "total_social_insurance_egp": tot_si_egp_val,
                    "employee_tax_egp": emp_tax_egp_val,
                    "employee_social_insurance_usd_equivalent": emp_si_usd_eq_val,
                    "employee_tax_usd_equivalent": emp_tax_usd_eq_val,
                    "final_internal_net_egp": fin_int_net_egp_val,
                    "final_internal_payment_usd": fin_int_pay_usd_val,
                    "currency": "USD",
                    "bank_name": bank_name or "Unassigned",
                    "bank_account_masked": masked_acc or "Not Provided",
                    "payment_status": "pending",
                    "failure_reason": None,
                    "snapshot_notes": f"{comp_type.replace('_', ' ').title()} - {period_label}",
                    "created_at": datetime.utcnow().isoformat(),
                    "paid_at": None,
                })

            emp_issues = [e["description"] for e in exceptions if e.get("employee_id") == emp.id]
            emp_has_blocker = any(e.get("severity") == "blocking" for e in exceptions if e.get("employee_id") == emp.id)
            emp_has_warning = any(e.get("severity") == "warning" for e in exceptions if e.get("employee_id") == emp.id)
            emp_status = "BLOCKER" if emp_has_blocker else ("WARNING" if emp_has_warning else "READY")

            recipients.append({
                "employee_id": emp.id,
                "employee_name": emp.name,
                "department": emp.dept or "General",
                "base_int_amount": round(stat_res["final_internal_payment_usd"], 2) if int_comp else 0.0,
                "base_ext_amount": round(base_ext, 2),
                "int_deductions_total": stat_res["deductions_total_usd"] if int_comp else 0.0,
                "deductions_label": "Social Insurance (Internal Estimate)" if (int_comp and stat_res.get("deductions_total_usd", 0) > 0) else None,
                "employer_cost_extra": stat_res["employer_cost_extra_usd"] if int_comp else 0.0,
                "int_adjustments_total": 0.0,
                "ext_adjustments_total": 0.0,
                "final_int_amount": round(stat_res["final_internal_payment_usd"], 2) if int_comp else 0.0,
                "final_ext_amount": round(base_ext, 2),
                "final_payment_amount": round((stat_res["final_internal_payment_usd"] if int_comp else 0.0) + base_ext, 2),
                "adjustments": [],
                "bank_name": bank_name,
                "destination_masked": masked_acc,
                "readiness": {
                    "status": emp_status,
                    "issues": emp_issues,
                },
            })

        # 3. Variance Comparison vs Prior Run
        prior_run = (
            self.db.query(PayrollRunDB)
            .filter(PayrollRunDB.status.in_(["approved", "finalized", "paid"]))
            .order_by(desc(PayrollRunDB.id))
            .first()
        )

        prior_total = prior_run.total_net if prior_run else tot_net
        net_delta = round(tot_net - prior_total, 2)
        pct_change = round(((tot_net - prior_total) / prior_total * 100), 1) if prior_run and prior_total > 0 else 0.0
        headcount_delta = len(employees) - (prior_run.headcount if prior_run else len(employees))

        variance_summary = {
            "prior_period_label": prior_run.period_label if prior_run else None,
            "headcount_delta": headcount_delta,
            "net_delta": net_delta,
            "pct_change": pct_change,
            "joiners_count": max(0, headcount_delta),
            "leavers_count": max(0, -headcount_delta),
            "raises_count": 0,
        }

        # Check for warnings: unusual change or new recipient
        if prior_run and abs(pct_change) >= 20.0:
            exceptions.append({
                "id": "warn-variance-large",
                "employee_id": 0,
                "employee_name": "All Staff",
                "severity": "warning",
                "code": "LARGE_VARIANCE",
                "title": "Unusual Net Payment Variance",
                "description": f"Total net payment differs by {pct_change:+.1f}% (${net_delta:+,.2f}) compared to {prior_run.period_label}.",
                "correction_path": None,
                "is_resolved": False,
            })

        preview_id = f"PRV-{period_label.replace('-', '')}-{uuid.uuid4().hex[:6].upper()}"
        source_version = self._generate_source_version(
            lines,
            ext_account.id if ext_account else (bank_account.id if bank_account else None),
            int_account.id if int_account else (bank_account.id if bank_account else None),
            resolved_fx,
        )

        final_int_total = round(sum(r["final_int_amount"] for r in recipients), 2)
        final_ext_total = round(sum(r["final_ext_amount"] for r in recipients), 2)

        preview_data = {
            "preview_id": preview_id,
            "preview_version": 1,
            "source_version": source_version,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "period_label": period_label,
            "period_start": period_start,
            "period_end": period_end,
            "payment_date": pay_date,
            "bank_account_id": bank_account.id if bank_account else None,
            "bank_account_name": bank_account.account_name if bank_account else "Operating Account",
            "external_funding_account_id": ext_account.id if ext_account else (bank_account.id if bank_account else None),
            "external_funding_account_name": ext_account.account_name if ext_account else (bank_account.account_name if bank_account else "Operating Account"),
            "internal_funding_account_id": int_account.id if int_account else (bank_account.id if bank_account else None),
            "internal_funding_account_name": int_account.account_name if int_account else (bank_account.account_name if bank_account else "Operating Account"),
            "fx_rate_source": fx_rate_source or "first_of_month",
            "fx_rate_value": resolved_fx,
            "headcount": len(employees),
            "recipient_count": len(employees),
            "payment_line_count": len(lines),
            "total_gross": round(tot_gross, 2),
            "total_deductions": round(tot_deductions, 2),
            "total_net": round(tot_net, 2),
            "total_employer_cost": round(tot_net + tot_employer_cost, 2),
            "total_payment_amount": round(tot_net, 2),
            "total_commissions": 0.0,
            "total_bonuses": 0.0,
            "total_additions": 0.0,
            "final_int_total": final_int_total,
            "final_ext_total": final_ext_total,
            "total_employee_tax_egp": round(tot_emp_tax_egp, 2),
            "total_social_insurance_egp": round(tot_si_egp, 2),
            "prior_period_total": round(prior_total, 2),
            "change_amount": net_delta,
            "has_blocking_exceptions": has_blocking,
            "exceptions": exceptions,
            "variance_summary": variance_summary,
            "lines": lines,
            "recipients": recipients,
            "adjustments": [],
        }
        _PREVIEW_CACHE[preview_id] = preview_data
        return preview_data

    def get_preview(self, preview_id: str) -> Dict[str, Any]:
        """Retrieves active cached preview including adjustments and recipients."""
        preview = _PREVIEW_CACHE.get(preview_id)
        if not preview:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Preview '{preview_id}' not found.")
        return preview

    def list_preview_adjustments(self, preview_id: str) -> List[Dict[str, Any]]:
        """Lists active adjustments for the preview."""
        preview = self.get_preview(preview_id)
        return preview.get("adjustments", [])

    def _log_audit(
        self,
        action: str,
        target_type: str,
        target_id: str,
        actor_email: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        try:
            audit = AuditLogDB(
                timestamp=datetime.utcnow().isoformat() + "Z",
                actor_email=actor_email or "system@hrflow.internal",
                action=action,
                target_type=target_type,
                target_id=str(target_id),
                details=json.dumps(details or {}),
            )
            self.db.add(audit)
            self.db.commit()
        except Exception:
            pass

    def create_preview_adjustment(
        self,
        preview_id: str,
        payload: PayrollAdjustmentCreate,
        user_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """Adds a Commission or Bonus adjustment to a preview and immediately updates totals."""
        preview = self.get_preview(preview_id)

        emp = next((r for r in preview.get("recipients", []) if r["employee_id"] == payload.employee_id), None)
        if not emp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee #{payload.employee_id} not found in preview.")

        if payload.amount <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Adjustment amount must be greater than zero.")

        if payload.external_reference:
            existing = next((a for a in preview.get("adjustments", []) if a.get("external_reference") == payload.external_reference), None)
            if existing:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Duplicate external reference '{payload.external_reference}'.")

        adj_id = f"adj_{uuid.uuid4().hex[:8]}"
        now_iso = datetime.utcnow().isoformat() + "Z"
        adj = {
            "id": adj_id,
            "employee_id": payload.employee_id,
            "preview_id": preview_id,
            "payroll_run_id": None,
            "type": payload.type.upper(),
            "direction": "ADDITION",
            "amount": round(float(payload.amount), 2),
            "currency": payload.currency or "USD",
            "payment_source": payload.payment_source.upper(),
            "effective_period": preview["period_label"],
            "description": payload.description or f"{payload.type.title()} for {emp['employee_name']}",
            "external_reference": payload.external_reference,
            "origin": payload.origin or "MANUAL",
            "status": "DRAFT",
            "created_by": user_email,
            "created_at": now_iso,
            "updated_at": now_iso,
        }

        preview.setdefault("adjustments", []).append(adj)
        preview["preview_version"] = (preview.get("preview_version") or 1) + 1
        self._recalculate_preview_aggregates(preview)
        self._log_audit(
            action="payroll.adjustment.created",
            target_type="payroll_adjustment",
            target_id=adj_id,
            actor_email=user_email,
            details={"type": adj["type"], "amount": adj["amount"], "payment_source": adj["payment_source"], "employee_id": adj["employee_id"]},
        )
        return adj

    def update_preview_adjustment(
        self,
        preview_id: str,
        adjustment_id: str,
        payload: PayrollAdjustmentUpdate,
        user_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """Edits an existing adjustment on a preview and recalculates totals immediately."""
        preview = self.get_preview(preview_id)
        adj = next((a for a in preview.get("adjustments", []) if a["id"] == adjustment_id), None)
        if not adj:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Adjustment '{adjustment_id}' not found.")

        if payload.amount is not None:
            if payload.amount <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Adjustment amount must be greater than zero.")
            adj["amount"] = round(float(payload.amount), 2)

        if payload.payment_source is not None:
            adj["payment_source"] = payload.payment_source.upper()

        if payload.type is not None:
            adj["type"] = payload.type.upper()

        if payload.description is not None:
            adj["description"] = payload.description

        if payload.external_reference is not None:
            adj["external_reference"] = payload.external_reference

        adj["updated_at"] = datetime.utcnow().isoformat() + "Z"
        preview["preview_version"] = (preview.get("preview_version") or 1) + 1
        self._recalculate_preview_aggregates(preview)
        self._log_audit(
            action="payroll.adjustment.updated",
            target_type="payroll_adjustment",
            target_id=adjustment_id,
            actor_email=user_email,
            details={"type": adj["type"], "amount": adj["amount"], "payment_source": adj["payment_source"], "employee_id": adj["employee_id"]},
        )
        return adj

    def delete_preview_adjustment(
        self,
        preview_id: str,
        adjustment_id: str,
        user_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """Removes an adjustment from a preview and recalculates totals immediately."""
        preview = self.get_preview(preview_id)
        adjs = preview.get("adjustments", [])
        idx = next((i for i, a in enumerate(adjs) if a["id"] == adjustment_id), None)
        if idx is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Adjustment '{adjustment_id}' not found.")

        removed = adjs.pop(idx)
        preview["preview_version"] = (preview.get("preview_version") or 1) + 1
        self._recalculate_preview_aggregates(preview)
        self._log_audit(
            action="payroll.adjustment.deleted",
            target_type="payroll_adjustment",
            target_id=adjustment_id,
            actor_email=user_email,
            details={"preview_id": preview_id, "employee_id": removed.get("employee_id"), "amount": removed.get("amount")},
        )
        return {"success": True, "deleted_id": adjustment_id}

    def _recalculate_preview_aggregates(self, preview: Dict[str, Any]) -> None:
        """Recalculates recipient and run totals from base amounts and active adjustments."""
        all_adjs = preview.get("adjustments", [])
        recipients = preview.get("recipients", [])

        for r in recipients:
            emp_adjs = [a for a in all_adjs if a["employee_id"] == r["employee_id"]]
            r["adjustments"] = emp_adjs
            r["int_adjustments_total"] = round(sum(a["amount"] for a in emp_adjs if a["payment_source"] == "INT"), 2)
            r["ext_adjustments_total"] = round(sum(a["amount"] for a in emp_adjs if a["payment_source"] == "EXT"), 2)
            ded = r.get("int_deductions_total", 0.0)
            r["final_int_amount"] = round(r["base_int_amount"] - ded + r["int_adjustments_total"], 2)
            r["final_ext_amount"] = round(r["base_ext_amount"] + r["ext_adjustments_total"], 2)
            r["final_payment_amount"] = round(r["final_int_amount"] + r["final_ext_amount"], 2)

        total_commissions = round(sum(a["amount"] for a in all_adjs if a["type"] == "COMMISSION"), 2)
        total_bonuses = round(sum(a["amount"] for a in all_adjs if a["type"] == "BONUS"), 2)
        total_additions = round(total_commissions + total_bonuses, 2)

        final_int_total = round(sum(r["final_int_amount"] for r in recipients), 2)
        final_ext_total = round(sum(r["final_ext_amount"] for r in recipients), 2)
        total_net = round(final_int_total + final_ext_total, 2)

        preview["total_commissions"] = total_commissions
        preview["total_bonuses"] = total_bonuses
        preview["total_additions"] = total_additions
        preview["final_int_total"] = final_int_total
        preview["final_ext_total"] = final_ext_total
        preview["total_net"] = total_net
        preview["total_payment_amount"] = total_net

        # Re-sync lines
        base_lines = [l for l in preview.get("lines", []) if not l.get("is_adjustment")]
        adj_lines = []
        for a in all_adjs:
            emp_name = next((r["employee_name"] for r in recipients if r["employee_id"] == a["employee_id"]), "Employee")
            emp_dept = next((r["department"] for r in recipients if r["employee_id"] == a["employee_id"]), "General")
            c_type = "bonus" if a["type"] == "BONUS" else "commission_sales"
            adj_lines.append({
                "id": a["id"],
                "payroll_run_id": 0,
                "employee_id": a["employee_id"],
                "employee_name": emp_name,
                "department": emp_dept,
                "compensation_type": c_type,
                "net_pay": a["amount"],
                "amount": a["amount"],
                "currency": a.get("currency", "USD"),
                "bank_name": "Operating Account",
                "bank_account_masked": "••••4821",
                "payment_status": "pending",
                "failure_reason": None,
                "snapshot_notes": a.get("description") or f"{a['type']} ({a['payment_source']})",
                "created_at": a.get("created_at"),
                "paid_at": None,
                "is_adjustment": True,
            })
        preview["lines"] = base_lines + adj_lines
        preview["payment_line_count"] = len(preview["lines"])

        # Recompute variance
        prior_total = preview.get("prior_period_total", 0.0)
        net_delta = round(total_net - prior_total, 2)
        preview["change_amount"] = net_delta
        if preview.get("variance_summary"):
            preview["variance_summary"]["net_delta"] = net_delta
            if prior_total > 0:
                preview["variance_summary"]["pct_change"] = round((net_delta / prior_total) * 100, 1)

        # Update source_version hash
        preview["source_version"] = self._generate_source_version(
            preview["lines"],
            preview.get("external_funding_account_id"),
            preview.get("internal_funding_account_id"),
            preview.get("fx_rate_value"),
        )

    def generate_run_from_compensation_plans(
        self,
        period_label: str,
        period_start: str,
        period_end: str,
        payment_date: Optional[str] = None,
        fx_rate_source: str = "first_of_month",
        fx_rate_value: Optional[float] = None,
        bank_account_id: Optional[int] = None,
        external_funding_account_id: Optional[int] = None,
        internal_funding_account_id: Optional[int] = None,
        user_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generates a draft payroll run with split net payment lines from active employee compensation plans."""
        existing = (
            self.db.query(PayrollRunDB)
            .filter(PayrollRunDB.period_label == period_label)
            .filter(PayrollRunDB.status != "cancelled")
            .first()
        )
        if existing:
            if existing.status != "draft":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot regenerate payroll run for period {period_label}: Run #{existing.id} is in '{existing.status}' status and locked against modification."
                )
            self.db.query(PayrollLineDB).filter(PayrollLineDB.payroll_run_id == existing.id).delete()
            run = existing
        else:
            run = PayrollRunDB(
                period_label=period_label,
                period_start=period_start,
                period_end=period_end,
                payment_date=payment_date or period_end,
                status="draft",
                currency="USD",
                created_by=user_email,
                created_at=datetime.utcnow(),
            )
            self.db.add(run)
            self.db.flush()

        bank_account = None
        if bank_account_id:
            bank_account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == bank_account_id).first()
        if not bank_account:
            bank_account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True).first()
        run.bank_account_id = bank_account.id if bank_account else None
        run.external_funding_account_id = external_funding_account_id or run.bank_account_id
        run.internal_funding_account_id = internal_funding_account_id or run.bank_account_id

        resolved_fx = self._resolve_fx_rate(fx_rate_source, fx_rate_value, period_start, period_end)
        run.fx_rate_source = fx_rate_source or "first_of_month"
        run.fx_rate_value = resolved_fx

        employees = (
            self.db.query(EmployeeDB)
            .filter(EmployeeDB.status.ilike("active"))
            .order_by(EmployeeDB.name.asc())
            .all()
        )

        comp_repo = CompensationPlanRepository(self.db)
        missing_plans = []
        for emp in employees:
            comps = comp_repo.get_components_for_period(emp.id, period_start, period_end)
            if not comps:
                missing_plans.append(emp)

        if missing_plans:
            emp_names = ", ".join(f"'{e.name}' (ID #{e.id})" for e in missing_plans)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot generate payroll run: Active employee(s) without active compensation plan: {emp_names}. Please configure compensation plans before generating run."
            )

        settings = self.get_payroll_settings()
        emp_rate = float(settings.employee_rate)
        org_rate = float(settings.employer_rate)

        tot_net = 0.0
        tot_gross = 0.0
        tot_deductions = 0.0
        tot_employer_cost = 0.0
        tot_emp_tax_egp = 0.0
        tot_si_egp = 0.0
        exceptions = []
        lines_dict_list = []

        for emp in employees:
            comps = comp_repo.get_components_for_period(emp.id, period_start, period_end)
            bank_rec = emp.bank_account
            bank_name = bank_rec.bank_name if bank_rec else None
            iban = bank_rec.iban if bank_rec else None
            masked_acc = f"••••{iban[-4:]}" if iban and len(iban) >= 4 else None

            has_external_route = any(c.component_type == "external_usd" for c in comps)
            if has_external_route and (not bank_rec or not iban):
                exceptions.append({
                    "id": f"exc-bank-{emp.id}",
                    "employee_id": emp.id,
                    "employee_name": emp.name,
                    "severity": "blocking",
                    "code": "MISSING_BANK_DETAILS",
                    "title": "Missing Bank Wire Details",
                    "description": f"{emp.name} is scheduled for external bank payment but does not have verified wire / IBAN details on file.",
                    "correction_path": f"/admin?section=employees&employee_id={emp.id}",
                    "is_resolved": False,
                })

            # Check social insurance configuration
            social_ins = self.social_insurance_repo.get_insurance_for_period(emp.id, period_start, period_end)
            insured_flag = bool(social_ins.insured_flag) if social_ins else False
            insured_base = float(social_ins.insured_base) if (social_ins and social_ins.insured_base is not None) else None
            insured_currency = social_ins.currency if social_ins else None

            # Check internal salary presence & basis
            int_comp = next((c for c in comps if c.component_type != "external_usd"), None)
            internal_salary = float(int_comp.amount or 0.0) if int_comp else float(emp.internal_salary_usd or 0.0)
            salary_basis = getattr(int_comp, "salary_basis", "NET") if int_comp else "NET"

            stat_res, stat_exceptions = validate_and_calculate_internal_statutory(
                employee_id=emp.id,
                employee_name=emp.name,
                internal_usd_amount=internal_salary,
                salary_basis=salary_basis,
                locked_fx_rate=resolved_fx,
                insured_flag=insured_flag,
                insured_base=insured_base,
                insured_currency=insured_currency,
                employee_rate=emp_rate,
                employer_rate=org_rate,
                bonus_usd=0.0,
                commission_usd=0.0,
            )
            if stat_exceptions:
                exceptions.extend(stat_exceptions)

            for comp in comps:
                comp_type = comp.component_type
                amount = round(float(comp.amount or 0.0), 2)
                if comp_type == "external_usd":
                    deduction = 0.0
                    net = amount
                    cost = 0.0
                    is_ins = False
                    base_snap = 0.0
                    emp_r_snap = 0.0
                    org_r_snap = 0.0
                    sal_basis_snap = None
                    conf_int_sal_snap = 0.0
                    ins_base_egp_snap = 0.0
                    fx_rate_snap = resolved_fx
                    base_gross_egp_val = 0.0
                    var_gross_egp_val = 0.0
                    emp_si_egp_val = 0.0
                    org_si_egp_val = 0.0
                    tot_si_egp_val = 0.0
                    emp_tax_egp_val = 0.0
                    emp_si_usd_eq_val = 0.0
                    emp_tax_usd_eq_val = 0.0
                    fin_int_net_egp_val = 0.0
                    fin_int_pay_usd_val = None
                else:
                    deduction = stat_res["deductions_total_usd"]
                    net = stat_res["net_pay_usd"]
                    cost = stat_res["employer_cost_extra_usd"]
                    is_ins = insured_flag
                    base_snap = stat_res["insured_base_egp"]
                    emp_r_snap = stat_res["employee_rate"]
                    org_r_snap = stat_res["employer_rate"]
                    sal_basis_snap = stat_res["salary_basis"]
                    conf_int_sal_snap = stat_res["configured_internal_salary_usd"]
                    ins_base_egp_snap = stat_res["insured_base_egp"]
                    fx_rate_snap = stat_res["fx_rate"]
                    base_gross_egp_val = stat_res["base_gross_egp"]
                    var_gross_egp_val = stat_res["variable_gross_egp"]
                    emp_si_egp_val = stat_res["employee_social_insurance_egp"]
                    org_si_egp_val = stat_res["employer_social_insurance_egp"]
                    tot_si_egp_val = stat_res["total_social_insurance_egp"]
                    emp_tax_egp_val = stat_res["employee_tax_egp"]
                    emp_si_usd_eq_val = stat_res["employee_social_insurance_usd_equivalent"]
                    emp_tax_usd_eq_val = stat_res["employee_tax_usd_equivalent"]
                    fin_int_net_egp_val = stat_res["final_internal_net_egp"]
                    fin_int_pay_usd_val = stat_res["final_internal_payment_usd"]

                    tot_emp_tax_egp += emp_tax_egp_val
                    tot_si_egp += tot_si_egp_val

                tot_gross += amount
                tot_deductions += deduction
                tot_net += net
                tot_employer_cost += cost

                line_db = PayrollLineDB(
                    payroll_run_id=run.id,
                    employee_id=emp.id,
                    employee_name=emp.name,
                    department=emp.dept or "General",
                    compensation_type=comp_type,
                    is_taxable_local=True,
                    is_insurable=is_ins,
                    base_salary=amount,
                    allowances_total=0.0,
                    deductions_total=deduction,
                    tax_amount=0.0,
                    net_pay=net,
                    employer_cost_extra=cost,
                    insured_base_snapshot=base_snap,
                    employee_rate_snapshot=emp_r_snap,
                    employer_rate_snapshot=org_r_snap,
                    salary_basis_snapshot=sal_basis_snap,
                    configured_internal_salary_usd_snapshot=conf_int_sal_snap,
                    insured_base_egp_snapshot=ins_base_egp_snap,
                    fx_rate_snapshot=fx_rate_snap,
                    base_gross_egp=base_gross_egp_val,
                    variable_gross_egp=var_gross_egp_val,
                    employee_social_insurance_egp=emp_si_egp_val,
                    employer_social_insurance_egp=org_si_egp_val,
                    total_social_insurance_egp=tot_si_egp_val,
                    employee_tax_egp=emp_tax_egp_val,
                    employee_social_insurance_usd_equivalent=emp_si_usd_eq_val,
                    employee_tax_usd_equivalent=emp_tax_usd_eq_val,
                    final_internal_net_egp=fin_int_net_egp_val,
                    final_internal_payment_usd=fin_int_pay_usd_val,
                    bank_name=bank_name or "Unassigned",
                    bank_account_masked=masked_acc or "Not Provided",
                    payment_status="pending",
                    snapshot_notes=f"{comp_type.replace('_', ' ').title()} - {period_label}",
                    created_at=datetime.utcnow(),
                )
                self.db.add(line_db)
                lines_dict_list.append({
                    "employee_id": emp.id,
                    "compensation_type": comp_type,
                    "net_pay": net,
                    "bank_account_masked": masked_acc,
                })

        prior_run = (
            self.db.query(PayrollRunDB)
            .filter(PayrollRunDB.id != run.id)
            .filter(PayrollRunDB.status.in_(["approved", "finalized", "paid"]))
            .order_by(desc(PayrollRunDB.id))
            .first()
        )
        prior_total = prior_run.total_net if prior_run else tot_net
        net_delta = round(tot_net - prior_total, 2)
        pct_change = round(((tot_net - prior_total) / prior_total * 100), 1) if prior_run and prior_total > 0 else 0.0

        variance_summary = {
            "prior_period_label": prior_run.period_label if prior_run else None,
            "headcount_delta": len(employees) - (prior_run.headcount if prior_run else len(employees)),
            "net_delta": net_delta,
            "pct_change": pct_change,
            "joiners_count": max(0, len(employees) - (prior_run.headcount if prior_run else len(employees))),
            "leavers_count": max(0, (prior_run.headcount if prior_run else len(employees)) - len(employees)),
            "raises_count": 0,
        }

        source_version = self._generate_source_version(
            lines_dict_list,
            run.external_funding_account_id,
            run.internal_funding_account_id,
            resolved_fx,
        )

        run.total_gross = round(tot_gross, 2)
        run.total_tax = 0.0
        run.total_deductions = round(tot_deductions, 2)
        run.total_net = round(tot_net, 2)
        run.total_employer_cost = round(tot_net + tot_employer_cost, 2)
        run.total_employee_tax_egp = round(tot_emp_tax_egp, 2)
        run.total_social_insurance_egp = round(tot_si_egp, 2)
        run.headcount = len(employees)
        run.payment_date = payment_date or period_end
        run.preview_id = f"PRV-{period_label.replace('-', '')}-{uuid.uuid4().hex[:6].upper()}"
        run.preview_version = 1
        run.source_version = source_version
        run.liabilities_summary_json = "{}"
        run.exceptions_json = json.dumps(exceptions)
        run.variance_summary_json = json.dumps(variance_summary)

        self.db.commit()
        self.db.refresh(run)
        return self._format_run_detail(run)

    def create_run(
        self,
        period_label: str,
        period_start: str,
        period_end: str,
        payment_date: Optional[str] = None,
        bank_account_id: Optional[int] = None,
        external_funding_account_id: Optional[int] = None,
        internal_funding_account_id: Optional[int] = None,
        currency: str = "USD",
        user_email: Optional[str] = None,
        custom_lines: Optional[List[Dict[str, Any]]] = None,
        fx_rate_source: Optional[str] = "first_of_month",
        fx_rate_value: Optional[float] = None,
        preview_id: Optional[str] = None,
        preview_version: Optional[int] = None,
        source_version: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        submit_for_approval: Optional[bool] = False,
    ) -> Dict[str, Any]:
        """Creates a guided payroll run and snapshots all composing employee lines."""
        existing = (
            self.db.query(PayrollRunDB)
            .filter(PayrollRunDB.period_label == period_label)
            .filter(PayrollRunDB.status != "cancelled")
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"An active payroll run already exists for period {period_label} (ID #{existing.id})"
            )

        if preview_id and preview_id in _PREVIEW_CACHE:
            preview = _PREVIEW_CACHE[preview_id]
        else:
            preview = self.preview_run(
                period_label=period_label,
                period_start=period_start,
                period_end=period_end,
                payment_date=payment_date,
                bank_account_id=bank_account_id,
                external_funding_account_id=external_funding_account_id,
                internal_funding_account_id=internal_funding_account_id,
                fx_rate_source=fx_rate_source,
                fx_rate_value=fx_rate_value,
            )

        if source_version and source_version != preview["source_version"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payroll source data has changed since this preview was generated. Please refresh preview."
            )

        if preview_version is not None and preview.get("preview_version") is not None and preview_version != preview["preview_version"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Payroll preview version is stale (expected {preview_version}, current {preview['preview_version']}). Please refresh preview."
            )

        if submit_for_approval and preview["has_blocking_exceptions"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot submit payroll run for approval while blocking readiness issues exist."
            )

        resolved_fx = self._resolve_fx_rate(fx_rate_source, fx_rate_value, period_start, period_end)
        resolved_ext_id = external_funding_account_id or preview.get("external_funding_account_id") or preview["bank_account_id"]
        resolved_int_id = internal_funding_account_id or preview.get("internal_funding_account_id") or preview["bank_account_id"]
        pay_date = payment_date or preview.get("payment_date") or period_end
        run_status = "submitted" if submit_for_approval else "draft"

        run = PayrollRunDB(
            period_label=period_label,
            period_start=period_start,
            period_end=period_end,
            payment_date=pay_date,
            status=run_status,
            total_gross=preview.get("total_gross", preview["total_net"]),
            total_tax=0.0,
            total_deductions=preview.get("total_deductions", 0.0),
            total_net=preview["total_net"],
            total_employer_cost=preview.get("total_employer_cost", preview["total_net"]),
            total_employee_tax_egp=preview.get("total_employee_tax_egp", 0.0),
            total_social_insurance_egp=preview.get("total_social_insurance_egp", 0.0),
            headcount=preview["headcount"],
            currency=currency or "USD",
            bank_account_id=preview["bank_account_id"],
            external_funding_account_id=resolved_ext_id,
            internal_funding_account_id=resolved_int_id,
            fx_rate_source=fx_rate_source or "first_of_month",
            fx_rate_value=resolved_fx,
            preview_id=preview_id or preview["preview_id"],
            preview_version=preview_version or preview["preview_version"],
            source_version=preview["source_version"],
            created_by=user_email,
            created_at=datetime.utcnow(),
            submitted_by=user_email if submit_for_approval else None,
            submitted_at=datetime.utcnow() if submit_for_approval else None,
            exceptions_json=json.dumps(preview["exceptions"]),
            variance_summary_json=json.dumps(preview["variance_summary"]),
        )
        self.db.add(run)
        self.db.flush()

        lines_to_add = custom_lines if custom_lines is not None else preview["lines"]
        for pl in lines_to_add:
            c_type = pl.get("compensation_type", "internal_usd_cash")
            base_sal = float(pl.get("base_salary", pl.get("amount", pl.get("net_pay", 0.0))))
            ded = float(pl.get("deductions_total", 0.0))
            net = float(pl.get("net_pay", base_sal - ded))
            emp_extra = float(pl.get("employer_cost_extra", 0.0))
            is_ins = bool(pl.get("is_insurable", True))
            ins_base = float(pl.get("insured_base_snapshot", 0.0))
            emp_rate_snap = float(pl.get("employee_rate_snapshot", 0.0))
            org_rate_snap = float(pl.get("employer_rate_snapshot", 0.0))

            line_db = PayrollLineDB(
                payroll_run_id=run.id,
                employee_id=pl["employee_id"],
                employee_name=pl.get("employee_name"),
                department=pl.get("department"),
                compensation_type=c_type,
                is_taxable_local=True,
                is_insurable=is_ins,
                base_salary=base_sal,
                allowances_total=0.0,
                deductions_total=ded,
                tax_amount=0.0,
                net_pay=net,
                employer_cost_extra=emp_extra,
                insured_base_snapshot=ins_base,
                employee_rate_snapshot=emp_rate_snap,
                employer_rate_snapshot=org_rate_snap,
                salary_basis_snapshot=pl.get("salary_basis_snapshot"),
                configured_internal_salary_usd_snapshot=pl.get("configured_internal_salary_usd_snapshot"),
                insured_base_egp_snapshot=pl.get("insured_base_egp_snapshot"),
                fx_rate_snapshot=pl.get("fx_rate_snapshot", resolved_fx),
                base_gross_egp=pl.get("base_gross_egp"),
                variable_gross_egp=pl.get("variable_gross_egp"),
                employee_social_insurance_egp=pl.get("employee_social_insurance_egp"),
                employer_social_insurance_egp=pl.get("employer_social_insurance_egp"),
                total_social_insurance_egp=pl.get("total_social_insurance_egp"),
                employee_tax_egp=pl.get("employee_tax_egp"),
                employee_social_insurance_usd_equivalent=pl.get("employee_social_insurance_usd_equivalent"),
                employee_tax_usd_equivalent=pl.get("employee_tax_usd_equivalent"),
                final_internal_net_egp=pl.get("final_internal_net_egp"),
                final_internal_payment_usd=pl.get("final_internal_payment_usd"),
                bank_name=pl.get("bank_name", "Unassigned"),
                bank_account_masked=pl.get("bank_account_masked", "Not Provided"),
                payment_status="pending",
                snapshot_notes=pl.get("snapshot_notes", ""),
                created_at=datetime.utcnow(),
            )
            self.db.add(line_db)

        for a in preview.get("adjustments", []):
            adj_db = PayrollAdjustmentDB(
                id=a["id"],
                employee_id=a["employee_id"],
                preview_id=preview.get("preview_id"),
                payroll_run_id=run.id,
                type=a["type"],
                direction=a.get("direction", "ADDITION"),
                amount=a["amount"],
                currency=a.get("currency", "USD"),
                payment_source=a.get("payment_source", "INT"),
                effective_period=run.period_label,
                description=a.get("description"),
                external_reference=a.get("external_reference"),
                origin=a.get("origin", "MANUAL"),
                status="SUBMITTED" if submit_for_approval else "DRAFT",
                created_by=a.get("created_by") or user_email,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            self.db.add(adj_db)

        self.db.flush()
        self._recalculate_run_aggregates(run)
        self.db.commit()
        self.db.refresh(run)
        self._log_audit(
            action="payroll.run.submitted" if submit_for_approval else "payroll.run.created",
            target_type="payroll_run",
            target_id=str(run.id),
            actor_email=user_email,
            details={"period_label": run.period_label, "total_net": run.total_net, "preview_version": run.preview_version, "status": run.status},
        )
        return self._format_run_detail(run)

    def _recalculate_run_aggregates(self, run: PayrollRunDB) -> None:
        """Recalculates net payment totals and headcount for a payroll run from its lines."""
        lines = self.db.query(PayrollLineDB).filter(PayrollLineDB.payroll_run_id == run.id).all()
        tot_net = round(sum(float(l.net_pay or 0.0) for l in lines), 2)
        tot_gross = round(sum(float(l.base_salary or 0.0) for l in lines), 2)
        tot_deductions = round(sum(float(l.deductions_total or 0.0) for l in lines), 2)
        tot_employer_extra = round(sum(float(l.employer_cost_extra or 0.0) for l in lines), 2)
        tot_emp_tax_egp = round(sum(float(l.employee_tax_egp or 0.0) for l in lines), 2)
        tot_si_egp = round(sum(float(l.total_social_insurance_egp or 0.0) for l in lines), 2)
        distinct_headcount = len(set(l.employee_id for l in lines))

        run.total_gross = tot_gross
        run.total_tax = 0.0
        run.total_deductions = tot_deductions
        run.total_net = tot_net
        run.total_employer_cost = round(tot_net + tot_employer_extra, 2)
        run.total_employee_tax_egp = tot_emp_tax_egp
        run.total_social_insurance_egp = tot_si_egp
        run.headcount = distinct_headcount
        run.liabilities_summary_json = "{}"

        prior_run = (
            self.db.query(PayrollRunDB)
            .filter(PayrollRunDB.id != run.id)
            .filter(PayrollRunDB.status.in_(["approved", "finalized", "paid"]))
            .order_by(desc(PayrollRunDB.id))
            .first()
        )
        if prior_run:
            try:
                var = json.loads(run.variance_summary_json or "{}")
            except Exception:
                var = {}
            prior_net = prior_run.total_net or 0.0
            var["prior_period_label"] = prior_run.period_label
            var["headcount_delta"] = distinct_headcount - (prior_run.headcount or 0)
            var["net_delta"] = round(tot_net - prior_net, 2)
            var["pct_change"] = (
                round(((tot_net - prior_net) / prior_net * 100), 1)
                if prior_net > 0
                else 0.0
            )
            run.variance_summary_json = json.dumps(var)

    def add_ad_hoc_line(
        self,
        run_id: int,
        employee_id: int,
        compensation_type: str,
        amount: float,
        notes: Optional[str] = None,
        is_taxable_local: Optional[bool] = None,
        is_insurable: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Adds an ad-hoc commission or bonus line to an existing draft payroll run."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        if run.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot add lines to payroll run #{run_id}: Run is in '{run.status}' status and locked against modification.",
            )

        valid_types = {"external_usd", "internal_usd_cash", "commission_sales", "commission_support", "bonus"}
        if compensation_type not in valid_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid compensation_type '{compensation_type}'. Must be one of: {', '.join(sorted(valid_types))}",
            )

        if amount is None or float(amount) <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Line amount must be greater than 0.",
            )
        net = round(float(amount), 2)

        emp = self.db.query(EmployeeDB).filter(EmployeeDB.id == employee_id).first()
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee #{employee_id} not found.",
            )

        bank_rec = emp.bank_account
        bank_name = bank_rec.bank_name if bank_rec else None
        iban = bank_rec.iban if bank_rec else None
        masked_acc = f"••••{iban[-4:]}" if iban and len(iban) >= 4 else None

        line_notes = notes or f"{compensation_type.replace('_', ' ').title()} - {run.period_label}"

        line_db = PayrollLineDB(
            payroll_run_id=run.id,
            employee_id=emp.id,
            employee_name=emp.name,
            department=emp.dept or "General",
            compensation_type=compensation_type,
            is_taxable_local=True,
            is_insurable=True,
            base_salary=net,
            allowances_total=0.0,
            deductions_total=0.0,
            tax_amount=0.0,
            net_pay=net,
            employer_cost_extra=0.0,
            bank_name=bank_name or "Unassigned",
            bank_account_masked=masked_acc or "Not Provided",
            payment_status="pending",
            snapshot_notes=line_notes,
            created_at=datetime.utcnow(),
        )
        self.db.add(line_db)
        self.db.flush()

        self._recalculate_run_aggregates(run)
        self.db.commit()
        self.db.refresh(line_db)

        return self._format_line_dict(line_db)

    def delete_line(self, run_id: int, line_id: int) -> Dict[str, Any]:
        """Removes a line from a draft payroll run."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        if run.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete lines from payroll run #{run_id}: Run is in '{run.status}' status and locked against modification.",
            )

        line = (
            self.db.query(PayrollLineDB)
            .filter(PayrollLineDB.id == line_id, PayrollLineDB.payroll_run_id == run_id)
            .first()
        )
        if not line:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payroll line #{line_id} not found in run #{run_id}.",
            )

        self.db.delete(line)
        self.db.flush()

        self._recalculate_run_aggregates(run)
        self.db.commit()

        return {"success": True, "message": f"Payroll line #{line_id} removed successfully"}

    def submit_run(self, run_id: int, user_email: Optional[str] = None) -> Dict[str, Any]:
        """Submits a draft payroll run for maker-checker approval."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        if run.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll run #{run_id} is in status '{run.status}', only 'draft' runs can be submitted for approval."
            )

        exceptions = json.loads(run.exceptions_json or "[]")
        blocking = [e for e in exceptions if e.get("severity") == "blocking" and not e.get("is_resolved")]
        if blocking:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot submit payroll run #{run_id}: {len(blocking)} blocking issue(s) remain unresolved."
            )

        run.status = "submitted"
        run.submitted_at = datetime.utcnow()
        run.submitted_by = user_email or "preparer@hrflow.test"
        self.db.commit()
        self.db.refresh(run)
        self._log_audit(
            action="payroll.run.submitted",
            target_type="payroll_run",
            target_id=str(run.id),
            actor_email=user_email,
            details={"period_label": run.period_label, "total_net": run.total_net, "submitted_by": run.submitted_by},
        )
        return self._format_run_detail(run)

    def approve_run(self, run_id: int, user_email: Optional[str] = None, allow_self_approval: bool = False) -> Dict[str, Any]:
        """Maker-checker approval for payroll run. Enforces blocking exception verification and self-approval rejection."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        if run.status not in ["draft", "submitted"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll run #{run_id} is in status '{run.status}', only 'draft' or 'submitted' runs can be approved."
            )

        # Enforce no blocking exceptions
        exceptions = json.loads(run.exceptions_json or "[]")
        blocking = [e for e in exceptions if e.get("severity") == "blocking" and not e.get("is_resolved")]
        if blocking:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve payroll run #{run_id}: {len(blocking)} blocking exception(s) remain unresolved (e.g. {blocking[0].get('title')})."
            )

        # Maker-checker validation: Submitter cannot self-approve
        if not allow_self_approval and user_email:
            submitter = (run.submitted_by or "").strip().lower()
            current = user_email.strip().lower()
            if submitter and current == submitter:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Maker-checker violation: Run cannot be approved by the user who submitted it.",
                )

        run.status = "approved"
        run.approved_at = datetime.utcnow()
        run.approved_by = user_email or "admin@hrflow.test"
        for adj in (run.adjustments or []):
            adj.status = "APPROVED"
            adj.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(run)
        self._log_audit(
            action="payroll.run.approved",
            target_type="payroll_run",
            target_id=str(run.id),
            actor_email=user_email,
            details={"period_label": run.period_label, "total_net": run.total_net, "approved_by": run.approved_by},
        )
        return self._format_run_detail(run)

    def finalize_run(self, run_id: int, user_email: Optional[str] = None) -> Dict[str, Any]:
        """Locks the payroll run against edits and enables funding/disbursement."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        if run.status != "approved":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll run #{run_id} must be approved before finalization. Current status: '{run.status}'."
            )

        run.status = "finalized"
        run.finalized_at = datetime.utcnow()
        run.finalized_by = user_email or "admin@hrflow.test"

        # NOTE: Under net-payment runner, finalization does NOT create statutory obligations or liability entries.
        self.db.commit()
        self.db.refresh(run)
        self._log_audit(
            action="payroll.run.finalized",
            target_type="payroll_run",
            target_id=str(run.id),
            actor_email=user_email,
            details={"period_label": run.period_label, "total_net": run.total_net, "finalized_by": run.finalized_by},
        )
        return self._format_run_detail(run)

    def export_run_csv(self, run_id: int) -> str:
        """Exports payroll run recipient payments and adjustments as a net payment CSV."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Employee ID",
            "Employee Name",
            "Department",
            "Base INT",
            "Base EXT",
            "Commissions",
            "Bonuses",
            "Other Additions",
            "Final INT",
            "Final EXT",
            "Final Payment",
            "Payment Status",
            "Payment Reference",
            "Salary Basis",
            "Insured Base EGP",
            "Employee SI EGP",
            "Employer SI EGP",
            "Total SI EGP",
            "Employee Tax EGP",
            "Employee SI USD Eq",
            "Employee Tax USD Eq",
            "FX Rate",
        ])

        emp_ids = sorted(list(set([l.employee_id for l in run.lines] + [a.employee_id for a in (run.adjustments or [])])))
        for eid in emp_ids:
            emp_lines = [l for l in run.lines if l.employee_id == eid]
            emp_adjs = [a for a in (run.adjustments or []) if a.employee_id == eid]
            name = emp_lines[0].employee_name if emp_lines else f"Emp #{eid}"
            dept = emp_lines[0].department if emp_lines else "General"

            base_int = sum(l.net_pay for l in emp_lines if l.compensation_type != "external_usd" and not getattr(l, "is_adjustment", False))
            base_ext = sum(l.net_pay for l in emp_lines if l.compensation_type == "external_usd" and not getattr(l, "is_adjustment", False))

            comm_int = sum(a.amount for a in emp_adjs if a.type == "COMMISSION" and a.payment_source == "INT")
            comm_ext = sum(a.amount for a in emp_adjs if a.type == "COMMISSION" and a.payment_source == "EXT")
            bon_int = sum(a.amount for a in emp_adjs if a.type == "BONUS" and a.payment_source == "INT")
            bon_ext = sum(a.amount for a in emp_adjs if a.type == "BONUS" and a.payment_source == "EXT")
            other_additions = sum(a.amount for a in emp_adjs if a.type not in ["COMMISSION", "BONUS"])

            final_int = round(base_int + comm_int + bon_int, 2)
            final_ext = round(base_ext + comm_ext + bon_ext, 2)
            final_payment = round(final_int + final_ext + other_additions, 2)

            st = emp_lines[0].payment_status if emp_lines else "pending"
            ref = emp_lines[0].linked_payment_id if emp_lines else ""

            int_line = next((l for l in emp_lines if l.compensation_type != "external_usd" and not getattr(l, "is_adjustment", False)), None)
            sal_basis = int_line.salary_basis_snapshot if (int_line and int_line.salary_basis_snapshot) else ("NET" if int_line else "")
            ins_base_egp = f"{(int_line.insured_base_egp_snapshot or 0.0):.2f}" if (int_line and int_line.insured_base_egp_snapshot) else "0.00"
            emp_si_egp = f"{(int_line.employee_social_insurance_egp or 0.0):.2f}" if (int_line and int_line.employee_social_insurance_egp) else "0.00"
            org_si_egp = f"{(int_line.employer_social_insurance_egp or 0.0):.2f}" if (int_line and int_line.employer_social_insurance_egp) else "0.00"
            tot_si_egp = f"{(int_line.total_social_insurance_egp or 0.0):.2f}" if (int_line and int_line.total_social_insurance_egp) else "0.00"
            emp_tax_egp = f"{(int_line.employee_tax_egp or 0.0):.2f}" if (int_line and int_line.employee_tax_egp) else "0.00"
            emp_si_usd = f"{(int_line.employee_social_insurance_usd_equivalent or 0.0):.2f}" if (int_line and int_line.employee_social_insurance_usd_equivalent) else "0.00"
            emp_tax_usd = f"{(int_line.employee_tax_usd_equivalent or 0.0):.2f}" if (int_line and int_line.employee_tax_usd_equivalent) else "0.00"
            fx_rate = f"{(int_line.fx_rate_snapshot or run.fx_rate_value or 0.0):.4f}" if int_line else f"{(run.fx_rate_value or 0.0):.4f}"

            writer.writerow([
                eid,
                name,
                dept,
                f"{base_int:.2f}",
                f"{base_ext:.2f}",
                f"{(comm_int + comm_ext):.2f}",
                f"{(bon_int + bon_ext):.2f}",
                f"{other_additions:.2f}",
                f"{final_int:.2f}",
                f"{final_ext:.2f}",
                f"{final_payment:.2f}",
                st,
                ref or "",
                sal_basis,
                ins_base_egp,
                emp_si_egp,
                org_si_egp,
                tot_si_egp,
                emp_tax_egp,
                emp_si_usd,
                emp_tax_usd,
                fx_rate,
            ])

        return output.getvalue()

    def execute_payment(
        self,
        run_id: int,
        user_email: Optional[str] = None,
        bank_account_id: Optional[int] = None,
        retry_failed_only: bool = False,
        simulate_partial_failure_ids: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """
        Executes net salary funding and disbursements.
        Supports partial failure recovery without rerunning already-successful lines.
        """
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        if run.status not in ["finalized", "partially_paid"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only finalized or partially paid payroll runs can be funded. Current status: '{run.status}'."
            )

        lines = self.db.query(PayrollLineDB).filter(PayrollLineDB.payroll_run_id == run_id).all()
        now = datetime.utcnow()

        for line in lines:
            if retry_failed_only:
                if line.payment_status != "failed":
                    continue
            else:
                if line.payment_status == "paid":
                    continue

            # Check simulated failure
            if simulate_partial_failure_ids and (line.id in simulate_partial_failure_ids or line.employee_id in simulate_partial_failure_ids):
                line.payment_status = "failed"
                line.failure_reason = "Payment Gateway Reject: Account Routing Failure"
            else:
                line.payment_status = "paid"
                line.paid_at = now
                line.failure_reason = None

        self.db.flush()

        # Check aggregate state
        remaining_failed = any(l.payment_status == "failed" for l in lines)
        remaining_pending = any(l.payment_status == "pending" for l in lines)

        if remaining_failed:
            run.status = "partially_paid"
            run.paid_by = user_email or "payroll@hrflow.test"
        elif not remaining_pending:
            run.status = "paid"
            run.paid_at = now
            run.paid_by = user_email or "payroll@hrflow.test"

        if bank_account_id:
            run.bank_account_id = bank_account_id

        self.db.commit()
        self.db.refresh(run)
        return self._format_run_detail(run)

    def post_journal(self, run_id: int, user_email: Optional[str] = None) -> Dict[str, Any]:
        """
        Generates and links balanced General Ledger transactions for actual net payroll disbursements.
        Never generates deduction, tax, employer-cost, or liability journal lines.
        """
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        if run.status not in ["finalized", "paid", "partially_paid"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll run #{run_id} must be finalized or paid before journal posting."
            )

        if run.journal_transaction_id:
            tx = self.db.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == run.journal_transaction_id).first()
            if tx:
                return {
                    "success": True,
                    "journal_transaction_id": tx.id,
                    "reference": tx.reference,
                    "amount": tx.amount,
                    "date": tx.date,
                    "is_already_posted": True,
                }

        cat = (
            self.db.query(TransactionCategoryDB)
            .filter(TransactionCategoryDB.name.ilike("%salaries%"))
            .first()
        )
        cat_id = cat.id if cat else 2

        pt = (
            self.db.query(PaymentTypeDB)
            .filter(PaymentTypeDB.code.in_(["OUTBOUND_TRANS", "INTERNAL_TRANS"]))
            .first()
        )
        pt_id = pt.id if pt else 5

        lines = self.db.query(PayrollLineDB).filter(PayrollLineDB.payroll_run_id == run.id).all()
        ext_net = round(sum(float(l.net_pay or 0.0) for l in lines if l.compensation_type == "external_usd"), 2)
        int_net = round(sum(float(l.net_pay or 0.0) for l in lines if l.compensation_type != "external_usd"), 2)

        date_str = run.paid_at.strftime("%Y-%m-%d") if run.paid_at else datetime.utcnow().strftime("%Y-%m-%d")
        ext_account_id = run.external_funding_account_id or run.bank_account_id or 1
        int_account_id = run.internal_funding_account_id or run.bank_account_id or 1

        created_txs = []

        if ext_net > 0:
            tx_ext = LedgerTransactionDB(
                account_id=ext_account_id,
                date=date_str,
                amount=ext_net,
                direction="out",
                currency=run.currency or "USD",
                category_id=cat_id,
                payment_type_id=pt_id,
                reference=f"PAYROLL-{run.period_label}-EXT",
                description=f"Payroll Net Disbursement (External Bank Wire) for {run.period_label} (Net: ${ext_net:,.2f})",
                entry_type="money_out",
                counterparty=f"Voyance Staff Payroll - External USD ({run.headcount} employees)",
                source="manual",
                created_at=datetime.utcnow(),
                created_by=user_email or "system",
            )
            self.db.add(tx_ext)
            created_txs.append(tx_ext)

        if int_net > 0:
            tx_int = LedgerTransactionDB(
                account_id=int_account_id,
                date=date_str,
                amount=int_net,
                direction="out",
                currency=run.currency or "USD",
                category_id=cat_id,
                payment_type_id=pt_id,
                reference=f"PAYROLL-{run.period_label}-INT",
                description=f"Payroll Net Disbursement (Internal Cash/Commissions) for {run.period_label} (Net: ${int_net:,.2f})",
                entry_type="money_out",
                counterparty=f"Voyance Staff Payroll - Internal Cash ({run.headcount} employees)",
                source="manual",
                created_at=datetime.utcnow(),
                created_by=user_email or "system",
            )
            self.db.add(tx_int)
            created_txs.append(tx_int)

        if not created_txs:
            tx_fallback = LedgerTransactionDB(
                account_id=run.bank_account_id or 1,
                date=date_str,
                amount=run.total_net,
                direction="out",
                currency=run.currency or "USD",
                category_id=cat_id,
                payment_type_id=pt_id,
                reference=f"PAYROLL-{run.period_label}",
                description=f"Payroll Net Disbursement for {run.period_label} (Net: ${run.total_net:,.2f})",
                entry_type="money_out",
                counterparty=f"Voyance Staff Payroll ({run.headcount} employees)",
                source="manual",
                created_at=datetime.utcnow(),
                created_by=user_email or "system",
            )
            self.db.add(tx_fallback)
            created_txs.append(tx_fallback)

        self.db.flush()

        primary_tx = created_txs[0]
        run.journal_transaction_id = primary_tx.id
        self.db.commit()

        return {
            "success": True,
            "journal_transaction_id": primary_tx.id,
            "reference": primary_tx.reference,
            "amount": sum(tx.amount for tx in created_txs),
            "date": primary_tx.date,
            "is_already_posted": False,
        }

    def get_my_payslips(self, user_email: str) -> List[Dict[str, Any]]:
        """Returns personal payment details / receipts for the authenticated employee."""
        emp = self.db.query(EmployeeDB).filter(EmployeeDB.email.ilike(user_email)).first()
        if not emp:
            return []

        lines = (
            self.db.query(PayrollLineDB)
            .join(PayrollRunDB)
            .filter(PayrollLineDB.employee_id == emp.id)
            .filter(PayrollRunDB.status.in_(["finalized", "paid"]))
            .order_by(desc(PayrollRunDB.id))
            .all()
        )

        return [
            {
                "id": l.id,
                "payroll_run_id": l.payroll_run_id,
                "period_label": l.payroll_run.period_label,
                "period_start": l.payroll_run.period_start,
                "period_end": l.payroll_run.period_end,
                "employee_id": emp.id,
                "employee_name": emp.name,
                "department": emp.dept or "General",
                "net_pay": l.net_pay,
                "amount": l.net_pay,
                "currency": l.payroll_run.currency or "USD",
                "status": l.payment_status or "paid",
                "paid_date": l.paid_at.strftime("%Y-%m-%d") if l.paid_at else l.payroll_run.period_end,
                "bank_name": l.bank_name,
                "bank_account_masked": l.bank_account_masked,
                "compensation_type": l.compensation_type,
            }
            for l in lines
        ]

    def get_employee_payslip(self, run_id: int, employee_id: int) -> Dict[str, Any]:
        """Itemized payment receipt for a specific employee on a run."""
        line = (
            self.db.query(PayrollLineDB)
            .filter(PayrollLineDB.payroll_run_id == run_id)
            .filter(PayrollLineDB.employee_id == employee_id)
            .first()
        )
        if not line:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment record not found")

        emp = line.employee
        return {
            "id": line.id,
            "payroll_run_id": run_id,
            "period_label": line.payroll_run.period_label,
            "period_start": line.payroll_run.period_start,
            "period_end": line.payroll_run.period_end,
            "employee_id": emp.id if emp else employee_id,
            "employee_name": line.employee_name or (emp.name if emp else "Employee"),
            "department": line.department or (emp.dept if emp else "General"),
            "base_salary": line.base_salary or line.net_pay,
            "deductions_total": line.deductions_total or 0.0,
            "employer_cost_extra": line.employer_cost_extra or 0.0,
            "deductions_label": "Social Insurance (Internal Estimate)" if (line.deductions_total and line.deductions_total > 0) else None,
            "net_pay": line.net_pay,
            "amount": line.net_pay,
            "currency": line.payroll_run.currency or "USD",
            "status": line.payment_status,
            "paid_date": line.paid_at.strftime("%Y-%m-%d") if line.paid_at else None,
            "bank_name": line.bank_name,
            "bank_account_masked": line.bank_account_masked,
            "compensation_type": line.compensation_type,
            "salary_basis_snapshot": line.salary_basis_snapshot,
            "configured_internal_salary_usd_snapshot": line.configured_internal_salary_usd_snapshot,
            "insured_base_egp_snapshot": line.insured_base_egp_snapshot,
            "fx_rate_snapshot": line.fx_rate_snapshot or line.payroll_run.fx_rate_value,
            "base_gross_egp": line.base_gross_egp,
            "variable_gross_egp": line.variable_gross_egp,
            "employee_social_insurance_egp": line.employee_social_insurance_egp,
            "employer_social_insurance_egp": line.employer_social_insurance_egp,
            "total_social_insurance_egp": line.total_social_insurance_egp,
            "employee_tax_egp": line.employee_tax_egp,
            "employee_social_insurance_usd_equivalent": line.employee_social_insurance_usd_equivalent,
            "employee_tax_usd_equivalent": line.employee_tax_usd_equivalent,
            "final_internal_net_egp": line.final_internal_net_egp,
            "final_internal_payment_usd": line.final_internal_payment_usd,
        }

    # -------------------------------------------------------------------------
    # Internal Formatting Helpers (Canonical Net-Payment Only)
    # -------------------------------------------------------------------------
    def _format_run_summary(self, run: PayrollRunDB) -> Dict[str, Any]:
        exceptions = json.loads(run.exceptions_json or "[]")
        has_blocking = any(e.get("severity") == "blocking" and not e.get("is_resolved") for e in exceptions)
        bank_name = run.bank_account.account_name if run.bank_account else "Operating Account"
        ext_bank_name = run.external_funding_account.account_name if run.external_funding_account else bank_name
        int_bank_name = run.internal_funding_account.account_name if run.internal_funding_account else bank_name

        return {
            "id": run.id,
            "period_label": run.period_label,
            "period_start": run.period_start,
            "period_end": run.period_end,
            "payment_date": run.payment_date or run.period_end,
            "status": run.status,
            "fx_rate_source": run.fx_rate_source or "first_of_month",
            "fx_rate_value": run.fx_rate_value,
            "total_gross": run.total_gross if run.total_gross is not None else run.total_net,
            "total_deductions": run.total_deductions or 0.0,
            "total_net": run.total_net,
            "total_employer_cost": run.total_employer_cost if run.total_employer_cost is not None else run.total_net,
            "total_employee_tax_egp": run.total_employee_tax_egp or 0.0,
            "total_social_insurance_egp": run.total_social_insurance_egp or 0.0,
            "total_payment_amount": run.total_net,
            "headcount": run.headcount,
            "recipient_count": run.headcount,
            "currency": run.currency or "USD",
            "bank_account_id": run.bank_account_id,
            "bank_account_name": bank_name,
            "external_funding_account_id": run.external_funding_account_id,
            "external_funding_account_name": ext_bank_name,
            "internal_funding_account_id": run.internal_funding_account_id,
            "internal_funding_account_name": int_bank_name,
            "preview_id": run.preview_id,
            "preview_version": run.preview_version,
            "source_version": run.source_version,
            "created_at": run.created_at,
            "created_by": run.created_by,
            "submitted_at": run.submitted_at,
            "submitted_by": run.submitted_by,
            "approved_at": run.approved_at,
            "approved_by": run.approved_by,
            "finalized_at": run.finalized_at,
            "finalized_by": run.finalized_by,
            "paid_at": run.paid_at,
            "paid_by": run.paid_by,
            "journal_transaction_id": run.journal_transaction_id,
            "has_blocking_exceptions": has_blocking,
        }

    def _format_line_dict(self, l: PayrollLineDB) -> Dict[str, Any]:
        return {
            "id": l.id,
            "payroll_run_id": l.payroll_run_id,
            "employee_id": l.employee_id,
            "employee_name": l.employee_name,
            "department": l.department,
            "compensation_type": l.compensation_type or "internal_usd_cash",
            "base_salary": l.base_salary if l.base_salary is not None else (l.net_pay or 0.0),
            "deductions_total": l.deductions_total or 0.0,
            "employer_cost_extra": l.employer_cost_extra or 0.0,
            "is_insurable": bool(l.is_insurable),
            "insured_base_snapshot": l.insured_base_snapshot or 0.0,
            "employee_rate_snapshot": l.employee_rate_snapshot or 0.0,
            "employer_rate_snapshot": l.employer_rate_snapshot or 0.0,
            "salary_basis_snapshot": l.salary_basis_snapshot,
            "configured_internal_salary_usd_snapshot": l.configured_internal_salary_usd_snapshot,
            "insured_base_egp_snapshot": l.insured_base_egp_snapshot,
            "fx_rate_snapshot": l.fx_rate_snapshot,
            "base_gross_egp": l.base_gross_egp,
            "variable_gross_egp": l.variable_gross_egp,
            "employee_social_insurance_egp": l.employee_social_insurance_egp,
            "employer_social_insurance_egp": l.employer_social_insurance_egp,
            "total_social_insurance_egp": l.total_social_insurance_egp,
            "employee_tax_egp": l.employee_tax_egp,
            "employee_social_insurance_usd_equivalent": l.employee_social_insurance_usd_equivalent,
            "employee_tax_usd_equivalent": l.employee_tax_usd_equivalent,
            "final_internal_net_egp": l.final_internal_net_egp,
            "final_internal_payment_usd": l.final_internal_payment_usd,
            "net_pay": l.net_pay or 0.0,
            "amount": l.net_pay or 0.0,
            "currency": l.payroll_run.currency if l.payroll_run else "USD",
            "bank_name": l.bank_name,
            "bank_account_masked": l.bank_account_masked,
            "payment_status": l.payment_status or "pending",
            "failure_reason": l.failure_reason,
            "snapshot_notes": l.snapshot_notes,
            "created_at": l.created_at,
            "paid_at": l.paid_at,
            "linked_payment_id": l.linked_payment_id,
        }

    def _format_run_detail(self, run: PayrollRunDB) -> Dict[str, Any]:
        summary = self._format_run_summary(run)
        summary["exceptions"] = json.loads(run.exceptions_json or "[]")
        try:
            var = json.loads(run.variance_summary_json or "{}")
        except Exception:
            var = {}
        summary["variance_summary"] = var
        summary["lines"] = [self._format_line_dict(l) for l in run.lines]
        summary["payment_line_count"] = len(run.lines)

        adjs = [
            {
                "id": a.id,
                "employee_id": a.employee_id,
                "preview_id": a.preview_id,
                "payroll_run_id": a.payroll_run_id,
                "type": a.type,
                "direction": a.direction,
                "amount": a.amount,
                "currency": a.currency,
                "payment_source": a.payment_source,
                "effective_period": a.effective_period,
                "description": a.description,
                "external_reference": a.external_reference,
                "origin": a.origin,
                "status": a.status,
                "created_by": a.created_by,
                "created_at": a.created_at,
                "updated_at": a.updated_at,
            }
            for a in (run.adjustments or [])
        ]
        total_comm = round(sum(a["amount"] for a in adjs if a["type"] == "COMMISSION"), 2)
        total_bon = round(sum(a["amount"] for a in adjs if a["type"] == "BONUS"), 2)
        summary["adjustments"] = adjs
        summary["total_commissions"] = total_comm
        summary["total_bonuses"] = total_bon
        summary["total_additions"] = round(total_comm + total_bon, 2)
        return summary
