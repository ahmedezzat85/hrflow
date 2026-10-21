"""
be/file_layout.py
Unified file-storage root and standard folder layout for HRFlow.

Governed by docs/file-storage/26-file-storage-layout-plan.md (decisions 1-9 in §8).
Single root setting: HRFLOW_FILES_ROOT (resolved at call time, not at import time).
Root-relative POSIX refs, Windows-safe slugs and filenames, path traversal protection,
symlink escape guards, and legacy fallback resolvers.
"""
import datetime
import json
import logging
import os
import posixpath
import re
import unicodedata
import uuid
from typing import Any, BinaryIO, Dict, Optional, Tuple, Union

logger = logging.getLogger("file_layout")

_BE_DIR = os.path.dirname(os.path.abspath(__file__))

WINDOWS_RESERVED_NAMES = {
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
}

MAX_SLUG_LENGTH = 40
MAX_REF_LENGTH = 200
LAYOUT_VERSION = 1


def get_files_root() -> str:
    """
    Resolves the file storage root directory at call time.
    Checks HRFLOW_FILES_ROOT first, falling back to LOCAL_STORAGE_PATH,
    and finally defaulting to be/storage.
    """
    configured = (os.environ.get("HRFLOW_FILES_ROOT") or "").strip()
    if configured:
        return os.path.abspath(configured)

    legacy_local = (os.environ.get("LOCAL_STORAGE_PATH") or "").strip()
    if legacy_local:
        logger.warning(
            "LOCAL_STORAGE_PATH is deprecated; use HRFLOW_FILES_ROOT instead (path=%s)",
            legacy_local,
        )
        return os.path.abspath(legacy_local)

    # Log deprecation if only BILL_UPLOADS_DIR or FINANCE_UPLOADS_DIR is set
    for legacy_var in ("BILL_UPLOADS_DIR", "FINANCE_UPLOADS_DIR"):
        val = (os.environ.get(legacy_var) or "").strip()
        if val:
            logger.warning(
                "%s is deprecated; finance files now live under HRFLOW_FILES_ROOT (val=%s)",
                legacy_var, val,
            )

    return os.path.abspath(os.path.join(_BE_DIR, "storage"))


def ensure_meta(root: Optional[str] = None) -> None:
    """
    Ensures _meta/layout.json and _meta/README.txt exist under the root.
    """
    target_root = root or get_files_root()
    meta_dir = os.path.join(target_root, "_meta")
    os.makedirs(meta_dir, exist_ok=True)

    layout_json_path = os.path.join(meta_dir, "layout.json")
    if not os.path.exists(layout_json_path):
        try:
            with open(layout_json_path, "w", encoding="utf-8") as f:
                json.dump({"layout_version": LAYOUT_VERSION}, f, indent=2)
        except OSError as e:
            logger.warning("Could not write %s: %s", layout_json_path, e)

    readme_path = os.path.join(meta_dir, "README.txt")
    if not os.path.exists(readme_path):
        try:
            with open(readme_path, "w", encoding="utf-8") as f:
                f.write("Managed by HRFlow. Do not rename or move files; the database points here.\n")
        except OSError as e:
            logger.warning("Could not write %s: %s", readme_path, e)


def slugify(text: Optional[str], max_length: int = MAX_SLUG_LENGTH) -> str:
    """
    Produces a Windows-safe, lowercase ASCII slug.
    - Accents removed via NFKD normalization
    - Characters outside [a-z0-9] replaced with hyphens
    - Hyphens deduplicated and stripped from ends
    - No trailing dot or space
    - Reserved Windows device names prefixed
    - Length clamped to max_length
    """
    if not text:
        return "unknown"

    # NFKD normalization to strip accents
    norm = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    lowered = norm.lower()

    # Replace invalid chars with hyphen
    cleaned = re.sub(r"[^a-z0-9]+", "-", lowered)
    cleaned = cleaned.strip("-._ ")

    if not cleaned:
        cleaned = "item"

    # Truncate to max_length and strip trailing hyphens/dots
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length].rstrip("-._ ")

    if not cleaned:
        cleaned = "item"

    # Windows reserved name check
    if cleaned in WINDOWS_RESERVED_NAMES:
        cleaned = f"_{cleaned}"

    return cleaned


def sanitize_filename(filename: Optional[str], max_length: int = 80) -> str:
    """
    Sanitizes a filename to be safe on Windows and across filesystems.
    Preserves the file extension if present.
    """
    base = os.path.basename(filename or "document")
    name_part, ext_part = os.path.splitext(base)
    ext = ext_part.lstrip(".").lower()
    ext = re.sub(r"[^a-z0-9]", "", ext)

    ext_len = len(ext) + 1 if ext else 0
    available_name_len = max(10, max_length - ext_len)

    safe_name = slugify(name_part, max_length=available_name_len)
    if ext:
        return f"{safe_name}.{ext}"
    return safe_name


