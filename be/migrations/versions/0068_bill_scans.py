"""0068_bill_scans

Database redesign, Stage 6a: a bill's scanned document moves from two columns on the bill into a row of
finance_attachments, like cheques, sales invoices, statements and checkpoints already do.
  finance_attachments.bill_id          new, FK to finance_bills (CASCADE), unique: one scan per bill
  ck_finance_attachments_one_parent    now counts bill_id as a seventh parent
  finance_bills.attachment_url, attachment_name   copied into the new row, then dropped

The API keeps its `attachment_url` / `attachment_name` fields (the model exposes them from the attachment row). A bill with
a name but an empty reference (an upload still being processed) keeps its row with an empty storage reference. The file size
of an old scan is not known to the database and stays 0; the mime type is guessed from the name.

The downgrade copies the name and reference back, removes the bill rows and restores the six-parent rule.

Revision ID: 0068_bill_scans
Revises: 0067_date_checks
Create Date: 2026-11-07 10:00:00.000000

"""
import mimetypes
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0068_bill_scans'
down_revision: Union[str, None] = '0067_date_checks'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECK = "ck_finance_attachments_one_parent"
OLD_PARENTS = ("subscription_charge_id", "statement_import_id", "ledger_transaction_id", "cheque_id", "checkpoint_id", "sales_invoice_id")
NEW_PARENTS = OLD_PARENTS + ("bill_id",)


def _count_sql(parents) -> str:
    return "(" + " + ".join(f"CASE WHEN {p} IS NULL THEN 0 ELSE 1 END" for p in parents) + ") = 1"


def _replace_check(parents) -> None:
    existing = {c.get("name") for c in sa.inspect(op.get_bind()).get_check_constraints("finance_attachments")}
    with op.batch_alter_table("finance_attachments") as batch_op:
        if CHECK in existing:
            batch_op.drop_constraint(CHECK, type_="check")
        batch_op.create_check_constraint(CHECK, _count_sql(parents))


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "finance_attachments" not in tables:
        return
    att_cols = {c["name"] for c in insp.get_columns("finance_attachments")}
    # A database built by the migration chain can already have the bare column (0013 adds missing model columns), so add each part only when missing
    has_fk = any(fk["constrained_columns"] == ["bill_id"] for fk in insp.get_foreign_keys("finance_attachments"))
    has_index = any(i["column_names"] == ["bill_id"] and not i["unique"] for i in insp.get_indexes("finance_attachments"))
    if "bill_id" not in att_cols or not has_fk or not has_index:
        with op.batch_alter_table("finance_attachments") as batch_op:
            if "bill_id" not in att_cols:
                batch_op.add_column(sa.Column("bill_id", sa.Integer(), nullable=True))
            if not has_fk:
                batch_op.create_foreign_key("fk_finance_attachments_bill_id", "finance_bills", ["bill_id"], ["id"], ondelete="CASCADE")
            if not has_index:
                batch_op.create_index("ix_finance_attachments_bill_id", ["bill_id"])
    checks = {c.get("name"): c.get("sqltext", "") for c in sa.inspect(bind).get_check_constraints("finance_attachments")}
    if "bill_id" not in str(checks.get(CHECK, "")):    # before the copy: the old rule allows only six parents
        _replace_check(NEW_PARENTS)

    bill_cols = {c["name"] for c in sa.inspect(bind).get_columns("finance_bills")}
    if {"attachment_url", "attachment_name"} <= bill_cols:
        rows = bind.execute(sa.text(
            "SELECT b.id, b.attachment_name, b.attachment_url FROM finance_bills b "
            "WHERE (COALESCE(b.attachment_name, '') <> '' OR COALESCE(b.attachment_url, '') <> '') "
            "AND NOT EXISTS (SELECT 1 FROM finance_attachments a WHERE a.bill_id = b.id)")).fetchall()
        for bill_id, name, url in rows:
            file_name = name or (url or "").replace("\\", "/").rsplit("/", 1)[-1] or "bill_document"
            mime = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
            bind.execute(sa.text(
                "INSERT INTO finance_attachments (bill_id, file_name, file_size, mime_type, storage_ref, uploaded_by) "
                "VALUES (:b, :n, 0, :m, :r, 'migration 0068')"), {"b": bill_id, "n": file_name, "m": mime, "r": url or ""})
        with op.batch_alter_table("finance_bills") as batch_op:
            batch_op.drop_column("attachment_url")
            batch_op.drop_column("attachment_name")

    if "uq_finance_attachments_bill_id" not in {i["name"] for i in sa.inspect(bind).get_indexes("finance_attachments")}:
        op.create_index("uq_finance_attachments_bill_id", "finance_attachments", ["bill_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "finance_attachments" not in insp.get_table_names():
        return
    if "bill_id" not in {c["name"] for c in insp.get_columns("finance_attachments")}:
        return
    bill_cols = {c["name"] for c in insp.get_columns("finance_bills")}
    with op.batch_alter_table("finance_bills") as batch_op:
        if "attachment_url" not in bill_cols:
            batch_op.add_column(sa.Column("attachment_url", sa.String(500), nullable=True))
        if "attachment_name" not in bill_cols:
            batch_op.add_column(sa.Column("attachment_name", sa.String(255), nullable=True))
    bind.execute(sa.text(
        "UPDATE finance_bills SET "
        "attachment_name = (SELECT a.file_name FROM finance_attachments a WHERE a.bill_id = finance_bills.id), "
        "attachment_url = (SELECT a.storage_ref FROM finance_attachments a WHERE a.bill_id = finance_bills.id)"))
    bind.execute(sa.text("DELETE FROM finance_attachments WHERE bill_id IS NOT NULL"))
    _replace_check(OLD_PARENTS)
    insp = sa.inspect(bind)
    indexes = {i["name"] for i in insp.get_indexes("finance_attachments")}
    fks = {fk["name"] for fk in insp.get_foreign_keys("finance_attachments")}
    with op.batch_alter_table("finance_attachments") as batch_op:
        for name in ("uq_finance_attachments_bill_id", "ix_finance_attachments_bill_id"):
            if name in indexes:
                batch_op.drop_index(name)
        if "fk_finance_attachments_bill_id" in fks:
            batch_op.drop_constraint("fk_finance_attachments_bill_id", type_="foreignkey")
        batch_op.drop_column("bill_id")
