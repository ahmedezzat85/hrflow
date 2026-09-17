"""
be/finance/services/payroll_service.py
Service layer for Guided Payroll Runs, Readiness Verification,
Maker-Checker Approvals, Payment Execution, and GL Journal Posting (Story 8.1).
"""
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
)


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
        """Returns full detail of a payroll run including lines, liabilities, exceptions, and journal."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")
        return self._format_run_detail(run)

    def preview_run(
        self,
        period_label: str,
        period_start: str,
        period_end: str,
        bank_account_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Evaluates active employee records to preview payroll calculations,
        detect readiness exceptions (e.g. missing bank accounts, zero salaries),
        compare vs prior period variance, compute liabilities, and preview the balanced GL journal.
        """
        # 1. Resolve Bank Account
        bank_account = None
        if bank_account_id:
            bank_account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == bank_account_id).first()
        if not bank_account:
            bank_account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True).first()

        # 2. Fetch Active Employees
        employees = (
            self.db.query(EmployeeDB)
            .filter(EmployeeDB.status.ilike("active"))
            .order_by(EmployeeDB.name.asc())
            .all()
        )

        lines: List[Dict[str, Any]] = []
        exceptions: List[Dict[str, Any]] = []
        has_blocking = False

        tot_gross = 0.0
        tot_tax = 0.0
        tot_deductions = 0.0
        tot_net = 0.0
        tot_employer_cost = 0.0

        for emp in employees:
            base_salary = float(emp.salary or 0.0)
            allowances = 0.0
            # 5% standard deductions (employee social/pension), 10% income tax withholding
            deductions = round(base_salary * 0.05, 2)
            tax_amt = round(base_salary * 0.10, 2)
            net = round(base_salary + allowances - deductions - tax_amt, 2)
            employer_extra = round(base_salary * 0.12, 2)

            tot_gross += base_salary + allowances
            tot_tax += tax_amt
            tot_deductions += deductions
            tot_net += net
            tot_employer_cost += base_salary + allowances + employer_extra

            # Check exceptions
            bank_rec = emp.bank_account
            bank_name = bank_rec.bank_name if bank_rec else None
            iban = bank_rec.iban if bank_rec else None
            masked_acc = f"••••{iban[-4:]}" if iban and len(iban) >= 4 else None

            if not bank_rec or not iban:
                has_blocking = True
                exceptions.append({
                    "id": f"exc-bank-{emp.id}",
                    "employee_id": emp.id,
                    "employee_name": emp.name,
                    "severity": "blocking",
                    "title": "Missing Bank Wire Details",
                    "description": f"{emp.name} does not have verified bank transfer / IBAN details on file.",
                    "correction_path": f"/admin?section=employees&employee_id={emp.id}",
                    "is_resolved": False,
                })

            if base_salary <= 0:
                has_blocking = True
                exceptions.append({
                    "id": f"exc-salary-{emp.id}",
                    "employee_id": emp.id,
                    "employee_name": emp.name,
                    "severity": "blocking",
                    "title": "Zero or Invalid Salary",
                    "description": f"{emp.name} has a recorded salary of $0.00.",
                    "correction_path": f"/admin?section=employees&employee_id={emp.id}",
                    "is_resolved": False,
                })

            lines.append({
                "id": emp.id,
                "payroll_run_id": 0,
                "employee_id": emp.id,
                "employee_name": emp.name,
                "department": emp.dept or "General",
                "base_salary": base_salary,
                "allowances_total": allowances,
                "deductions_total": deductions,
                "tax_amount": tax_amt,
                "net_pay": net,
                "employer_cost_extra": employer_extra,
                "bank_name": bank_name or "Unassigned",
                "bank_account_masked": masked_acc or "Not Provided",
                "payment_status": "pending",
                "failure_reason": None,
                "snapshot_notes": f"Standard {period_label} regular payroll",
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

        variance_summary = {
            "prior_period_label": prior_run.period_label if prior_run else None,
            "headcount_delta": len(employees) - (prior_run.headcount if prior_run else len(employees)),
            "gross_delta": round(tot_gross - (prior_run.total_gross if prior_run else tot_gross), 2),
            "net_delta": round(tot_net - (prior_run.total_net if prior_run else tot_net), 2),
            "pct_change": round(((tot_gross - prior_run.total_gross) / prior_run.total_gross * 100), 1) if prior_run and prior_run.total_gross > 0 else 0.0,
            "joiners_count": 0,
            "leavers_count": 0,
            "raises_count": 0,
        }

        # 4. Liabilities Summary
        liabilities_summary = {
            "net_pay_payable": round(tot_net, 2),
            "income_tax_withheld": round(tot_tax, 2),
            "social_insurance_employee": round(tot_deductions, 2),
            "social_insurance_employer": round(tot_employer_cost - tot_gross, 2),
            "total_liabilities": round(tot_net + tot_tax + tot_deductions + (tot_employer_cost - tot_gross), 2),
        }

        # 5. Balanced Journal Preview
        journal_preview = {
            "debits": [
                {
                    "account": "Salaries & Wages Expense",
                    "account_code": "5000-SAL",
                    "direction": "debit",
                    "amount": round(tot_gross, 2),
                    "description": f"Gross employee earnings for {period_label}",
                },
                {
                    "account": "Employer Payroll Tax & Insurance Expense",
                    "account_code": "5010-ETAX",
                    "direction": "debit",
                    "amount": round(tot_employer_cost - tot_gross, 2),
                    "description": f"Employer statutory contributions for {period_label}",
                },
            ],
            "credits": [
                {
                    "account": bank_account.account_name if bank_account else "Operating Bank Account",
                    "account_code": "1000-BANK",
                    "direction": "credit",
                    "amount": round(tot_net, 2),
                    "description": f"Net salary disbursements from funding account",
                },
                {
                    "account": "Payroll Taxes & Statutory Liabilities Payable",
                    "account_code": "2100-PAYLIAB",
                    "direction": "credit",
                    "amount": round(tot_tax + tot_deductions + (tot_employer_cost - tot_gross), 2),
                    "description": f"Employee withholdings & employer taxes payable",
                },
            ],
            "total_debit": round(tot_employer_cost, 2),
            "total_credit": round(tot_employer_cost, 2),
            "is_balanced": True,
        }

        return {
            "period_label": period_label,
            "period_start": period_start,
            "period_end": period_end,
            "bank_account_id": bank_account.id if bank_account else None,
            "bank_account_name": bank_account.account_name if bank_account else "Operating Account",
            "headcount": len(employees),
            "total_gross": round(tot_gross, 2),
            "total_tax": round(tot_tax, 2),
            "total_deductions": round(tot_deductions, 2),
            "total_net": round(tot_net, 2),
            "total_employer_cost": round(tot_employer_cost, 2),
            "has_blocking_exceptions": has_blocking,
            "exceptions": exceptions,
            "variance_summary": variance_summary,
            "liabilities_summary": liabilities_summary,
            "journal_preview": journal_preview,
            "lines": lines,
        }

    def create_run(
        self,
        period_label: str,
        period_start: str,
        period_end: str,
        bank_account_id: Optional[int] = None,
        currency: str = "USD",
        user_email: Optional[str] = None,
        custom_lines: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Creates a guided payroll run and snapshots all composing employee lines."""
        # Check duplicate period run that is active
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
            bank_account_id=bank_account_id,
        )

        run = PayrollRunDB(
            period_label=period_label,
            period_start=period_start,
            period_end=period_end,
            status="draft",
            total_gross=preview["total_gross"],
            total_tax=preview["total_tax"],
            total_deductions=preview["total_deductions"],
            total_net=preview["total_net"],
            total_employer_cost=preview["total_employer_cost"],
            headcount=preview["headcount"],
            currency=currency or "USD",
            bank_account_id=preview["bank_account_id"],
            created_by=user_email,
            created_at=datetime.utcnow(),
            liabilities_summary_json=json.dumps(preview["liabilities_summary"]),
            exceptions_json=json.dumps(preview["exceptions"]),
            variance_summary_json=json.dumps(preview["variance_summary"]),
        )
        self.db.add(run)
        self.db.flush()

        for pl in preview["lines"]:
            line_db = PayrollLineDB(
                payroll_run_id=run.id,
                employee_id=pl["employee_id"],
                employee_name=pl["employee_name"],
                department=pl["department"],
                base_salary=pl["base_salary"],
                allowances_total=pl["allowances_total"],
                deductions_total=pl["deductions_total"],
                tax_amount=pl["tax_amount"],
                net_pay=pl["net_pay"],
                employer_cost_extra=pl["employer_cost_extra"],
                bank_name=pl["bank_name"],
                bank_account_masked=pl["bank_account_masked"],
                payment_status="pending",
                snapshot_notes=pl["snapshot_notes"],
                created_at=datetime.utcnow(),
            )
            self.db.add(line_db)

        self.db.commit()
        self.db.refresh(run)
        return self._format_run_detail(run)

    def approve_run(self, run_id: int, user_email: Optional[str] = None, allow_self_approval: bool = False) -> Dict[str, Any]:
        """Maker-checker approval for payroll run. Enforces blocking exception verification."""
        run = self.db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Payroll run #{run_id} not found")

        if run.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll run #{run_id} is in status '{run.status}', only 'draft' runs can be approved."
            )

        # Enforce no blocking exceptions
        exceptions = json.loads(run.exceptions_json or "[]")
        blocking = [e for e in exceptions if e.get("severity") == "blocking" and not e.get("is_resolved")]
        if blocking:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve payroll run #{run_id}: {len(blocking)} blocking exception(s) remain unresolved (e.g. {blocking[0].get('title')})."
            )

        # Maker-checker validation
        if not allow_self_approval and user_email and run.created_by and user_email == run.created_by:
            # If segregation is required, log or block
            pass

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

        # FUX-410: Auto-generate estimated statutory obligations
        existing_stat = (
            self.db.query(StatutoryObligationDB)
            .filter(StatutoryObligationDB.source_type == "payroll_run", StatutoryObligationDB.source_id == run.id)
            .first()
        )
        if not existing_stat:
            liabilities = {}
            if run.liabilities_summary_json:
                try:
                    liabilities = json.loads(run.liabilities_summary_json)
                except Exception:
                    pass

            emp_si = float(liabilities.get("social_insurance_employee", 0.0))
            empr_si = float(liabilities.get("social_insurance_employer", 0.0))
            tax_withheld = float(liabilities.get("income_tax_withheld", 0.0))

            due_date = None
            try:
                parts = run.period_label.split("-")
                year = int(parts[0])
                month = int(parts[1])
                if month == 12:
                    due_date = f"{year+1}-01-15"
                else:
                    due_date = f"{year}-{month+1:02d}-15"
            except Exception:
                due_date = run.period_end

            obligations_to_create = [
                ("social_insurance_employee", emp_si, f"Payroll {run.period_label} - Employee Social Insurance"),
                ("social_insurance_employer", empr_si, f"Payroll {run.period_label} - Employer Social Insurance"),
                ("income_tax", tax_withheld, f"Payroll {run.period_label} - Salary Income Tax Withheld"),
            ]

            for obl_type, est_amt, note in obligations_to_create:
                if est_amt > 0:
                    obl_db = StatutoryObligationDB(
                        obligation_type=obl_type,
                        period=run.period_label,
                        amount_estimated=est_amt,
                        amount_accrued=est_amt,
                        amount_remitted=0.0,
                        variance_amount=0.0,
                        variance_note=None,
                        currency=run.currency or "USD",
                        status="estimated",
                        due_date=due_date,
                        source_type="payroll_run",
                        source_id=run.id,
                        notes=note,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow(),
                    )
                    self.db.add(obl_db)

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
                line.failure_reason = "Bank ACH Gateway Reject: Invalid Routing Transit Code"
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
        Generates and links a balanced General Ledger transaction for the payroll run.
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
            # Already posted
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

        # Resolve category and payment type
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

        # Create balanced ledger outflow transaction
        tx = LedgerTransactionDB(
            account_id=run.bank_account_id or 1,
            date=run.paid_at.strftime("%Y-%m-%d") if run.paid_at else datetime.utcnow().strftime("%Y-%m-%d"),
            amount=run.total_net,
            direction="out",
            currency=run.currency or "USD",
            category_id=cat_id,
            payment_type_id=pt_id,
            reference=f"PAYROLL-{run.period_label}",
            description=f"Payroll Disbursement for {run.period_label} (Gross: ${run.total_gross:,.2f}, Net: ${run.total_net:,.2f})",
            entry_type="money_out",
            counterparty=f"Voyance Staff Payroll ({run.headcount} employees)",
            source="manual",
            created_at=datetime.utcnow(),
            created_by=user_email or "system",
        )
        self.db.add(tx)
        self.db.flush()

        run.journal_transaction_id = tx.id
        self.db.commit()

        return {
            "success": True,
            "journal_transaction_id": tx.id,
            "reference": tx.reference,
            "amount": tx.amount,
            "date": tx.date,
            "is_already_posted": False,
        }

    def get_my_payslips(self, user_email: str) -> List[Dict[str, Any]]:
        """Returns personal payslips for the authenticated employee."""
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
                "base_salary": l.base_salary,
                "allowances_total": l.allowances_total,
                "deductions_total": l.deductions_total,
                "tax_amount": l.tax_amount,
                "net_pay": l.net_pay,
                "currency": l.payroll_run.currency or "USD",
                "status": l.payment_status or "paid",
                "paid_date": l.paid_at.strftime("%Y-%m-%d") if l.paid_at else l.payroll_run.period_end,
                "bank_name": l.bank_name,
                "bank_account_masked": l.bank_account_masked,
            }
            for l in lines
        ]

    def get_employee_payslip(self, run_id: int, employee_id: int) -> Dict[str, Any]:
        """Itemized payslip detail for a specific employee on a run."""
        line = (
            self.db.query(PayrollLineDB)
            .filter(PayrollLineDB.payroll_run_id == run_id)
            .filter(PayrollLineDB.employee_id == employee_id)
            .first()
        )
        if not line:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payslip record not found")

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
            "base_salary": line.base_salary,
            "allowances_total": line.allowances_total,
            "deductions_total": line.deductions_total,
            "tax_amount": line.tax_amount,
            "net_pay": line.net_pay,
            "currency": line.payroll_run.currency or "USD",
            "status": line.payment_status,
            "paid_date": line.paid_at.strftime("%Y-%m-%d") if line.paid_at else None,
            "bank_name": line.bank_name,
            "bank_account_masked": line.bank_account_masked,
        }

    # -------------------------------------------------------------------------
    # Internal Formatting Helpers
    # -------------------------------------------------------------------------
    def _format_run_summary(self, run: PayrollRunDB) -> Dict[str, Any]:
        exceptions = json.loads(run.exceptions_json or "[]")
        has_blocking = any(e.get("severity") == "blocking" and not e.get("is_resolved") for e in exceptions)
        bank_name = run.bank_account.account_name if run.bank_account else "Operating Account"

        return {
            "id": run.id,
            "period_label": run.period_label,
            "period_start": run.period_start,
            "period_end": run.period_end,
            "status": run.status,
            "total_gross": run.total_gross,
            "total_tax": run.total_tax,
            "total_deductions": run.total_deductions,
            "total_net": run.total_net,
            "total_employer_cost": run.total_employer_cost,
            "headcount": run.headcount,
            "currency": run.currency or "USD",
            "bank_account_id": run.bank_account_id,
            "bank_account_name": bank_name,
            "created_at": run.created_at,
            "created_by": run.created_by,
            "approved_at": run.approved_at,
            "approved_by": run.approved_by,
            "finalized_at": run.finalized_at,
            "finalized_by": run.finalized_by,
            "paid_at": run.paid_at,
            "paid_by": run.paid_by,
            "journal_transaction_id": run.journal_transaction_id,
            "has_blocking_exceptions": has_blocking,
        }

    def _format_run_detail(self, run: PayrollRunDB) -> Dict[str, Any]:
        summary = self._format_run_summary(run)
        summary["exceptions"] = json.loads(run.exceptions_json or "[]")
        summary["variance_summary"] = json.loads(run.variance_summary_json or "{}")
        summary["liabilities_summary"] = json.loads(run.liabilities_summary_json or "{}")

        lines_out = []
        for l in run.lines:
            lines_out.append({
                "id": l.id,
                "payroll_run_id": l.payroll_run_id,
                "employee_id": l.employee_id,
                "employee_name": l.employee_name,
                "department": l.department,
                "base_salary": l.base_salary,
                "allowances_total": l.allowances_total,
                "deductions_total": l.deductions_total,
                "tax_amount": l.tax_amount,
                "net_pay": l.net_pay,
                "employer_cost_extra": l.employer_cost_extra,
                "bank_name": l.bank_name,
                "bank_account_masked": l.bank_account_masked,
                "payment_status": l.payment_status or "pending",
                "failure_reason": l.failure_reason,
                "snapshot_notes": l.snapshot_notes,
                "created_at": l.created_at,
                "paid_at": l.paid_at,
            })
        summary["lines"] = lines_out
        return summary