def build_account_folder(
    account_id: Union[int, str],
    bank_name: Optional[str] = None,
    currency: Optional[str] = None,
    account_name: Optional[str] = None,
) -> str:
    """
    Builds the company bank/cash account folder name:
    - Bank account: <id>-<bank-slug>-<currency> (e.g. '7-cib-usd')
    - Cash account (no bank name): <id>-<account-name-slug> (e.g. '2-cash-egp')
    """
    clean_id = str(account_id).strip()
    bank_str = (bank_name or "").strip()

    if bank_str:
        bank_slug = slugify(bank_str, max_length=25)
        curr_slug = slugify(currency or "egp", max_length=10)
        return f"{clean_id}-{bank_slug}-{curr_slug}"

    name_str = (account_name or "").strip() or "cash"
    name_slug = slugify(name_str, max_length=35)
    return f"{clean_id}-{name_slug}"


def _extract_year_month(
    year: Optional[int] = None,
    month: Optional[int] = None,
    date: Optional[Union[str, datetime.date, datetime.datetime]] = None,
) -> Tuple[str, str]:
    """
    Extracts (yyyy, yyyy-mm) string tuple from year, month, or date object/string.
    Defaults to current UTC year and month if not provided.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    target_year = now.year
    target_month = now.month

    if date:
        if isinstance(date, (datetime.date, datetime.datetime)):
            target_year = date.year
            target_month = date.month
        elif isinstance(date, str):
            clean_date = date.strip()
            m = re.match(r"^(\d{4})(?:-(\d{1,2}))?", clean_date)
            if m:
                target_year = int(m.group(1))
                if m.group(2):
                    target_month = int(m.group(2))

    if year is not None:
        target_year = int(year)
    if month is not None:
        target_month = int(month)

    yyyy = f"{target_year:04d}"
    yyyy_mm = f"{target_year:04d}-{target_month:02d}"
    return yyyy, yyyy_mm


def _clamp_ref_length(ref: str) -> str:
    """
    Clamps the total POSIX ref length to MAX_REF_LENGTH (200 chars),
    truncating the filename stem if necessary while preserving directory and extension.
    """
    if len(ref) <= MAX_REF_LENGTH:
        return ref

    dir_part, filename = posixpath.split(ref)
    stem, ext = posixpath.splitext(filename)

    max_filename_len = MAX_REF_LENGTH - len(dir_part) - 1
    if max_filename_len <= len(ext) + 3:
        stem = stem[:5]
        return f"{dir_part}/{stem}{ext}"[:MAX_REF_LENGTH]

    allowed_stem_len = max_filename_len - len(ext)
    trimmed_stem = stem[:allowed_stem_len].rstrip("-._ ")
    if not trimmed_stem:
        trimmed_stem = "file"
    return f"{dir_part}/{trimmed_stem}{ext}"


def build_ref(kind: str, **ctx: Any) -> str:
    """
    Pure function to construct a root-relative POSIX ref according to §4 layout.
    
    Supported kinds:
    - "bill": finance/<yyyy>/bills/<yyyy-mm>/bill-<id>__<vendor-slug>.<ext>
    - "sales_invoice": finance/<yyyy>/sales-invoices/<yyyy-mm>/inv-<id>__<customer-slug>.<ext>
    - "cheque": finance/<yyyy>/cheques/<account-folder>/chq-<number>__<att_id>.<ext>
    - "statement": finance/<yyyy>/statements/<account-folder>/<yyyy-mm>__<att_id>.<ext>
    - "subscription_proof": finance/<yyyy>/subscriptions/<id>-<slug>/<charge-date>__proof-<att_id>.<ext>
    - "ledger_attachment": finance/<yyyy>/ledger-attachments/<yyyy-mm>/txn-<id>__<att_id>.<ext>
    - "balance_checkpoint": finance/<yyyy>/balance-checkpoints/<account-folder>/chkpt-<checkpoint_id>__<att_id>.<ext>
    - "import_batch": finance/imports/<batch-id>/<clean-filename>
    - "employee_document": hr/employees/<employee_id>-<name-slug>/documents/<safe_name>
    - "employee_bank_proof": hr/employees/<employee_id>-<name-slug>/bank-account-proofs/<safe_name>
    - "salary_payment_doc": hr/salary-payment-docs/<yyyy>/<yyyy-mm>/<doc_number>__<employee_id>-<slug>.<ext>
    - "company_document": hr/company-documents/<safe_name>
    """
    yyyy, yyyy_mm = _extract_year_month(
        year=ctx.get("year"),
        month=ctx.get("month"),
        date=ctx.get("date") or ctx.get("period"),
    )
    ext = (ctx.get("ext") or "pdf").lstrip(".").lower()
    ext = re.sub(r"[^a-z0-9]", "", ext)
    ext_suffix = f".{ext}" if ext else ""

    if kind == "bill":
        bill_id = str(ctx.get("bill_id", ctx.get("id", ""))).strip()
        vendor_slug = slugify(ctx.get("vendor_slug", ctx.get("vendor_name", "vendor")), max_length=30)
        ref = f"finance/{yyyy}/bills/{yyyy_mm}/bill-{bill_id}__{vendor_slug}{ext_suffix}"

    elif kind == "sales_invoice":
        inv_id = str(ctx.get("invoice_id", ctx.get("id", ""))).strip()
        customer_slug = slugify(ctx.get("customer_slug", ctx.get("customer_name", "customer")), max_length=30)
        ref = f"finance/{yyyy}/sales-invoices/{yyyy_mm}/inv-{inv_id}__{customer_slug}{ext_suffix}"

    elif kind == "cheque":
        account_folder = ctx.get("account_folder")
        if not account_folder:
            account_folder = build_account_folder(
                account_id=ctx.get("account_id", 0),
                bank_name=ctx.get("bank_name"),
                currency=ctx.get("currency"),
                account_name=ctx.get("account_name"),
            )
        chq_num = slugify(str(ctx.get("cheque_number", ctx.get("number", "chq"))), max_length=20)
        att_id = str(ctx.get("att_id", ctx.get("id", "0"))).strip()
        ref = f"finance/{yyyy}/cheques/{account_folder}/chq-{chq_num}__{att_id}{ext_suffix}"

    elif kind == "statement":
        account_folder = ctx.get("account_folder")
        if not account_folder:
            account_folder = build_account_folder(
                account_id=ctx.get("account_id", 0),
                bank_name=ctx.get("bank_name"),
                currency=ctx.get("currency"),
                account_name=ctx.get("account_name"),
            )
        period = ctx.get("period") or yyyy_mm
        att_id = str(ctx.get("att_id", ctx.get("id", "0"))).strip()
        ref = f"finance/{yyyy}/statements/{account_folder}/{period}__{att_id}{ext_suffix}"

    elif kind == "subscription_proof":
        sub_id = str(ctx.get("subscription_id", ctx.get("id", "0"))).strip()
        sub_slug = slugify(ctx.get("slug", ctx.get("name", "subscription")), max_length=25)
        charge_date = ctx.get("charge_date") or yyyy_mm
        if isinstance(charge_date, (datetime.date, datetime.datetime)):
            charge_date = charge_date.strftime("%Y-%m-%d")
        charge_date_slug = slugify(str(charge_date), max_length=15)
        att_id = str(ctx.get("att_id", "0")).strip()
        ref = f"finance/{yyyy}/subscriptions/{sub_id}-{sub_slug}/{charge_date_slug}__proof-{att_id}{ext_suffix}"

    elif kind == "ledger_attachment":
        txn_id = str(ctx.get("transaction_id", ctx.get("id", "0"))).strip()
        att_id = str(ctx.get("att_id", "0")).strip()
        ref = f"finance/{yyyy}/ledger-attachments/{yyyy_mm}/txn-{txn_id}__{att_id}{ext_suffix}"

    elif kind == "balance_checkpoint":
        account_folder = ctx.get("account_folder")
        if not account_folder:
            account_folder = build_account_folder(
                account_id=ctx.get("account_id", 0),
                bank_name=ctx.get("bank_name"),
                currency=ctx.get("currency"),
                account_name=ctx.get("account_name"),
            )
        chkpt_id = str(ctx.get("checkpoint_id", ctx.get("id", "0"))).strip()
        att_id = str(ctx.get("att_id", "0")).strip()
        ref = f"finance/{yyyy}/balance-checkpoints/{account_folder}/chkpt-{chkpt_id}__{att_id}{ext_suffix}"

    elif kind == "import_batch":
        batch_id = str(ctx.get("batch_id", "0")).strip()
        filename = ctx.get("filename")
        if filename:
            safe_file = sanitize_filename(filename, max_length=50)
        else:
            att_id = str(ctx.get("att_id", "0")).strip()
            safe_file = f"import-{att_id}{ext_suffix}"
        ref = f"finance/imports/{batch_id}/{safe_file}"

    elif kind == "employee_document":
        emp_id = str(ctx.get("employee_id", "0")).strip()
        emp_slug = slugify(ctx.get("employee_name", "employee"), max_length=30)
        filename = ctx.get("filename") or f"doc{ext_suffix}"
        safe_file = sanitize_filename(filename, max_length=50)
        ref = f"hr/employees/{emp_id}-{emp_slug}/documents/{safe_file}"

    elif kind == "employee_bank_proof":
        emp_id = str(ctx.get("employee_id", "0")).strip()
        emp_slug = slugify(ctx.get("employee_name", "employee"), max_length=30)
        filename = ctx.get("filename") or f"bank-proof{ext_suffix}"
        safe_file = sanitize_filename(filename, max_length=50)
        ref = f"hr/employees/{emp_id}-{emp_slug}/bank-account-proofs/{safe_file}"

    elif kind == "salary_payment_doc":
        doc_num = slugify(str(ctx.get("doc_number", "doc")), max_length=25)
        emp_id = str(ctx.get("employee_id", "0")).strip()
        emp_slug = slugify(ctx.get("employee_name", ctx.get("slug", "employee")), max_length=25)
        ref = f"hr/salary-payment-docs/{yyyy}/{yyyy_mm}/{doc_num}__{emp_id}-{emp_slug}{ext_suffix}"

    elif kind == "company_document":
        filename = ctx.get("filename") or f"document{ext_suffix}"
        safe_file = sanitize_filename(filename, max_length=60)
        ref = f"hr/company-documents/{safe_file}"

    else:
        raise ValueError(f"Unknown file layout kind: '{kind}'")

    return _clamp_ref_length(ref)


def _find_in_legacy_dirs(ref: str, root: str) -> Optional[str]:
    """
    Checks legacy fallback locations for unmigrated files:
    1. Direct subdirectories under root (e.g. root/finance_bills, root/Invoices)
    2. Legacy environment upload dirs (BILL_UPLOADS_DIR, FINANCE_UPLOADS_DIR, LOCAL_STORAGE_PATH)
    3. Historical default uploads under be/uploads/
    """
    norm_ref = ref.replace("\\", "/").lstrip("/")
    base_name = os.path.basename(norm_ref)

    # 1. Locations under root
    root_candidates = [
        os.path.join(root, norm_ref),
        os.path.join(root, "finance_bills", norm_ref),
        os.path.join(root, "finance_bills", base_name),
        os.path.join(root, "finance_attachments", norm_ref),
        os.path.join(root, "finance_attachments", base_name),
        os.path.join(root, "employees", norm_ref),
        os.path.join(root, "Invoices", norm_ref),
        os.path.join(root, "Company Documents", norm_ref),
        os.path.join(root, "Company Documents", base_name),
    ]
    for cand in root_candidates:
        if os.path.isfile(cand):
            return os.path.abspath(cand)

    # 2. Configured legacy env dirs
    bill_env = (os.environ.get("BILL_UPLOADS_DIR") or "").strip()
    fin_env = (os.environ.get("FINANCE_UPLOADS_DIR") or "").strip()
    local_env = (os.environ.get("LOCAL_STORAGE_PATH") or "").strip()

    env_dirs = [p for p in (bill_env, fin_env, local_env) if p]
    for ed in env_dirs:
        for cand in (os.path.join(ed, norm_ref), os.path.join(ed, base_name)):
            if os.path.isfile(cand):
                return os.path.abspath(cand)

    # 3. Default repo paths (be/uploads and be/storage)
    repo_dirs = [
        os.path.join(_BE_DIR, "uploads", "finance_bills"),
        os.path.join(_BE_DIR, "uploads", "finance_attachments"),
        os.path.join(_BE_DIR, "storage"),
    ]
    for rd in repo_dirs:
        for cand in (os.path.join(rd, norm_ref), os.path.join(rd, base_name)):
            if os.path.isfile(cand):
                return os.path.abspath(cand)

    return None


def resolve_path(
    storage_ref: str,
    root: Optional[str] = None,
    must_exist: bool = False,
) -> str:
    """
    Resolves a storage reference to an absolute filesystem path.
    Guards against path traversal ('..') and symlink escapes outside the root.
    Falls back to legacy locations if the file is not yet at the layout-v1 path.
    """
    if not storage_ref or not str(storage_ref).strip():
        raise ValueError("storage_ref cannot be empty")

    raw_ref = str(storage_ref).strip()
    clean_posix = raw_ref.replace("\\", "/")

    # Path traversal check
    segments = [s for s in clean_posix.split("/") if s]
    if ".." in segments:
        raise ValueError(f"Security error: Invalid path traversal attempt '{storage_ref}'")

    target_root = os.path.abspath(root or get_files_root())

    # Handle absolute legacy paths
    is_absolute = os.path.isabs(raw_ref) or (len(raw_ref) > 1 and raw_ref[1] == ":") or raw_ref.startswith("/") or raw_ref.startswith("\\")
    if is_absolute:
        abs_candidate = os.path.abspath(raw_ref)
        if os.path.isfile(abs_candidate):
            return abs_candidate
        # Check legacy directories by basename if absolute file not found at original path
        legacy_found = _find_in_legacy_dirs(abs_candidate, target_root)
        if legacy_found:
            return legacy_found
        if must_exist:
            raise FileNotFoundError(f"File not found: {storage_ref}")
        return abs_candidate

    # Relative path resolution against target_root
    clean_rel = os.path.normpath(clean_posix).lstrip("/\\")
    resolved = os.path.abspath(os.path.join(target_root, clean_rel))

    # Boundary check (resolved must be within target_root)
    try:
        common = os.path.commonpath([target_root, resolved])
    except ValueError:
        raise ValueError(f"Security error: Invalid path traversal attempt '{storage_ref}'")

    if common != target_root:
        raise ValueError(f"Security error: Invalid path traversal attempt '{storage_ref}'")

    # Symlink escape check
    if os.path.islink(resolved):
        real_cand = os.path.realpath(resolved)
        real_root = os.path.realpath(target_root)
        try:
            common_real = os.path.commonpath([real_root, real_cand])
        except ValueError:
            raise ValueError(f"Security error: Symlink escape attempt '{storage_ref}'")
        if common_real != real_root:
            raise ValueError(f"Security error: Symlink escape attempt '{storage_ref}'")

    # If the file exists at the expected new path, return it
    if os.path.isfile(resolved):
        return resolved

    # Check legacy fallbacks
    legacy_found = _find_in_legacy_dirs(clean_rel, target_root)
    if legacy_found:
        return legacy_found

    if must_exist:
        raise FileNotFoundError(f"File not found: {storage_ref}")

    return resolved


def save_file(
    content: bytes,
    storage_ref: str,
    root: Optional[str] = None,
) -> str:
    """
    Saves binary content to the target storage_ref under root.
    Writes first to _incoming/ then atomically moves (os.replace) to the target path.
    Ensures _meta/layout.json exists and returns the normalized relative ref.
    """
    target_root = os.path.abspath(root or get_files_root())
    target_path = resolve_path(storage_ref, root=target_root, must_exist=False)

    ensure_meta(target_root)

    incoming_dir = os.path.join(target_root, "_incoming")
    os.makedirs(incoming_dir, exist_ok=True)

    tmp_filename = f"tmp_{uuid.uuid4().hex}"
    tmp_path = os.path.join(incoming_dir, tmp_filename)

    try:
        with open(tmp_path, "wb") as f:
            f.write(content)

        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        os.replace(tmp_path, target_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    logger.info("Saved file to %s (%d bytes)", target_path, len(content))
    return storage_ref.replace("\\", "/").lstrip("/")


def open_file(
    storage_ref: str,
    root: Optional[str] = None,
    mode: str = "rb",
) -> BinaryIO:
    """
    Opens the file corresponding to storage_ref for reading.
    Raises FileNotFoundError if the file cannot be found in layout or legacy locations.
    """
    path = resolve_path(storage_ref, root=root, must_exist=True)
    return open(path, mode)


def read_file(
    storage_ref: str,
    root: Optional[str] = None,
) -> bytes:
    """
    Reads and returns the bytes of the file for storage_ref.
    """
    path = resolve_path(storage_ref, root=root, must_exist=True)
    with open(path, "rb") as f:
        return f.read()


def exists_file(
    storage_ref: str,
    root: Optional[str] = None,
) -> bool:
    """
    Returns True if the file exists at the resolved path or legacy location.
    """
    try:
        path = resolve_path(storage_ref, root=root, must_exist=True)
        return os.path.isfile(path)
    except (FileNotFoundError, ValueError):
        return False


def delete_file(
    storage_ref: str,
    root: Optional[str] = None,
) -> bool:
    """
    Hard-deletes the file at storage_ref if it exists.
    Returns True if deleted, False if not found.
    Guarded against path traversal.
    """
    try:
        path = resolve_path(storage_ref, root=root, must_exist=True)
        if os.path.isfile(path):
            os.remove(path)
            logger.info("Deleted file at %s", path)
            return True
        return False
    except FileNotFoundError:
        return False
