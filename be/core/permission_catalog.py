"""
be/core/permission_catalog.py
Authoritative code-defined catalog of RBAC permissions and implication rules.
Provides:
- PermissionDef data structure
- CATALOG definition of all 63 keys
- all_keys()
- closure(keys)
- validate_role_keys(keys)
- Import-time validation and cycle checks
"""
from dataclasses import dataclass
from typing import Dict, Iterable, List, Set, Tuple


@dataclass(frozen=True)
class PermissionDef:
    key: str                     # "<module>.<resource>.<action>"
    group: str                   # UI grouping, e.g. "HR / Employees"
    description: str
    implies: Tuple[str, ...] = ()
    assignable: bool = True      # False for system.* keys reserved to Super-Admin


CATALOG: Tuple[PermissionDef, ...] = (
    # System / Access
    PermissionDef(
        key="system.users.manage",
        group="System / Access",
        description="Manage user accounts and identity",
        assignable=False,
    ),
    PermissionDef(
        key="system.roles.manage",
        group="System / Access",
        description="Manage RBAC roles and permissions",
        assignable=False,
    ),

    # System / Audit
    PermissionDef(
        key="system.audit.read",
        group="System / Audit",
        description="View audit log entries",
        assignable=False,
    ),

    # HR / Employees
    PermissionDef(
        key="hr.employee.read",
        group="HR / Employees",
        description="View company employee profiles",
    ),
    PermissionDef(
        key="hr.employee.write",
        group="HR / Employees",
        description="Create, edit, and delete employee records",
        implies=("hr.employee.read",),
    ),

    # HR / Compensation
    PermissionDef(
        key="hr.salary.read",
        group="HR / Compensation",
        description="View employee salaries and raise history",
    ),
    PermissionDef(
        key="hr.salary.write",
        group="HR / Compensation",
        description="Update employee salaries and record compensation changes",
        implies=("hr.salary.read",),
    ),

    # HR / Employee bank details
    PermissionDef(
        key="hr.employee_bank_account.read",
        group="HR / Employee bank details",
        description="View employee bank account details",
    ),
    PermissionDef(
        key="hr.employee_bank_account.write",
        group="HR / Employee bank details",
        description="Create and update employee bank account details",
        implies=("hr.employee_bank_account.read",),
    ),
    PermissionDef(
        key="hr.employee_bank_account.reveal",
        group="HR / Employee bank details",
        description="Reveal unmasked employee bank account and IBAN identifiers",
        implies=("hr.employee_bank_account.read",),
    ),

    # HR / Documents
    PermissionDef(
        key="hr.employee_document.read",
        group="HR / Documents",
        description="View employee documents",
    ),
    PermissionDef(
        key="hr.employee_document.write",
        group="HR / Documents",
        description="Upload and delete employee documents",
        implies=("hr.employee_document.read",),
    ),
    PermissionDef(
        key="hr.company_document.read",
        group="HR / Documents",
        description="View company documents",
    ),
    PermissionDef(
        key="hr.company_document.write",
        group="HR / Documents",
        description="Upload and manage company documents",
        implies=("hr.company_document.read",),
    ),

    # HR / Salary payment documents
    PermissionDef(
        key="hr.salary_payment_doc.read",
        group="HR / Salary payment documents",
        description="View salary payment documents and receipts",
    ),
    PermissionDef(
        key="hr.salary_payment_doc.write",
        group="HR / Salary payment documents",
        description="Upload and manage salary payment documents",
        implies=("hr.salary_payment_doc.read",),
    ),

    # HR / Leave and requests
    PermissionDef(
        key="hr.vacation.read",
        group="HR / Leave and requests",
        description="View company vacation requests and balances",
    ),
    PermissionDef(
        key="hr.vacation.write",
        group="HR / Leave and requests",
        description="Manage and approve vacation requests",
        implies=("hr.vacation.read",),
    ),
    PermissionDef(
        key="hr.request.read",
        group="HR / Leave and requests",
        description="View company employee requests",
    ),
    PermissionDef(
        key="hr.request.write",
        group="HR / Leave and requests",
        description="Manage and approve company employee requests",
        implies=("hr.request.read",),
    ),

    # HR / Medical insurance
    PermissionDef(
        key="hr.insurance.read",
        group="HR / Medical insurance",
        description="View medical insurance categories and claims",
    ),
    PermissionDef(
        key="hr.insurance.write",
        group="HR / Medical insurance",
        description="Manage medical insurance categories and process claims",
        implies=("hr.insurance.read",),
    ),

    # HR / Data export
    PermissionDef(
        key="hr.export.run",
        group="HR / Data export",
        description="Run HR and company data exports",
    ),

    # Self-service
    PermissionDef(
        key="self.profile.read",
        group="Self-service",
        description="View own employee profile",
    ),
    PermissionDef(
        key="self.payslip.read",
        group="Self-service",
        description="View own salary payment documents and payslips",
    ),
    PermissionDef(
        key="self.requests.read",
        group="Self-service",
        description="View own submitted requests",
    ),
    PermissionDef(
        key="self.requests.write",
        group="Self-service",
        description="Submit and manage own requests",
        implies=("self.requests.read",),
    ),
    PermissionDef(
        key="self.salary.read",
        group="Self-service",
        description="View own salary and compensation details",
    ),
    PermissionDef(
        key="self.vacation.read",
        group="Self-service",
        description="View own vacation balance and history",
    ),
    PermissionDef(
        key="self.vacation.write",
        group="Self-service",
        description="Submit and cancel own vacation requests",
        implies=("self.vacation.read",),
    ),
    PermissionDef(
        key="self.claim.read",
        group="Self-service",
        description="View own medical insurance claims and consumption",
    ),
    PermissionDef(
        key="self.claim.write",
        group="Self-service",
        description="Submit own medical insurance claims",
        implies=("self.claim.read",),
    ),
    PermissionDef(
        key="self.bank_account.read",
        group="Self-service",
        description="View own masked bank account details",
    ),
    PermissionDef(
        key="self.document.read",
        group="Self-service",
        description="View own employee documents",
    ),
    PermissionDef(
        key="self.document.write",
        group="Self-service",
        description="Upload and manage own employee documents",
        implies=("self.document.read",),
    ),

    # Finance / Sales
    PermissionDef(
        key="finance.customer.read",
        group="Finance / Sales",
        description="View customers",
    ),
    PermissionDef(
        key="finance.customer.write",
        group="Finance / Sales",
        description="Create, update, and manage customers",
        implies=("finance.customer.read",),
    ),
    PermissionDef(
        key="finance.invoice.read",
        group="Finance / Sales",
        description="View sales invoices",
    ),
    PermissionDef(
        key="finance.invoice.write",
        group="Finance / Sales",
        description="Create, update, and void sales invoices",
        implies=("finance.invoice.read",),
    ),

    # Finance / Spend
    PermissionDef(
        key="finance.vendor.read",
        group="Finance / Spend",
        description="View vendors",
    ),
    PermissionDef(
        key="finance.vendor.write",
        group="Finance / Spend",
        description="Create, update, and manage vendors",
        implies=("finance.vendor.read",),
    ),
    PermissionDef(
        key="finance.vendor_payment.manage",
        group="Finance / Spend",
        description="Add and update sensitive vendor payment details",
        implies=("finance.vendor.read",),
    ),
    PermissionDef(
        key="finance.vendor_payment.verify",
        group="Finance / Spend",
        description="Verify and approve vendor payment instructions",
        implies=("finance.vendor.read",),
    ),
    PermissionDef(
        key="finance.vendor_payment.reveal",
        group="Finance / Spend",
        description="Reveal sensitive vendor payment and bank instructions",
        implies=("finance.vendor.read",),
    ),
    PermissionDef(
        key="finance.bill.read",
        group="Finance / Spend",
        description="View vendor bills",
    ),
    PermissionDef(
        key="finance.bill.write",
        group="Finance / Spend",
        description="Create, update, and void vendor bills",
        implies=("finance.bill.read",),
    ),
    PermissionDef(
        key="finance.subscription.read",
        group="Finance / Spend",
        description="View vendor subscriptions",
    ),
    PermissionDef(
        key="finance.subscription.write",
        group="Finance / Spend",
        description="Create and manage vendor subscriptions",
        implies=("finance.subscription.read",),
    ),
    PermissionDef(
        key="finance.statutory.read",
        group="Finance / Spend",
        description="View statutory obligations and payments",
    ),
    PermissionDef(
        key="finance.statutory.write",
        group="Finance / Spend",
        description="Create and manage statutory obligations and payments",
        implies=("finance.statutory.read",),
    ),

    # Finance / Banking
    PermissionDef(
        key="finance.account.read",
        group="Finance / Banking",
        description="View company bank accounts",
    ),
    PermissionDef(
        key="finance.account.write",
        group="Finance / Banking",
        description="Manage company bank accounts and balances",
        implies=("finance.account.read",),
    ),
    PermissionDef(
        key="finance.bank_account.reveal",
        group="Finance / Banking",
        description="Reveal unmasked company bank account identifiers",
        implies=("finance.account.read",),
    ),
    PermissionDef(
        key="finance.adjustment.manage",
        group="Finance / Banking",
        description="Authorize and record manual balance adjustments and journal corrections",
        implies=("finance.account.write",),
    ),

    # Finance / Reports
    PermissionDef(
        key="finance.report.read",
        group="Finance / Reports",
        description="View finance summary reports and metrics",
    ),

    # Finance / Settings
    PermissionDef(
        key="finance.settings.read",
        group="Finance / Settings",
        description="View finance settings, feature flags, and rollout controls",
    ),
    PermissionDef(
        key="finance.settings.write",
        group="Finance / Settings",
        description="Manage finance settings, feature flags, and rollout controls",
        implies=("finance.settings.read",),
    ),

    # Payroll / Runs
    PermissionDef(
        key="finance.payroll.read",
        group="Payroll / Runs",
        description="View company payroll runs and history",
    ),
    PermissionDef(
        key="finance.payroll.prepare",
        group="Payroll / Runs",
        description="Prepare, adjust, and submit payroll runs and compensation plans",
        implies=("finance.payroll.read",),
    ),
    PermissionDef(
        key="finance.payroll.approve",
        group="Payroll / Runs",
        description="Approve and finalize company payroll runs",
        implies=("finance.payroll.read",),
    ),
    PermissionDef(
        key="finance.payroll.pay",
        group="Payroll / Runs",
        description="Disburse payments and post journal entries for payroll runs",
        implies=("finance.payroll.read",),
    ),

    # Payroll / Tax settings
    PermissionDef(
        key="finance.payroll_tax.read",
        group="Payroll / Tax settings",
        description="View payroll income tax settings",
    ),
    PermissionDef(
        key="finance.payroll_tax.write",
        group="Payroll / Tax settings",
        description="Create and update payroll income tax settings",
        implies=("finance.payroll_tax.read",),
    ),
)


