"""
be/repositories/interfaces.py
Protocol interfaces defining the domain repository contracts for HRFlow.
All repository methods operate on domain types/primitives without exposing
underlying storage layout (Google Sheets, SQL, etc.).
"""
from typing import Optional, Protocol, Union, Tuple, List, Dict, Any, runtime_checkable


@runtime_checkable
class EmployeeRepository(Protocol):
    def get_by_id(self, employee_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        ...

    def list_all(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        ...

    def create(self, data: Dict[str, Any]) -> int:
        ...

    def update(self, employee_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        ...

    def delete(self, employee_id: Union[int, str]) -> bool:
        ...

    def get_notes(self, employee_id: Union[int, str]) -> List[Dict[str, Any]]:
        ...

    def create_note(self, employee_id: Union[int, str], data: Dict[str, Any]) -> int:
        ...

    def delete_note(self, note_id: Union[int, str]) -> bool:
        ...

    def get_documents(self, employee_id: Union[int, str]) -> List[Dict[str, Any]]:
        ...

    def get_document_by_id(self, doc_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        ...

    def create_document(self, employee_id: Union[int, str], data: Dict[str, Any]) -> int:
        ...

    def delete_document(self, doc_id: Union[int, str]) -> bool:
        ...


@runtime_checkable
class SalaryRepository(Protocol):
    def get_history(self, employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        ...

    def apply_raise(
        self,
        employee_id: Union[int, str],
        new_internal: float,
        new_external: float,
        effective_date: Optional[str],
        reason: str,
        actor_email: str,
    ) -> Dict[str, Any]:
        ...


@runtime_checkable
class EmployeeBankAccountRepository(Protocol):
    def get_by_employee_id(self, employee_id: Union[int, str], reveal: bool = False) -> Dict[str, Any]:
        ...

    def upsert(
        self,
        employee_id: Union[int, str],
        bank_name: str,
        iban: str,
        swift_code: str,
        actor_email: str,
    ) -> Tuple[str, Optional[int]]:
        ...

# Backward compatibility alias
BankRepository = EmployeeBankAccountRepository


@runtime_checkable
class CompanyDocumentRepository(Protocol):
    def list_all(self) -> List[Dict[str, Any]]:
        ...

    def get_by_id(self, doc_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        ...

    def create(self, data: Dict[str, Any]) -> int:
        ...

    def delete(self, doc_id: Union[int, str]) -> bool:
        ...


@runtime_checkable
class InsuranceRepository(Protocol):
    def list_categories(self) -> List[Dict[str, Any]]:
        ...

    def get_category_by_id(self, cat_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        ...

    def get_category_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        ...

    def create_category(self, name: str, annual_limit: float) -> int:
        ...

    def update_category(self, cat_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        ...

    def delete_category(self, cat_id: Union[int, str]) -> bool:
        ...

    def list_claims(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        ...

    def get_claim_by_id(self, claim_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        ...

    def create_claim(
        self,
        claim_data: Dict[str, Any],
        request_data: Optional[Dict[str, Any]] = None,
    ) -> int:
        ...

    def action_claim(self, claim_id: Union[int, str], status: str, reviewer_email: str) -> bool:
        ...

    def get_consumption(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        ...


@runtime_checkable
class RequestRepository(Protocol):
    def list_requests(
        self,
        type_filter: Optional[str] = None,
        scoped_employee_id: Optional[Union[int, str]] = None,
    ) -> List[Dict[str, Any]]:
        ...

    def get_by_id(self, req_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        ...

    def create(self, data: Dict[str, Any]) -> int:
        ...

    def action_request(self, req_id: Union[int, str], status: str, reviewer_email: str) -> bool:
        ...


@runtime_checkable
class VacationRepository(Protocol):
    def get_history(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        ...

    def create_vacation_request(
        self,
        vacation_data: Dict[str, Any],
        request_data: Dict[str, Any],
    ) -> int:
        ...


@runtime_checkable
class SalaryPaymentDocRepository(Protocol):
    def list_all(
        self,
        employee_id: Optional[Union[int, str]] = None,
        payment_year: Optional[int] = None,
        payment_month: Optional[int] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        ...

    def get_by_id(self, invoice_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        ...

    def find_existing(
        self,
        employee_id: Union[int, str],
        payment_year: int,
        payment_month: int,
    ) -> Optional[Dict[str, Any]]:
        ...

    def create(self, data: Dict[str, Any]) -> int:
        ...

    def update(self, invoice_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        ...

# Backward compatibility alias
InvoiceRepository = SalaryPaymentDocRepository


@runtime_checkable
class AuditRepository(Protocol):
    def list_all(self) -> List[Dict[str, Any]]:
        ...

    def log(
        self,
        action: str,
        actor_email: str,
        target_type: str,
        target_id: Union[str, int],
        details: str = "",
    ) -> None:
        ...


@runtime_checkable
class UserRepository(Protocol):
    def find_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        ...
