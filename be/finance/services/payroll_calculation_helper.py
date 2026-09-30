"""
be/finance/services/payroll_calculation_helper.py
Pure statutory and net/gross calculation helper for Egyptian Social Insurance, Income Tax, and Internal USD Cash.
Handles decimal-safe monetary arithmetic with explicit ROUND_HALF_UP rounding policies.
"""
from decimal import Decimal, ROUND_HALF_UP
import json
from typing import Dict, Any, Optional, List, Tuple


def quantize_money(val: Decimal) -> Decimal:
    """Rounds an EGP or USD amount to two decimal places using standard ROUND_HALF_UP."""
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def quantize_integer_currency(val: Decimal) -> Decimal:
    """Rounds a currency amount to whole integer units using standard ROUND_HALF_UP."""
    return val.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


# Owner-approved default tax brackets and limit template
DEFAULT_TAX_LIMIT_P = 20000.0

DEFAULT_TAX_BRACKETS: List[Dict[str, Any]] = [
    {"upper_bound": 40000.0, "rate": 0.0, "base": None, "fixed": 0.0},
    {"upper_bound": 55000.0, "rate": 0.10, "base": 40000.0, "fixed": 0.0},
    {"upper_bound": 70000.0, "rate": 0.15, "base": 55000.0, "fixed": 1500.0},
    {"upper_bound": 200000.0, "rate": 0.20, "base": 70000.0, "fixed": 3750.0},
    {"upper_bound": 400000.0, "rate": 0.225, "base": 200000.0, "fixed": 31750.0},
    {"upper_bound": 600000.0, "rate": 0.25, "base": 400000.0, "fixed": 76750.0},
    {"upper_bound": 700000.0, "rate": 0.25, "base": 400000.0, "fixed": 79750.0},
    {"upper_bound": 800000.0, "rate": 0.25, "base": 400000.0, "fixed": 82000.0},
    {"upper_bound": 900000.0, "rate": 0.25, "base": 400000.0, "fixed": 85000.0},
    {"upper_bound": 1200000.0, "rate": 0.25, "base": 400000.0, "fixed": 90000.0},
    {"upper_bound": None, "rate": 0.275, "base": 1200000.0, "fixed": 300000.0},
]


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


def calculate_annual_income_tax(
    annual_taxed_salary: Decimal,
    brackets: List[Dict[str, Any]],
) -> Decimal:
    """
    Computes annual income tax from annual taxed salary in EGP using verbatim bracket formula.
    Annual tax is maintained as an unrounded Decimal intermediate.
    """
    if annual_taxed_salary <= Decimal("0"):
        return Decimal("0")

    for b in brackets:
        upper = b.get("upper_bound")
        if upper is not None and annual_taxed_salary <= Decimal(str(upper)):
            rate = Decimal(str(b.get("rate") or 0))
            base = Decimal(str(b.get("base") or 0)) if b.get("base") is not None else Decimal("0")
            fixed = Decimal(str(b.get("fixed") or 0))
            return (annual_taxed_salary - base) * rate + fixed

    # Above top bracket
    top_b = brackets[-1]
    rate = Decimal(str(top_b.get("rate") or 0))
    base = Decimal(str(top_b.get("base") or 0)) if top_b.get("base") is not None else Decimal("0")
    fixed = Decimal(str(top_b.get("fixed") or 0))
    return (annual_taxed_salary - base) * rate + fixed