# Fast lookup index
CATALOG_BY_KEY: Dict[str, PermissionDef] = {p.key: p for p in CATALOG}


def validate_catalog_definitions(catalog: Iterable[PermissionDef]) -> None:
    """
    Validates key formatting, target existence, and cyclic dependencies.
    Raises ValueError or AssertionError on any violation.
    """
    seen_keys: Set[str] = set()
    catalog_map: Dict[str, PermissionDef] = {}

    for p in catalog:
        # 1. Key must be unique
        if p.key in seen_keys:
            raise ValueError(f"Duplicate catalog permission key: '{p.key}'")
        seen_keys.add(p.key)
        catalog_map[p.key] = p

        # 2. Key must have exactly 3 dot-separated non-empty parts: <module>.<resource>.<action>
        parts = p.key.split(".")
        if len(parts) != 3 or not all(parts):
            raise ValueError(
                f"Invalid permission key format '{p.key}'. "
                "Must have exactly 3 non-empty dot-separated parts: <module>.<resource>.<action>"
            )

    # 3. Every implies target must exist in the catalog
    for p in catalog:
        for implied in p.implies:
            if implied not in catalog_map:
                raise ValueError(
                    f"Permission '{p.key}' implies non-existent key '{implied}'"
                )

    # 4. Cycle detection in implication graph
    # 0 = unvisited, 1 = visiting (in recursion stack), 2 = visited
    state: Dict[str, int] = {k: 0 for k in catalog_map}

    def _dfs(k: str, path: List[str]) -> None:
        state[k] = 1
        path.append(k)
        for target in catalog_map[k].implies:
            if state[target] == 1:
                cycle_str = " -> ".join(path[path.index(target):] + [target])
                raise ValueError(f"Cyclic permission implication detected: {cycle_str}")
            if state[target] == 0:
                _dfs(target, path)
        path.pop()
        state[k] = 2

    for k in catalog_map:
        if state[k] == 0:
            _dfs(k, [])


