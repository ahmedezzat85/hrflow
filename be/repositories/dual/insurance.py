"""
be/repositories/dual/insurance.py
DualWriteInsuranceRepository
"""
from typing import Optional, List, Dict, Any, Union
from logging_config import get_logger

from repositories.interfaces import InsuranceRepository
from repositories.sheets.insurance import SheetsInsuranceRepository
from repositories.sql.insurance import SqlInsuranceRepository

logger = get_logger("dual_write")


class DualWriteInsuranceRepository:
    def __init__(self, primary: Optional[InsuranceRepository] = None, shadow: Optional[InsuranceRepository] = None):
        self.primary = primary or SheetsInsuranceRepository()
        self.shadow = shadow or SqlInsuranceRepository()

    def list_categories(self) -> List[Dict[str, Any]]:
        return self.primary.list_categories()

    def get_category_by_id(self, cat_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        return self.primary.get_category_by_id(cat_id)

    def get_category_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        return self.primary.get_category_by_name(name)

    def create_category(self, name: str, annual_limit: float) -> int:
        cat_id = self.primary.create_category(name, annual_limit)
        try:
            self.shadow.create_category(name, annual_limit)
        except Exception:
            logger.exception("Dual-write shadow create insurance category failed for %s", name)
        return cat_id

    def update_category(self, cat_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        ok = self.primary.update_category(cat_id, updates)
        if ok:
            try:
                self.shadow.update_category(cat_id, updates)
            except Exception:
                logger.exception("Dual-write shadow update insurance category failed for cat_id=%s", cat_id)
        return ok

    def delete_category(self, cat_id: Union[int, str]) -> bool:
        ok = self.primary.delete_category(cat_id)
        if ok:
            try:
                self.shadow.delete_category(cat_id)
            except Exception:
                logger.exception("Dual-write shadow delete insurance category failed for cat_id=%s", cat_id)
        return ok

    def list_claims(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        return self.primary.list_claims(scoped_employee_id=scoped_employee_id)

    def get_claim_by_id(self, claim_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        return self.primary.get_claim_by_id(claim_id)

    def create_claim(
        self,
        claim_data: Dict[str, Any],
        request_data: Optional[Dict[str, Any]] = None,
    ) -> int:
        claim_id = self.primary.create_claim(claim_data, request_data)
        try:
            self.shadow.create_claim(claim_data, request_data)
        except Exception:
            logger.exception("Dual-write shadow create claim failed for employee_id=%s", claim_data.get("employee_id"))
        return claim_id

    def action_claim(self, claim_id: Union[int, str], status: str, reviewer_email: str) -> bool:
        ok = self.primary.action_claim(claim_id, status, reviewer_email)
        if ok:
            try:
                self.shadow.action_claim(claim_id, status, reviewer_email)
            except Exception:
                logger.exception("Dual-write shadow action_claim failed for claim_id=%s", claim_id)
        return ok

    def get_consumption(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        return self.primary.get_consumption(scoped_employee_id=scoped_employee_id)