def solve_recurring_gross_for_net(
    target_net_egp: Decimal,
    employee_si_egp: Decimal,
    tax_limit_p_egp: Decimal,
    brackets: List[Dict[str, Any]],
) -> Decimal:
    """
    Solves the recurring gross in EGP that produces target_net_egp after employee SI and tax.
    Rule: Solve each tax bracket in ascending order, accept the first solution whose annual-taxed
    salary lies inside that bracket, and therefore choose the lowest valid gross.
    Validates that candidate Y belongs to the producing bracket, applies forward tax calculation
    as a self-check, and asserts resulting net is within 0.01 EGP of target net.
    """
    N = target_net_egp
    S = employee_si_egp
    L = tax_limit_p_egp

    if N <= Decimal("0"):
        return Decimal("0.00")

    candidate_gross: Optional[Decimal] = None
    prev_upper = Decimal("-Infinity")

    for i, b in enumerate(brackets):
        r = Decimal(str(b.get("rate") or 0))
        base = Decimal(str(b.get("base") or 0)) if b.get("base") is not None else Decimal("0")
        F = Decimal(str(b.get("fixed") or 0))
        upper_val = b.get("upper_bound")
        upper = Decimal(str(upper_val)) if upper_val is not None else None

        one_minus_r = Decimal("1") - r
        if one_minus_r == Decimal("0"):
            continue

        # Derived: Y = (12*N - L - r*b + F) / (1 - r)
        Y = (Decimal("12") * N - L - r * base + F) / one_minus_r

        # Validation: does Y belong to this bracket?
        in_bracket = False
        if i == 0:
            if upper is not None and Y <= upper:
                in_bracket = True
        else:
            if Y > prev_upper:
                if upper is None or Y <= upper:
                    in_bracket = True

        if in_bracket:
            # Candidate gross in EGP
            G = quantize_money((Y + L) / Decimal("12") + S)
            # Self-check: forward tax
            Y_check = (G - S) * Decimal("12") - L
            ann_tax = calculate_annual_income_tax(Y_check, brackets)
            monthly_tax = quantize_money(ann_tax / Decimal("12"))
            fwd_net = G - S - monthly_tax
            if abs(fwd_net - N) <= Decimal("0.01"):
                candidate_gross = G
                break

        if upper is not None:
            prev_upper = upper

    if candidate_gross is None:
        # Fallback check across all brackets in ascending order
        for b in brackets:
            r = Decimal(str(b.get("rate") or 0))
            base = Decimal(str(b.get("base") or 0)) if b.get("base") is not None else Decimal("0")
            F = Decimal(str(b.get("fixed") or 0))
            one_minus_r = Decimal("1") - r
            if one_minus_r == Decimal("0"):
                continue
            Y = (Decimal("12") * N - L - r * base + F) / one_minus_r
            G = quantize_money((Y + L) / Decimal("12") + S)
            Y_check = (G - S) * Decimal("12") - L
            ann_tax = calculate_annual_income_tax(Y_check, brackets)
            monthly_tax = quantize_money(ann_tax / Decimal("12"))
            fwd_net = G - S - monthly_tax
            if abs(fwd_net - N) <= Decimal("0.01"):
                candidate_gross = G
                break

    if candidate_gross is None:
        raise PayrollCalculationException(
            code="TAX_NET_SOLVER_ERROR",
            title="Tax Net Solver Error",
            description=f"Could not solve recurring gross for target net {N:,.2f} EGP with employee SI {S:,.2f} EGP.",
            severity="blocking",
        )

    return candidate_gross


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
    tax_settings: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Validates and calculates statutory Social Insurance, Income Tax, and Net/Gross figures for an internal USD employee line.
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

    # Social Insurance calculation in EGP
    if not has_recurring_internal or not insured_flag or norm_currency != "EGP" or dec_insured_base_egp <= Decimal("0.00"):
        emp_si_egp = Decimal("0.00")
        org_si_egp = Decimal("0.00")
        tot_si_egp = Decimal("0.00")
    else:
        emp_si_egp = quantize_money(dec_insured_base_egp * dec_emp_rate)
        org_si_egp = quantize_money(dec_insured_base_egp * dec_org_rate)
        tot_si_egp = quantize_money(emp_si_egp + org_si_egp)

    # Tax settings resolution and validation for internal line
    has_valid_tax_settings = False
    resolved_brackets = []
    if has_recurring_internal:
        if tax_settings:
            if tax_settings.get("brackets"):
                resolved_brackets = tax_settings["brackets"]
            elif tax_settings.get("brackets_json"):
                bj = tax_settings["brackets_json"]
                resolved_brackets = json.loads(bj) if isinstance(bj, str) else bj

        if not resolved_brackets:
            exceptions.append({
                "id": f"exc-tax-{employee_id}",
                "employee_id": employee_id,
                "employee_name": employee_name,
                "severity": "blocking",
                "code": "MISSING_TAX_SETTINGS",
                "title": "Missing Tax Settings",
                "description": (
                    f"No effective income tax settings found for {employee_name}. "
                    "A system administrator must configure effective tax settings before running payroll."
                ),
                "correction_path": "/admin?section=payroll-settings",
                "is_resolved": False,
            })
        else:
            has_valid_tax_settings = True

    # Variable pay in EGP (bonus + commission)
    variable_gross_egp = quantize_money((dec_bonus_usd + dec_commission_usd) * dec_fx)

    # Determine recurring gross EGP
    if has_recurring_internal and has_valid_tax_settings:
        tax_limit_p = Decimal(str(tax_settings.get("tax_limit_p_egp", DEFAULT_TAX_LIMIT_P)))
        brackets = resolved_brackets or DEFAULT_TAX_BRACKETS
        if basis == "NET":
            recurring_gross_egp = solve_recurring_gross_for_net(
                target_net_egp=recurring_internal_egp,
                employee_si_egp=emp_si_egp,
                tax_limit_p_egp=tax_limit_p,
                brackets=brackets,
            )
        else:  # GROSS
            recurring_gross_egp = recurring_internal_egp
    else:
        # Fallback if no recurring internal or missing tax settings
        recurring_gross_egp = recurring_internal_egp

    # Taxable gross = recurring gross + bonus + commission
    taxable_gross_egp = quantize_money(recurring_gross_egp + variable_gross_egp)

    # Annual taxed salary & Income Tax calculation
    if has_recurring_internal and has_valid_tax_settings:
        tax_limit_p = Decimal(str(tax_settings.get("tax_limit_p_egp", DEFAULT_TAX_LIMIT_P)))
        brackets = resolved_brackets or DEFAULT_TAX_BRACKETS
        annual_taxed_salary_egp = (taxable_gross_egp - emp_si_egp) * Decimal("12") - tax_limit_p
        annual_tax_egp = calculate_annual_income_tax(annual_taxed_salary_egp, brackets)
        emp_tax_egp = quantize_money(annual_tax_egp / Decimal("12"))
    else:
        annual_taxed_salary_egp = Decimal("0.00")
        annual_tax_egp = Decimal("0.00")
        emp_tax_egp = Decimal("0.00")

    # Base gross & net EGP
    base_gross_egp = recurring_gross_egp

    # Final internal net in EGP = taxable gross - employee SI - employee tax
    final_internal_net_egp = quantize_money(taxable_gross_egp - emp_si_egp - emp_tax_egp)

    # Final internal payment in USD: whole integer amount under ROUND_HALF_UP
    if dec_fx > Decimal("0.00"):
        final_internal_payment_usd = quantize_integer_currency(final_internal_net_egp / dec_fx)
        emp_si_usd_eq = quantize_money(emp_si_egp / dec_fx)
        org_si_usd_eq = quantize_money(org_si_egp / dec_fx)
        tot_si_usd_eq = quantize_money(tot_si_egp / dec_fx)
        emp_tax_usd_eq = quantize_money(emp_tax_egp / dec_fx)
    else:
        final_internal_payment_usd = Decimal("0")
        emp_si_usd_eq = Decimal("0.00")
        org_si_usd_eq = Decimal("0.00")
        tot_si_usd_eq = Decimal("0.00")
        emp_tax_usd_eq = Decimal("0.00")

    # Net pay in USD: whole-dollar final payment
    net_pay_usd = float(final_internal_payment_usd)

    # USD deductions and employer cost fields:
    # In GROSS mode: deductions = employee SI + employee tax (converted to USD)
    # In NET mode: deductions = 0.0 (net is protected); employer covers employer SI + employee SI + employee tax
    if basis == "GROSS":
        deductions_usd = float(quantize_money(emp_si_usd_eq + emp_tax_usd_eq))
        employer_extra_usd = float(org_si_usd_eq)
    else:  # NET
        deductions_usd = 0.0
        employer_extra_usd = float(quantize_money(org_si_usd_eq + emp_si_usd_eq + emp_tax_usd_eq))

    tax_version_id = tax_settings.get("id") if (tax_settings and isinstance(tax_settings, dict)) else None

    result = {
        "salary_basis": basis,
        "configured_internal_salary_usd": float(dec_internal_usd),
        "insured_base_egp": float(dec_insured_base_egp),
        "employee_rate": float(dec_emp_rate),
        "employer_rate": float(dec_org_rate),
        "fx_rate": float(dec_fx),
        "base_gross_egp": float(base_gross_egp),
        "variable_gross_egp": float(variable_gross_egp),
        "taxable_gross_egp": float(taxable_gross_egp),
        "tax_employee_si_egp": float(emp_si_egp),
        "annual_taxed_salary_egp": float(quantize_money(annual_taxed_salary_egp)),
        "annual_tax_egp": float(quantize_money(annual_tax_egp)),
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
        "tax_settings_version_id": tax_version_id,
    }

    return result, exceptions
