"""
be/finance/bill_payment_rules.py
Which payment types a vendor-bill payment may use, per source account type (D-018).

Cash accounts pay with Cash payment; bank accounts pay by Outgoing transfer, Cheque or Debit card.
Incoming, internal transfer, exchange, ATM withdrawal and bank-fee types are never allowed for a bill.
"""
from typing import Dict, FrozenSet

CASH = "CASH"
OUTBOUND_TRANS = "OUTBOUND_TRANS"
CHEQUE = "CHK"
DEBIT_CARD = "DEBIT_CARD"

BILL_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE: Dict[str, FrozenSet[str]] = {
    "cash": frozenset({CASH}),
    "bank": frozenset({OUTBOUND_TRANS, CHEQUE, DEBIT_CARD}),
}

ALL_BILL_PAYMENT_TYPE_CODES = frozenset().union(*BILL_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE.values())

# PaymentDB.method value recorded for each payment type
METHOD_BY_PAYMENT_TYPE_CODE: Dict[str, str] = {
    CASH: "cash",
    OUTBOUND_TRANS: "bank_transfer",
    CHEQUE: "cheque",
    DEBIT_CARD: "card",
}

DEFAULT_PAYMENT_TYPE_CODE_BY_ACCOUNT_TYPE: Dict[str, str] = {"cash": CASH, "bank": OUTBOUND_TRANS}


class BillPaymentError(ValueError):
    """A bill payment refused by a D-018 rule. `code` is the machine-readable reason."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message}
