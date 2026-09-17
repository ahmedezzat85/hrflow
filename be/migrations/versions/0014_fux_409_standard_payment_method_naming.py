"""0014_fux_409_standard_payment_method_naming

Revision ID: 0014_fux_409_standard_payment_method_naming
Revises: 0013_finance_ux_schema_sync
Create Date: 2026-09-15 15:10:00.000000

"""
from typing import Sequence, Union
from datetime import datetime
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014_fux_409_standard_payment_method_naming'
down_revision: Union[str, None] = '0013_finance_ux_schema_sync'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (code, new_name, old_name)
PAYMENT_TYPE_RENAMES = [
    ("CASHWITHDRAW", "ATM Withdrawal", "Cash Withdrawal"),
    ("CHK", "Check Payment", "Cheque"),
    ("INTTRANS", "Internal Transfer", "Internal Transfer"),
    ("INBOUND_TRANS", "Incoming Transfer", "Inbound Transfer"),
    ("CASH", "Cash Payment", "Cash"),
    ("DEBIT_CARD", "Debit Card Payment", "Debit Card"),
    ("USDTOEGP", "Currency Exchange", "USD to EGP Conversion"),
    ("OUTBOUND_TRANS", "Outgoing Transfer", "Outbound Transfer"),
    ("BANK_FEES", "Bank Fee", "Bank Fees"),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_payment_types' in tables:
        for code, new_name, _ in PAYMENT_TYPE_RENAMES:
            # Check if row exists
            res = bind.execute(
                sa.text("SELECT id FROM finance_payment_types WHERE code = :code"),
                {"code": code}
            ).fetchone()

            if res:
                bind.execute(
                    sa.text("UPDATE finance_payment_types SET name = :new_name WHERE code = :code"),
                    {"new_name": new_name, "code": code}
                )
            else:
                # If row was missing for some reason, seed it
                req_chk = (code == "CHK")
                req_fee = (code == "BANK_FEES")
                bind.execute(
                    sa.text(
                        "INSERT INTO finance_payment_types (name, code, requires_cheque_number, requires_bank_fee_flag, is_active, created_at) "
                        "VALUES (:name, :code, :chk, :fee, 1, :now)"
                    ),
                    {"name": new_name, "code": code, "chk": req_chk, "fee": req_fee, "now": datetime.utcnow()}
                )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_payment_types' in tables:
        for code, _, old_name in PAYMENT_TYPE_RENAMES:
            bind.execute(
                sa.text("UPDATE finance_payment_types SET name = :old_name WHERE code = :code"),
                {"old_name": old_name, "code": code}
            )
