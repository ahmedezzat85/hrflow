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
from finance.repositories.invoices_repository import InvoicesRepository
from finance.services.invoices_service import InvoicesService
from finance.repositories.bills_repository import BillsRepository
from finance.services.bills_service import BillsService
from finance.repositories.ledger_repository import LedgerRepository
from finance.services.ledger_service import LedgerService
from finance.repositories.categories_repository import CategoriesRepository
from finance.services.categories_service import CategoriesService
from finance.repositories.payment_types_repository import PaymentTypesRepository
from finance.services.payment_types_service import PaymentTypesService


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


def get_invoices_repo(db: Session = Depends(get_db)) -> InvoicesRepository:
    return InvoicesRepository(db)


def get_invoices_service(
    repo: InvoicesRepository = Depends(get_invoices_repo),
) -> InvoicesService:
    return InvoicesService(repo)


def get_bills_repo(db: Session = Depends(get_db)) -> BillsRepository:
    return BillsRepository(db)


def get_bills_service(
    repo: BillsRepository = Depends(get_bills_repo),
) -> BillsService:
    return BillsService(repo)


def get_categories_repo(db: Session = Depends(get_db)) -> CategoriesRepository:
    return CategoriesRepository(db)


def get_categories_service(
    repo: CategoriesRepository = Depends(get_categories_repo),
) -> CategoriesService:
    return CategoriesService(repo)


def get_payment_types_repo(db: Session = Depends(get_db)) -> PaymentTypesRepository:
    return PaymentTypesRepository(db)


def get_payment_types_service(
    repo: PaymentTypesRepository = Depends(get_payment_types_repo),
) -> PaymentTypesService:
    return PaymentTypesService(repo)


def get_ledger_repo(db: Session = Depends(get_db)) -> LedgerRepository:
    return LedgerRepository(db)


def get_ledger_service(
    repo: LedgerRepository = Depends(get_ledger_repo),
    accounts_repo: AccountsRepository = Depends(get_accounts_repo),
    categories_repo: CategoriesRepository = Depends(get_categories_repo),
    payment_types_repo: PaymentTypesRepository = Depends(get_payment_types_repo),
) -> LedgerService:
    return LedgerService(repo, accounts_repo, categories_repo, payment_types_repo)


def get_transfers_service(db: Session = Depends(get_db)):
    from finance.services.transfers_service import TransfersService
    return TransfersService(db)

