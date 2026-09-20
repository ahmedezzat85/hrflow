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
from fastapi import HTTPException, status

from models_db import EmployeeDB, EmployeeBankAccountDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    StatutoryObligationDB,
    AccountTransferDB,
)
from finance.repositories.compensation_plan_repository import CompensationPlanRepository


class PayrollService:
    def __init__(self, db: Session):
        self.db = db

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

        lines: List[Dict[str, Any]] = []
        exceptions: List[Dict[str, Any]] = []
        has_blocking = False
        tot_net = 0.0

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
            if not bank_rec or not iban:
                if has_external_route:
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
                else:
                    exceptions.append({
                        "id": f"warn-bank-{emp.id}",
                        "employee_id": emp.id,
                        "employee_name": emp.name,
                        "severity": "warning",
                        "code": "MISSING_BANK_DETAILS_OPTIONAL",
                        "title": "Missing Bank Wire Details",
                        "description": f"{emp.name} does not have bank details on file. Non-blocking for cash/internal route.",
                        "correction_path": f"/admin?section=employees&employee_id={emp.id}",
                        "is_resolved": False,
                    })

            for comp in comps:
                comp_type = comp.component_type
                amount = round(float(comp.amount or 0.0), 2)
                net = amount
                tot_net += net

                lines.append({
                    "id": emp.id,
                    "payroll_run_id": 0,
                    "employee_id": emp.id,
                    "employee_name": emp.name,
                    "department": emp.dept or "General",
                    "compensation_type": comp_type,
                    "net_pay": net,
                    "amount": net,
                    "currency": "USD",
                    "bank_name": bank_name or "Unassigned",
                    "bank_account_masked": masked_acc or "Not Provided",
                    "payment_status": "pending",
                    "failure_reason": None,
                    "snapshot_notes": f"{comp_type.replace('_', ' ').title()} - {period_label}",
                    "created_at": datetime.utcnow().isoformat(),
                    "paid_at": None,
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

        return {
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
            "total_net": round(tot_net, 2),
            "total_payment_amount": round(tot_net, 2),
            "prior_period_total": round(prior_total, 2),
            "change_amount": net_delta,
            "has_blocking_exceptions": has_blocking,
            "exceptions": exceptions,
            "variance_summary": variance_summary,
            "lines": lines,
        }

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

        tot_net = 0.0
        exceptions = []
        lines_dict_list = []

        for emp in employees:
            comps = comp_repo.get_components_for_period(emp.id, period_start, period_end)
            bank_rec = emp.bank_account
            bank_name = bank_rec.bank_name if bank_rec else None
            iban = bank_rec.iban if bank_rec else None
            masked_acc = f"••••{iban[-4:]}" if iban and len(iban) >= 4 else None

            if not bank_rec or not iban:
                if has_external_route:
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
                else:
                    exceptions.append({
                        "id": f"warn-bank-{emp.id}",
                        "employee_id": emp.id,
                        "employee_name": emp.name,
                        "severity": "warning",
                        "code": "MISSING_BANK_DETAILS_OPTIONAL",
                        "title": "Missing Bank Wire Details",
                        "description": f"{emp.name} does not have bank details on file. Non-blocking for cash/internal route.",
                        "correction_path": f"/admin?section=employees&employee_id={emp.id}",
                        "is_resolved": False,
                    })

            for comp in comps:
                comp_type = comp.component_type
                amount = round(float(comp.amount or 0.0), 2)
                net = amount
                tot_net += net

                line_db = PayrollLineDB(
                    payroll_run_id=run.id,
                    employee_id=emp.id,
                    employee_name=emp.name,
                    department=emp.dept or "General",
                    compensation_type=comp_type,
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

        run.total_gross = round(tot_net, 2)
        run.total_tax = 0.0
        run.total_deductions = 0.0
        run.total_net = round(tot_net, 2)
        run.total_employer_cost = round(tot_net, 2)
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
            total_gross=preview["total_net"],
            total_tax=0.0,
            total_deductions=0.0,
            total_net=preview["total_net"],
            total_employer_cost=preview["total_net"],
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
            net = float(pl.get("net_pay", pl.get("amount", pl.get("base_salary", 0.0))))
            line_db = PayrollLineDB(
                payroll_run_id=run.id,
                employee_id=pl["employee_id"],
                employee_name=pl.get("employee_name"),
                department=pl.get("department"),
                compensation_type=c_type,
                is_taxable_local=True,
                is_insurable=True,
                base_salary=net,
                allowances_total=0.0,
                deductions_total=0.0,
                tax_amount=0.0,
                net_pay=net,
                employer_cost_extra=0.0,
                bank_name=pl.get("bank_name", "Unassigned"),
                bank_account_masked=pl.get("bank_account_masked", "Not Provided"),
                payment_status="pending",
                snapshot_notes=pl.get("snapshot_notes", ""),
                created_at=datetime.utcnow(),
            )
            self.db.add(line_db)

        self.db.flush()
        self._recalculate_run_aggregates(run)
        self.db.commit()
        self.db.refresh(run)
        return self._format_run_detail(run)

    def _recalculate_run_aggregates(self, run: PayrollRunDB) -> None:
        """Recalculates net payment totals and headcount for a payroll run from its lines."""
        lines = self.db.query(PayrollLineDB).filter(PayrollLineDB.payroll_run_id == run.id).all()
        tot_net = round(sum(float(l.net_pay or 0.0) for l in lines), 2)
        distinct_headcount = len(set(l.employee_id for l in lines))

        run.total_gross = tot_net
        run.total_tax = 0.0
        run.total_deductions = 0.0
        run.total_net = tot_net
        run.total_employer_cost = tot_net
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
        self.db.commit()
        self.db.refresh(run)
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
        return self._format_run_detail(run)

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
            "net_pay": line.net_pay,
            "amount": line.net_pay,
            "currency": line.payroll_run.currency or "USD",
            "status": line.payment_status,
            "paid_date": line.paid_at.strftime("%Y-%m-%d") if line.paid_at else None,
            "bank_name": line.bank_name,
            "bank_account_masked": line.bank_account_masked,
            "compensation_type": line.compensation_type,
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
            "total_net": run.total_net,
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
        return summary