# Validate catalog at module import time
validate_catalog_definitions(CATALOG)


def all_keys() -> Set[str]:
    """Returns the set of all valid permission keys in the catalog."""
    return set(CATALOG_BY_KEY.keys())


def closure(keys: Iterable[str]) -> Set[str]:
    """
    Computes the full transitive closure of permission keys under the 'implies' relation.
    """
    result = set(keys)
    stack = list(keys)

    while stack:
        current = stack.pop()
        p_def = CATALOG_BY_KEY.get(current)
        if p_def:
            for implied in p_def.implies:
                if implied not in result:
                    result.add(implied)
                    stack.append(implied)

    return result


def validate_role_keys(keys: Iterable[str]) -> Tuple[Set[str], Set[str]]:
    """
    Validates a collection of keys against the catalog.
    Returns a tuple of:
    - unknown_keys: keys not found in the catalog
    - non_assignable_keys: keys in catalog that have assignable=False (e.g. system.*)
    """
    unknown_keys: Set[str] = set()
    non_assignable_keys: Set[str] = set()

    for k in keys:
        p_def = CATALOG_BY_KEY.get(k)
        if not p_def:
            unknown_keys.add(k)
        elif not p_def.assignable:
            non_assignable_keys.add(k)

    return unknown_keys, non_assignable_keys
