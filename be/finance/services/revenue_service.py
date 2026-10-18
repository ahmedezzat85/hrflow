"""
be/finance/services/revenue_service.py
Revenue sources and "Record revenue receipt" (X4, D-029/D-030).

A revenue receipt is a money_in ledger row on any company account with a revenue source, optional product and
customer, the period it covers, memo-only gross and fee amounts, a reference and an optional attachment.
Receipts are never deleted; a mistake is corrected with a reversal row.
"""
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from finance import books, revenue
from finance.models import (
    CustomerDB,
    FinanceAttachmentDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    ProductDB,
    RevenueSourceDB,
    TransactionCategoryDB,
)
from finance.repositories.ledger_repository import LedgerRepository
from finance.schemas import (
    RevenueReceiptCreate,
    RevenueReceiptResponse,
    RevenueReceiptReverse,
    RevenueSourceCreate,
    RevenueSourceResponse,
    RevenueSourceUpdate,
)
from finance.services.subscriptions_service import FINANCE_UPLOADS_DIR

RECEIPT_SOURCE = "revenue_receipt"
REVERSAL_SOURCE = "revenue_receipt_reversal"
MAX_FILE_BYTES = 15 * 1024 * 1024


def _valid_date(value: Optional[str], field: str) -> None:
    if value is None:
        return
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be YYYY-MM-DD")


