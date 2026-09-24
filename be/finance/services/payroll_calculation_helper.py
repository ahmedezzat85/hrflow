"""
be/finance/services/payroll_calculation_helper.py
Pure statutory and net/gross calculation helper for Egyptian Social Insurance and Internal USD Cash.
Handles decimal-safe monetary arithmetic with explicit ROUND_HALF_UP rounding policies.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any, Optional, List, Tuple


def quantize_money(val: Decimal) -> Decimal:
    """Rounds an EGP or USD amount to two decimal places using standard ROUND_HALF_UP."""
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def quantize_integer_currency(val: Decimal) -> Decimal:
    """Rounds a currency amount to whole integer units using standard ROUND_HALF_UP."""
    return val.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


class PayrollCalculationException(Exception):
    def __init__(self, code: str, title: str, description: str, severity: str = "blocking", correction_path: Optional[str] = None):
        super().__init__(description)
        self.code = code
        self.title = title
        self.description = description
        self.severity = severity
        self.correction_path = correction_path

    def to_dict(self, exc_id: str, employee_id: int, employee_name: str) -> Dict[str, Any]:
        return {
            "id": exc_id,
            "employee_id": employee_id,
            "employee_name": employee_name,
            "severity": self.severity,
            "code": self.code,
            "title": self.title,
            "description": self.description,
            "correction_path": self.correction_path or f"/admin?section=employees&employee_id={employee_id}",
            "is_resolved": False,
        }


def validate_and_calculate_internal_statutory(
    employee_id: int,
    employee_name: str,
    internal_usd_amount: float,
    salary_basis: str,
    locked_fx_rate: float,
    insured_flag: bool,
    insured_base: Optional[float],
    insured_currency: Optional[str],
    employee_rate: float,
    employer_rate: float,
    bonus_usd: float = 0.0,
    commission_usd: float = 0.0,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Validates and calculates statutory Social Insurance and Net/Gross figures for an internal USD employee line.
    Returns:
        (calculation_result_dict, exceptions_list)
    """
    exceptions: List[Dict[str, Any]] = []

    dec_internal_usd = Decimal(str(round(float(internal_usd_amount or 0.0), 2)))
    dec_bonus_usd = Decimal(str(round(float(bonus_usd or 0.0), 2)))
    dec_commission_usd = Decimal(str(round(float(commission_usd or 0.0), 2)))

    # Handle FX rate
    if locked_fx_rate is None or float(locked_fx_rate) <= 0:
        dec_fx = Decimal("50.0")
    else:
        dec_fx = Decimal(str(float(locked_fx_rate)))

    dec_emp_rate = Decimal(str(float(employee_rate if employee_rate is not None else 0.11)))
    dec_org_rate = Decimal(str(float(employer_rate if employer_rate is not None else 0.18)))

    basis = (salary_basis or "NET").upper()
    if basis not in ("NET", "GROSS"):
        basis = "NET"

    has_recurring_internal = dec_internal_usd > Decimal("0.00")

    # Recurring internal salary in EGP
    recurring_internal_egp = quantize_money(dec_internal_usd * dec_fx)

    dec_insured_base_egp = Decimal("0.00")
    norm_currency = (insured_currency or "").upper()

    # Preflight and validation rules:
    if has_recurring_internal and insured_flag:
        # Rule 1: Missing or non-positive insured base or non-EGP currency (including legacy USD rows)
        if insured_base is None or float(insured_base) <= 0 or norm_currency != "EGP":
            if norm_currency == "USD":
                desc = (
                    f"{employee_name} has a legacy USD currency configuration for social insurance. "
                    "Update their insured base to EGP under Employee Profile > Social Insurance before running payroll."
                )
            else:
                desc = (
                    f"{employee_name} is configured for social insurance coverage but has no active EGP insured base configured. "
                    "Set their insured base under Employee Profile > Social Insurance before running payroll."
                )
            exceptions.append({
                "id": f"exc-ins-{employee_id}",
                "employee_id": employee_id,
                "employee_name": employee_name,
                "severity": "blocking",
                "code": "MISSING_INSURED_BASE",
                "title": "Missing Insured Base",
                "description": desc,
                "correction_path": f"/admin?section=employees&employee_id={employee_id}",
                "is_resolved": False,
            })
        else:
            dec_insured_base_egp = Decimal(str(round(float(insured_base), 2)))
            # Rule 2: Insured Base (EGP) <= Recurring Internal Salary (EGP)
            # Denominator deliberately excludes bonuses/commissions
            if dec_insured_base_egp > recurring_internal_egp:
                exceptions.append({
                    "id": f"exc-ins-exceeds-{employee_id}",
                    "employee_id": employee_id,
                    "employee_name": employee_name,
                    "severity": "blocking",
                    "code": "INSURED_BASE_EXCEEDS_SALARY",
                    "title": "Insured Base Exceeds Internal Salary",
                    "description": (
                        f"{employee_name}'s insured base ({float(dec_insured_base_egp):,.2f} EGP) exceeds their recurring internal base "
                        f"({float(recurring_internal_egp):,.2f} EGP at locked FX rate {float(dec_fx):,.4f}). "
                        "Adjust their insured base under Employee Profile > Social Insurance before running payroll."
                    ),
                    "correction_path": f"/admin?section=employees&employee_id={employee_id}",
                    "is_resolved": False,
                })

    # If employee has no recurring internal salary, statutory calculation is 0 even if insurance record exists
    if not has_recurring_internal or not insured_flag or norm_currency != "EGP" or dec_insured_base_egp <= Decimal("0.00"):
        emp_si_egp = Decimal("0.00")
        org_si_egp = Decimal("0.00")
        tot_si_egp = Decimal("0.00")
    else:
        emp_si_egp = quantize_money(dec_insured_base_egp * dec_emp_rate)
        org_si_egp = quantize_money(dec_insured_base_egp * dec_org_rate)
        tot_si_egp = quantize_money(emp_si_egp + org_si_egp)

    emp_tax_egp = Decimal("0.00")

    # Variable pay in EGP (bonus + commission)
    variable_gross_egp = quantize_money((dec_bonus_usd + dec_commission_usd) * dec_fx)

    # Base gross and net EGP
    if basis == "NET":
        target_net_egp = recurring_internal_egp
        base_gross_egp = quantize_money(target_net_egp + emp_si_egp + emp_tax_egp)
        base_net_egp = target_net_egp
    else:  # GROSS
        configured_gross_egp = recurring_internal_egp
        base_gross_egp = configured_gross_egp
        base_net_egp = quantize_money(configured_gross_egp - emp_si_egp - emp_tax_egp)

    # Final internal net in EGP
    final_internal_net_egp = quantize_money(base_net_egp + variable_gross_egp)

    # Final internal payment in USD: whole integer amount under ROUND_HALF_UP
    if dec_fx > Decimal("0.00"):
        final_internal_payment_usd = quantize_integer_currency(final_internal_net_egp / dec_fx)
        emp_si_usd_eq = quantize_money(emp_si_egp / dec_fx)
        org_si_usd_eq = quantize_money(org_si_egp / dec_fx)
        tot_si_usd_eq = quantize_money(tot_si_egp / dec_fx)
    else:
        final_internal_payment_usd = Decimal("0")
        emp_si_usd_eq = Decimal("0.00")
        org_si_usd_eq = Decimal("0.00")
        tot_si_usd_eq = Decimal("0.00")

    emp_tax_usd_eq = Decimal("0.00")

    # Net pay in USD: whole-dollar final payment
    net_pay_usd = float(final_internal_payment_usd)

    # USD deductions and employer cost fields:
    # In GROSS mode, deduction is the employee SI USD equivalent (or difference between configured USD and net pay)
    # In NET mode, deduction from employee payout is 0.0 because NET target is protected. Employer covers employee SI.
    if basis == "GROSS":
        deductions_usd = float(emp_si_usd_eq)
        employer_extra_usd = float(org_si_usd_eq)
    else:  # NET
        deductions_usd = 0.0
        # In NET mode, employer covers both employer share and employee share
        employer_extra_usd = float(quantize_money(org_si_usd_eq + emp_si_usd_eq))

    result = {
        "salary_basis": basis,
        "configured_internal_salary_usd": float(dec_internal_usd),
        "insured_base_egp": float(dec_insured_base_egp),
        "employee_rate": float(dec_emp_rate),
        "employer_rate": float(dec_org_rate),
        "fx_rate": float(dec_fx),
        "base_gross_egp": float(base_gross_egp),
        "variable_gross_egp": float(variable_gross_egp),
        "employee_social_insurance_egp": float(emp_si_egp),
        "employer_social_insurance_egp": float(org_si_egp),
        "total_social_insurance_egp": float(tot_si_egp),
        "employee_tax_egp": float(emp_tax_egp),
        "employee_social_insurance_usd_equivalent": float(emp_si_usd_eq),
        "employer_social_insurance_usd_equivalent": float(org_si_usd_eq),
        "total_social_insurance_usd_equivalent": float(tot_si_usd_eq),
        "employee_tax_usd_equivalent": float(emp_tax_usd_eq),
        "final_internal_net_egp": float(final_internal_net_egp),
        "final_internal_payment_usd": float(final_internal_payment_usd),
        "net_pay_usd": net_pay_usd,
        "deductions_total_usd": deductions_usd,
        "employer_cost_extra_usd": employer_extra_usd,
    }

    return result, exceptions
