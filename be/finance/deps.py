"""
be/finance/deps.py
Dependency injection providers for Finance repositories and services.
"""
from fastapi import Depends
from sqlalchemy.orm import Session

from db import get_db
from finance.repositories.accounts_repository import AccountsRepository
from finance.services.accounts_service import AccountsService
from finance.repositories.customers_repository import CustomersRepository
from finance.services.customers_service import CustomersService
from finance.repositories.vendors_repository import VendorsRepository
from finance.services.vendors_service import VendorsService


def get_accounts_repo(db: Session = Depends(get_db)) -> AccountsRepository:
    return AccountsRepository(db)


def get_accounts_service(
    repo: AccountsRepository = Depends(get_accounts_repo),
) -> AccountsService:
    return AccountsService(repo)


def get_customers_repo(db: Session = Depends(get_db)) -> CustomersRepository:
    return CustomersRepository(db)


def get_customers_service(
    repo: CustomersRepository = Depends(get_customers_repo),
) -> CustomersService:
    return CustomersService(repo)


def get_vendors_repo(db: Session = Depends(get_db)) -> VendorsRepository:
    return VendorsRepository(db)


def get_vendors_service(
    repo: VendorsRepository = Depends(get_vendors_repo),
) -> VendorsService:
    return VendorsService(repo)

