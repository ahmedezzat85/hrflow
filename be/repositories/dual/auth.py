"""
be/repositories/dual/auth.py
DualWriteUserRepository
"""
from typing import Optional, Dict, Any
from logging_config import get_logger

from repositories.interfaces import UserRepository
from repositories.sheets.auth import SheetsUserRepository
from repositories.sql.auth import SqlUserRepository

logger = get_logger("dual_write")


class DualWriteUserRepository:
    def __init__(self, primary: Optional[UserRepository] = None, shadow: Optional[UserRepository] = None):
        self.primary = primary or SheetsUserRepository()
        self.shadow = shadow or SqlUserRepository()

    def find_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        return self.primary.find_by_email(email)