class RevenueService:
    def __init__(self, db: Session):
        self.db = db

    # ---------------- sources
    def list_sources(self, is_active: Optional[bool] = None) -> List[RevenueSourceResponse]:
        revenue.ensure_sources(self.db)
        q = self.db.query(RevenueSourceDB)
        if is_active is not None:
            q = q.filter(RevenueSourceDB.is_active == is_active)
        return [RevenueSourceResponse.model_validate(s) for s in q.order_by(RevenueSourceDB.sort_order, RevenueSourceDB.id).all()]

    def create_source(self, payload: RevenueSourceCreate) -> RevenueSourceResponse:
        revenue.ensure_sources(self.db)
        code = payload.code.strip().lower().replace(" ", "_")
        if self.db.query(RevenueSourceDB).filter(RevenueSourceDB.code == code).first():
            raise HTTPException(status_code=400, detail=f"Revenue source code '{code}' already exists")
        src = RevenueSourceDB(code=code, name=payload.name.strip(), sort_order=payload.sort_order, is_active=payload.is_active, is_system=False)
        self.db.add(src)
        self.db.commit()
        self.db.refresh(src)
        return RevenueSourceResponse.model_validate(src)

    def update_source(self, source_id: int, payload: RevenueSourceUpdate) -> RevenueSourceResponse:
        src = self.db.query(RevenueSourceDB).filter(RevenueSourceDB.id == source_id).first()
        if not src:
            raise HTTPException(status_code=404, detail=f"Revenue source {source_id} not found")
        data = payload.model_dump(exclude_unset=True)
        if src.is_system and data.get("is_active") is False:
            raise HTTPException(status_code=400, detail="The Invoice source is used by invoice receipts and cannot be deactivated")
        if data.get("name"):
            src.name = data["name"].strip()
        if data.get("sort_order") is not None:
            src.sort_order = data["sort_order"]
        if data.get("is_active") is not None:
            src.is_active = data["is_active"]
        self.db.commit()
        self.db.refresh(src)
        return RevenueSourceResponse.model_validate(src)

    # ---------------- receipts
    def _to_response(self, tx: LedgerTransactionDB) -> RevenueReceiptResponse:
        scope = books.resolve(self.db, None)
        src = self.db.query(RevenueSourceDB).filter(RevenueSourceDB.id == tx.revenue_source_id).first() if tx.revenue_source_id else None
        prod = self.db.query(ProductDB).filter(ProductDB.id == tx.product_id).first() if tx.product_id else None
        cust = self.db.query(CustomerDB).filter(CustomerDB.id == tx.customer_id).first() if tx.customer_id else None
        att = (
            self.db.query(FinanceAttachmentDB)
            .filter(FinanceAttachmentDB.ledger_transaction_id == tx.id)
            .order_by(FinanceAttachmentDB.id.desc())
            .first()
        )
        return RevenueReceiptResponse(
            id=tx.id,
            account_id=tx.account_id,
            account_name=tx.account.account_name if tx.account else None,
            book_code=scope.book_of(tx.account_id),
            date=tx.date,
            amount=tx.amount,
            currency=tx.currency,
            direction=tx.direction,
            revenue_source_id=tx.revenue_source_id,
            revenue_source_name=src.name if src else None,
            product_id=tx.product_id,
            product_name=prod.name if prod else None,
            customer_id=tx.customer_id,
            customer_name=cust.name if cust else None,
            period_start=tx.period_start,
            period_end=tx.period_end,
            memo_gross_amount=tx.memo_gross_amount,
            memo_fee_amount=tx.memo_fee_amount,
            reference=tx.reference or "",
            description=tx.description or "",
            is_reversal=tx.source == REVERSAL_SOURCE,
            has_attachment=att is not None,
            attachment_name=att.file_name if att else None,
            created_at=tx.created_at,
            created_by=tx.created_by,
        )

    def _get_receipt(self, receipt_id: int) -> LedgerTransactionDB:
        tx = self.db.query(LedgerTransactionDB).filter(
            LedgerTransactionDB.id == receipt_id,
            LedgerTransactionDB.source.in_([RECEIPT_SOURCE, REVERSAL_SOURCE]),
        ).first()
        if not tx:
            raise HTTPException(status_code=404, detail=f"Revenue receipt {receipt_id} not found")
        return tx

    def create_receipt(self, payload: RevenueReceiptCreate, created_by: Optional[str] = None) -> RevenueReceiptResponse:
        revenue.ensure_sources(self.db)
        _valid_date(payload.date, "date")
        _valid_date(payload.period_start, "period_start")
        _valid_date(payload.period_end, "period_end")
        if payload.period_start and payload.period_end and payload.period_end < payload.period_start:
            raise HTTPException(status_code=400, detail="period_end cannot precede period_start")

        account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payload.account_id).first()
        if not account:
            raise HTTPException(status_code=404, detail=f"Account {payload.account_id} not found")
        if not account.is_active:
            raise HTTPException(status_code=400, detail=f"Account '{account.account_name}' is inactive")
        # D-020: entries are in the account currency; exchange happens only through FX transfers
        if (payload.currency or "").upper() != (account.currency or "").upper():
            raise HTTPException(status_code=400, detail={
                "code": "currency_mismatch",
                "message": f"The receipt currency ({payload.currency.upper()}) must match the account currency ({account.currency}). Use an FX transfer to exchange currencies.",
            })

        src = self.db.query(RevenueSourceDB).filter(RevenueSourceDB.id == payload.revenue_source_id).first()
        if not src:
            raise HTTPException(status_code=404, detail=f"Revenue source {payload.revenue_source_id} not found")
        if not src.is_active:
            raise HTTPException(status_code=400, detail=f"Revenue source '{src.name}' is inactive")
        if src.code == revenue.INVOICE:
            raise HTTPException(status_code=400, detail="Invoice receipts are recorded against the invoice, not as a revenue receipt")

        if payload.product_id:
            prod = self.db.query(ProductDB).filter(ProductDB.id == payload.product_id).first()
            if not prod:
                raise HTTPException(status_code=404, detail=f"Product {payload.product_id} not found")
            if not prod.is_active:
                raise HTTPException(status_code=400, detail=f"Product '{prod.name}' is inactive")
        if payload.customer_id and not self.db.query(CustomerDB).filter(CustomerDB.id == payload.customer_id).first():
            raise HTTPException(status_code=404, detail=f"Customer {payload.customer_id} not found")

        rev_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == "Revenue").first()
        try:
            tx = LedgerRepository(self.db).create_transaction(
                payload.account_id,
                {
                    "date": payload.date,
                    "amount": payload.amount,
                    "direction": "in",
                    "currency": account.currency,
                    "entry_type": "money_in",
                    "category_id": rev_cat.id if rev_cat else None,
                    "reference": payload.reference or "",
                    "description": payload.description or f"Revenue receipt: {src.name}",
                    "source": RECEIPT_SOURCE,
                },
                created_by=created_by,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        tx.revenue_source_id = src.id
        tx.product_id = payload.product_id
        tx.customer_id = payload.customer_id
        tx.period_start = payload.period_start
        tx.period_end = payload.period_end
        tx.memo_gross_amount = payload.memo_gross_amount
        tx.memo_fee_amount = payload.memo_fee_amount
        self.db.commit()
        self.db.refresh(tx)
        return self._to_response(tx)

    def list_receipts(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        revenue_source_id: Optional[int] = None,
        product_id: Optional[int] = None,
        customer_id: Optional[int] = None,
        book: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[RevenueReceiptResponse]:
        scope = books.resolve(self.db, book)
        q = self.db.query(LedgerTransactionDB).filter(LedgerTransactionDB.source.in_([RECEIPT_SOURCE, REVERSAL_SOURCE]))
        q = scope.filter(q, LedgerTransactionDB.account_id)
        if date_from:
            q = q.filter(LedgerTransactionDB.date >= date_from)
        if date_to:
            q = q.filter(LedgerTransactionDB.date <= date_to)
        if revenue_source_id:
            q = q.filter(LedgerTransactionDB.revenue_source_id == revenue_source_id)
        if product_id:
            q = q.filter(LedgerTransactionDB.product_id == product_id)
        if customer_id:
            q = q.filter(LedgerTransactionDB.customer_id == customer_id)
        rows = q.order_by(LedgerTransactionDB.date.desc(), LedgerTransactionDB.id.desc()).offset(offset).limit(limit).all()
        return [self._to_response(t) for t in rows]

    def get_receipt(self, receipt_id: int) -> RevenueReceiptResponse:
        return self._to_response(self._get_receipt(receipt_id))

    def reverse_receipt(self, receipt_id: int, payload: RevenueReceiptReverse, created_by: Optional[str] = None) -> RevenueReceiptResponse:
        orig = self._get_receipt(receipt_id)
        if orig.source != RECEIPT_SOURCE:
            raise HTTPException(status_code=400, detail="A reversal cannot be reversed")
        already = self.db.query(LedgerTransactionDB).filter(
            LedgerTransactionDB.source == REVERSAL_SOURCE,
            LedgerTransactionDB.reference == f"REV-{orig.id}",
        ).first()
        if already:
            raise HTTPException(status_code=400, detail="This receipt has already been reversed")
        try:
            rev = LedgerRepository(self.db).create_transaction(
                orig.account_id,
                {
                    "date": datetime.utcnow().strftime("%Y-%m-%d"),
                    "amount": orig.amount,
                    "direction": "out",
                    "currency": orig.currency,
                    "entry_type": "money_out",
                    "category_id": orig.category_id,
                    "reference": f"REV-{orig.id}",
                    "description": f"Reversal of revenue receipt #{orig.id}: {payload.reason.strip()}",
                    "source": REVERSAL_SOURCE,
                },
                created_by=created_by,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        for field in ("revenue_source_id", "product_id", "customer_id", "period_start", "period_end", "memo_gross_amount", "memo_fee_amount"):
            setattr(rev, field, getattr(orig, field))
        self.db.commit()
        self.db.refresh(rev)
        return self._to_response(rev)

    # ---------------- attachment (the existing ledger attachment link)
    async def upload_attachment(self, receipt_id: int, file: UploadFile, uploaded_by: Optional[str] = None) -> RevenueReceiptResponse:
        tx = self._get_receipt(receipt_id)
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="A valid file is required.")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file cannot be empty.")
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds the 15 MB limit.")
        name = os.path.basename(file.filename)
        os.makedirs(FINANCE_UPLOADS_DIR, exist_ok=True)
        path = os.path.join(FINANCE_UPLOADS_DIR, f"{uuid.uuid4().hex}_{name}")
        with open(path, "wb") as fh:
            fh.write(content)
        self.db.add(FinanceAttachmentDB(
            ledger_transaction_id=tx.id, file_name=name, file_size=len(content),
            mime_type=file.content_type or "application/octet-stream", storage_ref=path,
            uploaded_at=datetime.utcnow(), uploaded_by=uploaded_by,
        ))
        self.db.commit()
        return self._to_response(tx)

    def get_attachment_file(self, receipt_id: int):
        tx = self._get_receipt(receipt_id)
        att = (
            self.db.query(FinanceAttachmentDB)
            .filter(FinanceAttachmentDB.ledger_transaction_id == tx.id)
            .order_by(FinanceAttachmentDB.id.desc())
            .first()
        )
        if not att or not os.path.isfile(att.storage_ref or ""):
            raise HTTPException(status_code=404, detail="Attachment not found")
        return att.storage_ref, att.file_name, att.mime_type or "application/octet-stream"
