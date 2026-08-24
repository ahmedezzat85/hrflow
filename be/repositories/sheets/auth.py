"""
be/repositories/sheets/auth.py
Sheets-backed implementation of UserRepository.
"""
from typing import Optional, Dict, Any

import sheets_client


class SheetsUserRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def find_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        users = self.client.get_all_records("Users")
        email_clean = email.strip().lower()
        for u in users:
            if u.get("email", "").strip().lower() == email_clean:
                return u
        return None
