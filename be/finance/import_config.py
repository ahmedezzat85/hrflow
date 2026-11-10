"""
be/finance/import_config.py
Limits and constants for the bulk / historical import (D-033, plan 25 section 6).

The nginx request limit (25 MB) is not changed; these limits keep a run inside it and inside the 120 s proxy
timeout. Everything here is a plain constant so tests can monkeypatch it.
"""

KINDS = ("bills", "cheques", "invoices", "transfers")

# Permission that the target entity already requires (D-033): no new permission
KIND_PERMISSIONS = {
    "bills": "finance.bill.write",
    "cheques": "finance.account.write",
    "invoices": "finance.invoice.write",
    "transfers": "finance.account.write",  # the same key the transfer route requires
}

# Imported bills belong to this legal entity (the bill form defaults to Voyance Health Inc).
DEFAULT_LEGAL_ENTITY = "Voyance Egypt LLC"

# Warning code that marks a row which will post to the ledger on commit (paid bills, transfers). A commit that
# contains such rows must carry an explicit confirmation (D-052).
POSTING_CODE = "will_post_ledger"

MAX_DOCUMENTS_PER_RUN = 50
MAX_REQUEST_BYTES = 24 * 1024 * 1024  # nginx allows 25 MB
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_MANIFEST_BYTES = 2 * 1024 * 1024

# Zip-bomb guards: counted on the declared size and enforced again while reading
MAX_ARCHIVE_ENTRIES = 200
MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024

ALLOWED_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic")
# Entries the OS adds to a ZIP; ignored silently rather than reported as unreferenced files
JUNK_NAMES = (".ds_store", "thumbs.db", "desktop.ini")

# Cheque rows below this confidence get a warning (plan 25, I3)
LOW_CONFIDENCE_THRESHOLD = 0.8

KNOWN_CURRENCIES = ("EGP", "USD", "EUR", "GBP", "SAR", "AED")

LIMIT_HELP = "Split the batch into smaller runs or compress the PDF copies further, then try again."
