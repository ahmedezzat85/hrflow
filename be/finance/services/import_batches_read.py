"""
be/finance/services/import_batches_read.py
Read-only view of committed bulk-import runs (D-033) for the finance MCP tools (D-058).

A run stores only its counts (`finance_import_batches`). What each run created is found where every importer already
records it: one audit entry per created row, "imported from batch N row REF" for bills, cheques, invoices and
transfers, and "REF|account|date|amount batch N" for bank fees. Rows that failed were never created and are not
stored. Nothing here writes.
"""
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from finance.models import AccountTransferDB, BillDB, FinanceChequeDB, ImportBatchDB, LedgerTransactionDB, SalesInvoiceDB
from models_db import AuditLogDB

_ROW_ACTIONS = {"bill.created": "bill", "cheque.created": "cheque", "invoice.created": "invoice",
                "transfer.created": "transfer", "bank_fee.imported": "bank_fee"}
_ENTITY = re.compile(r"batch (\d+) row (.*)$", re.S)
_BANK_FEE = re.compile(r"^(.*)\|(\d+)\|(\d{4}-\d{2}-\d{2})\|([\d.]+) batch (\d+)$", re.S)


def batch_view(b: ImportBatchDB) -> Dict[str, Any]:
    return {"id": b.id, "kind": b.kind, "created_at": b.created_at.isoformat() if b.created_at else None,
            "manifest_name": b.manifest_name, "archive_name": b.archive_name, "rows_total": b.rows_total,
            "rows_created": b.rows_created, "rows_failed": b.rows_failed}


def list_batches(db: Session, kind: Optional[str], date_from: Optional[str], date_to: Optional[str],
                 limit: int, offset: int) -> List[Dict[str, Any]]:
    q = db.query(ImportBatchDB)
    if kind:
        q = q.filter(ImportBatchDB.kind == kind)
    if date_from:
        q = q.filter(ImportBatchDB.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(ImportBatchDB.created_at < datetime.fromisoformat(date_to) + timedelta(days=1))
    return [batch_view(b) for b in q.order_by(ImportBatchDB.id.desc()).offset(offset).limit(limit).all()]


def _label(db: Session, entity: str, entity_id: int) -> Optional[str]:
    if entity == "bill":
        row = db.get(BillDB, entity_id)
        return row.bill_number if row else None
    if entity == "cheque":
        row = db.get(FinanceChequeDB, entity_id)
        return row.cheque_number if row else None
    if entity == "invoice":
        row = db.get(SalesInvoiceDB, entity_id)
        return row.invoice_number if row else None
    if entity == "transfer":
        row = db.get(AccountTransferDB, entity_id)
        return f"{row.date} {row.from_amount:.2f} {row.from_currency}" if row else None
    row = db.get(LedgerTransactionDB, entity_id)
    return f"{row.date} {row.amount:.2f} {row.currency}" if row else None


def batch_rows(db: Session, batch_id: int, limit: int, offset: int) -> Optional[Tuple[Dict[str, Any], int, List[Dict[str, Any]]]]:
    """(batch, matching rows, a page of rows), or None when the batch does not exist."""
    batch = db.get(ImportBatchDB, batch_id)
    if batch is None:
        return None
    entries = (db.query(AuditLogDB)
               .filter(AuditLogDB.action.in_(list(_ROW_ACTIONS)),
                       (AuditLogDB.details.like(f"%batch {batch_id} row %")) | (AuditLogDB.details.like(f"% batch {batch_id}")))
               .order_by(AuditLogDB.id).all())
    rows: List[Dict[str, Any]] = []
    for e in entries:
        entity = _ROW_ACTIONS[e.action]
        details = e.details or ""
        if entity == "bank_fee":
            m = _BANK_FEE.match(details)
            if not m or int(m.group(5)) != batch_id:
                continue
            row_ref = m.group(1)
        else:
            m = _ENTITY.search(details)
            if not m or int(m.group(1)) != batch_id:
                continue
            row_ref = m.group(2).strip()
        try:
            entity_id = int(e.target_id)
        except (TypeError, ValueError):
            continue
        rows.append({"row_ref": row_ref, "created": entity, "id": entity_id, "label": _label(db, entity, entity_id)})
    return batch_view(batch), len(rows), rows[offset:offset + limit]
