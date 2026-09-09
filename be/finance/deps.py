"""
be/finance/deps.py
Dependency injection providers for Finance repositories and services.
"""
from fastapi import Depends
from sqlalchemy.orm import Session

from db import get_db
from finance.repositories.accounts_repository import AccountsRepository
from finance.services.accounts_service import AccountsService


def get_accounts_repo(db: Session = Depends(get_db)) -> AccountsRepository:
    return AccountsRepository(db)


def get_accounts_service(
    repo: AccountsRepository = Depends(get_accounts_repo),
) -> AccountsService:
    return AccountsService(repo)
