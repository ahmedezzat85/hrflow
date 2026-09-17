"""
be/finance/services/statement_parsers.py
Bank statement parsers for CSV and PDF formats (Phase 6 / Phase 7).
Converts bank export files into normalized statement line records with
format validation, column mapping, fingerprinting, and error diagnosis.
"""
import io
import csv
import re
import hashlib
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

try:
    import pypdf
except ImportError:
    pypdf = None


def compute_file_fingerprint(content: bytes) -> str:
    """Compute SHA-256 hex digest of file payload for duplicate detection."""
    return hashlib.sha256(content).hexdigest()


def compute_line_fingerprint(
    date_str: str,
    amount: float,
    direction: str,
    reference: Optional[str] = None,
    description: Optional[str] = None,
) -> str:
    """Deterministic hash of a single statement row to detect duplicates within period."""
    raw = f"{date_str.strip()}|{round(amount, 2)}|{direction.lower()}|{(reference or '').strip()}|{(description or '').strip()[:80]}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def normalize_date_string(raw_date_str: str, date_format: str = "auto") -> Optional[str]:
    """Parse date string into canonical YYYY-MM-DD format."""
    cleaned = (raw_date_str or "").strip()
    if not cleaned:
        return None

    # Explicit format matching if selected
    fmt_map = {
        "YYYY-MM-DD": "%Y-%m-%d",
        "DD/MM/YYYY": "%d/%m/%Y",
        "MM/DD/YYYY": "%m/%d/%Y",
        "DD-MM-YYYY": "%d-%m-%Y",
        "DD.MM.YYYY": "%d.%m.%Y",
        "YYYY/MM/DD": "%Y/%m/%d",
    }
    if date_format in fmt_map:
        try:
            dt = datetime.strptime(cleaned, fmt_map[date_format])
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            return None

    # Auto format fallbacks
    common_formats = [
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%d-%m-%Y",
        "%d.%m.%Y",
        "%Y/%m/%d",
        "%d-%b-%Y",
        "%d %b %Y",
    ]
    for fmt in common_formats:
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue

    # Regex fallback for YYYY-MM-DD
    match = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", cleaned)
    if match:
        y, m, d = match.groups()
        try:
            dt = datetime(int(y), int(m), int(d))
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass

    return None


def parse_amount(val_str: Any, decimal_separator: str = ".") -> Optional[float]:
    """Clean monetary string into float respecting decimal conventions."""
    if isinstance(val_str, (int, float)):
        return float(val_str)
    if not val_str:
        return None

    s = str(val_str).strip()
    # Strip currency signs & whitespace
    for cur in ["$", "£", "€", "EGP", "USD", "EUR", "GBP"]:
        s = s.replace(cur, "")
    s = s.strip()

    # Handle accounting parentheses (100.00) -> -100.00
    is_negative = False
    if s.startswith("(") and s.endswith(")"):
        is_negative = True
        s = s[1:-1].strip()
    elif s.startswith("-"):
        is_negative = True
        s = s[1:].strip()
    elif s.endswith("-"):
        is_negative = True
        s = s[:-1].strip()

    # Normalize decimal separator
    if decimal_separator == ",":
        # e.g. "1.250,50" -> "1250.50"
        s = s.replace(".", "").replace(",", ".")
    else:
        # e.g. "1,250.50" -> "1250.50"
        s = s.replace(",", "")

    try:
        val = float(s)
        return -abs(val) if is_negative else val
    except ValueError:
        return None


class CSVStatementParser:
    """Parses bank statement CSV files with auto-detection and custom column mapping."""

    DATE_ALIASES = ["date", "posting date", "transaction date", "booking date", "value date", "valuta"]
    DESC_ALIASES = ["description", "narrative", "details", "memo", "particulars", "payee", "transaction description"]
    DEBIT_ALIASES = ["debit", "withdrawal", "outflow", "dr", "paid out", "debit amount"]
    CREDIT_ALIASES = ["credit", "deposit", "inflow", "cr", "paid in", "credit amount"]
    AMOUNT_ALIASES = ["amount", "transaction amount", "net amount"]
    REF_ALIASES = ["reference", "ref", "cheque number", "check no", "trans id", "reference number", "ref no"]

    @classmethod
    def parse_with_validation(
        cls,
        content: bytes,
        mapping: Optional[Dict[str, Optional[str]]] = None,
        encoding: str = "utf-8",
        date_format: str = "auto",
        decimal_separator: str = ".",
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str], Dict[str, Optional[str]]]:
        """
        Parses CSV statement and validates rows without persisting them.
        Returns:
            (valid_lines, error_items, detected_headers, suggested_mapping)
        """
        enc_to_try = [encoding, "utf-8-sig", "utf-8", "iso-8859-1", "windows-1252", "latin-1"]
        text = ""
        for enc in enc_to_try:
            try:
                text = content.decode(enc)
                break
            except Exception:
                continue

        if not text:
            text = content.decode("utf-8", errors="replace")

        f = io.StringIO(text)
        reader = csv.reader(f)
        rows = list(reader)
        if not rows:
            return [], [], [], {}

        # 1. Locate header row
        header_idx = -1
        for i, row in enumerate(rows[:15]):
            lowered = [c.strip().lower() for c in row if c.strip()]
            if any(alias in lowered for alias in cls.DATE_ALIASES) and (
                any(alias in lowered for alias in cls.AMOUNT_ALIASES)
                or any(alias in lowered for alias in cls.DEBIT_ALIASES)
                or any(alias in lowered for alias in cls.CREDIT_ALIASES)
            ):
                header_idx = i
                break

        if header_idx == -1:
            header_idx = 0

        header_row = rows[header_idx]
        raw_headers = [c.strip() for c in header_row if c.strip()]
        col_map: Dict[str, int] = {}
        for col_i, col_name in enumerate(header_row):
            norm = col_name.strip().lower()
            if norm:
                col_map[norm] = col_i

        # Auto-detect column mapping
        suggested: Dict[str, Optional[str]] = {}
        for k, aliases in [
            ("date_col", cls.DATE_ALIASES),
            ("description_col", cls.DESC_ALIASES),
            ("debit_col", cls.DEBIT_ALIASES),
            ("credit_col", cls.CREDIT_ALIASES),
            ("amount_col", cls.AMOUNT_ALIASES),
            ("reference_col", cls.REF_ALIASES),
        ]:
            for alias in aliases:
                if alias in col_map:
                    suggested[k] = header_row[col_map[alias]].strip()
                    break

        # Resolve columns by custom mapping or suggested
        active_map = mapping or suggested or {}

        def find_col_idx(field_key: str, custom_name: Optional[str], aliases: List[str]) -> Optional[int]:
            if custom_name and custom_name.strip().lower() in col_map:
                return col_map[custom_name.strip().lower()]
            for alias in aliases:
                if alias in col_map:
                    return col_map[alias]
            return None

        date_col = find_col_idx("date_col", active_map.get("date_col"), cls.DATE_ALIASES)
        desc_col = find_col_idx("description_col", active_map.get("description_col"), cls.DESC_ALIASES)
        debit_col = find_col_idx("debit_col", active_map.get("debit_col"), cls.DEBIT_ALIASES)
        credit_col = find_col_idx("credit_col", active_map.get("credit_col"), cls.CREDIT_ALIASES)
        amount_col = find_col_idx("amount_col", active_map.get("amount_col"), cls.AMOUNT_ALIASES)
        ref_col = find_col_idx("reference_col", active_map.get("reference_col"), cls.REF_ALIASES)

        valid_lines: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []

        seen_fingerprints: Dict[str, int] = {}

        for row_num, row in enumerate(rows[header_idx + 1:], start=header_idx + 2):
            if not row or not any(c.strip() for c in row):
                continue

            # Extract date
            raw_date_val = row[date_col].strip() if date_col is not None and date_col < len(row) else ""
            normalized_date = normalize_date_string(raw_date_val, date_format=date_format)
            if not normalized_date:
                errors.append({
                    "row_index": row_num,
                    "column": active_map.get("date_col") or "Date",
                    "value": raw_date_val,
                    "message": f"Invalid date format '{raw_date_val}' on line {row_num}.",
                    "correction_path": "Check the Date Column Mapping or adjust Date Format selection (e.g. DD/MM/YYYY vs YYYY-MM-DD).",
                })
                continue

            # Extract description and reference
            raw_desc = row[desc_col].strip() if desc_col is not None and desc_col < len(row) else "Transaction"
            raw_ref = row[ref_col].strip() if ref_col is not None and ref_col < len(row) else ""

            # Extract amounts
            amount: Optional[float] = None
            direction = "out"
            amount_parsed = False

            # Case A: Separate debit & credit columns
            if debit_col is not None and debit_col < len(row) and row[debit_col].strip():
                d_val = parse_amount(row[debit_col], decimal_separator=decimal_separator)
                if d_val is None:
                    errors.append({
                        "row_index": row_num,
                        "column": active_map.get("debit_col") or "Debit",
                        "value": row[debit_col],
                        "message": f"Malformed debit amount '{row[debit_col]}' on row {row_num}.",
                        "correction_path": "Verify the decimal separator or check if column contains non-numeric text.",
                    })
                    continue
                if d_val != 0.0:
                    amount = abs(d_val)
                    direction = "out"
                    amount_parsed = True

            if credit_col is not None and credit_col < len(row) and row[credit_col].strip():
                c_val = parse_amount(row[credit_col], decimal_separator=decimal_separator)
                if c_val is None:
                    errors.append({
                        "row_index": row_num,
                        "column": active_map.get("credit_col") or "Credit",
                        "value": row[credit_col],
                        "message": f"Malformed credit amount '{row[credit_col]}' on row {row_num}.",
                        "correction_path": "Verify the decimal separator or check if column contains non-numeric text.",
                    })
                    continue
                if c_val != 0.0:
                    amount = abs(c_val)
                    direction = "in"
                    amount_parsed = True

            # Case B: Combined signed amount column
            if not amount_parsed and amount_col is not None and amount_col < len(row) and row[amount_col].strip():
                a_val = parse_amount(row[amount_col], decimal_separator=decimal_separator)
                if a_val is None:
                    errors.append({
                        "row_index": row_num,
                        "column": active_map.get("amount_col") or "Amount",
                        "value": row[amount_col],
                        "message": f"Malformed amount '{row[amount_col]}' on row {row_num}.",
                        "correction_path": "Check if amount column includes unexpected characters or wrong decimal separator.",
                    })
                    continue
                if a_val < 0:
                    amount = abs(a_val)
                    direction = "out"
                    amount_parsed = True
                elif a_val > 0:
                    amount = a_val
                    direction = "in"
                    amount_parsed = True

            if amount is None or amount <= 0:
                errors.append({
                    "row_index": row_num,
                    "column": "Amount",
                    "value": str(row),
                    "message": f"No valid transaction amount found on row {row_num}.",
                    "correction_path": "Ensure the Debit/Credit or Net Amount columns are correctly mapped.",
                })
                continue

            # Compute row fingerprint for duplicate detection
            line_fp = compute_line_fingerprint(normalized_date, amount, direction, raw_ref, raw_desc)
            is_dup_in_file = line_fp in seen_fingerprints
            seen_fingerprints[line_fp] = row_num

            valid_lines.append({
                "row_index": row_num,
                "raw_date": normalized_date,
                "raw_amount": round(amount, 2),
                "direction": direction,
                "raw_description": raw_desc[:500],
                "raw_reference": raw_ref[:100],
                "line_fingerprint": line_fp,
                "is_duplicate": is_dup_in_file,
                "is_valid": True,
            })

        return valid_lines, errors, raw_headers, suggested

    @classmethod
    def parse(cls, content: bytes, mapping: Optional[Dict[str, Optional[str]]] = None) -> List[Dict[str, Any]]:
        """Legacy helper preserving exact compatibility."""
        valid, _, _, _ = cls.parse_with_validation(content, mapping=mapping)
        return valid


class PDFStatementParser:
    """Best-effort PDF statement extractor. Explicitly review-required; never auto-confirmed."""

    @classmethod
    def parse_with_validation(
        cls, content: bytes
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str], Dict[str, Optional[str]]]:
        if not pypdf:
            return [], [{"row_index": 0, "column": "PDF", "value": "", "message": "pypdf library is not installed.", "correction_path": "Install pypdf or convert statement to CSV."}], [], {}

        try:
            reader = pypdf.PdfReader(io.BytesIO(content))
            full_text = ""
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    full_text += "\n" + text
        except Exception as e:
            return [], [{"row_index": 0, "column": "PDF", "value": "", "message": f"Failed to extract PDF text: {str(e)}", "correction_path": "Ensure the PDF is an electronic statement rather than a raster scan image."}], [], {}

        parsed_lines: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []

        line_pattern = re.compile(
            r"(?P<date>\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+"
            r"(?P<desc>.+?)\s+"
            r"(?P<sign>-|\+)?(?P<curr>[\$€£]|EGP\s*)?(?P<amount>\d{1,3}(?:,\d{3})*(?:\.\d{2}))(?:\s+(?P<dir>CR|DR))?",
            re.IGNORECASE,
        )

        seen_fingerprints: Dict[str, int] = {}
        row_idx = 1
        for line in full_text.splitlines():
            line_str = line.strip()
            if not line_str:
                continue

            m = line_pattern.search(line_str)
            if m:
                raw_date = normalize_date_string(m.group("date"))
                if not raw_date:
                    errors.append({
                        "row_index": row_idx,
                        "column": "Date",
                        "value": m.group("date"),
                        "message": f"Could not normalize PDF date '{m.group('date')}'.",
                        "correction_path": "Manual review of PDF text line required.",
                    })
                    row_idx += 1
                    continue

                desc = m.group("desc").strip()
                amt_val = parse_amount(m.group("amount"))
                if amt_val is None or amt_val <= 0:
                    errors.append({
                        "row_index": row_idx,
                        "column": "Amount",
                        "value": m.group("amount"),
                        "message": f"Invalid amount '{m.group('amount')}' in PDF text.",
                        "correction_path": "Check PDF extraction fidelity.",
                    })
                    row_idx += 1
                    continue

                sign = m.group("sign")
                direction_tag = (m.group("dir") or "").upper()
                if direction_tag == "CR":
                    direction = "in"
                elif direction_tag == "DR":
                    direction = "out"
                elif sign == "-":
                    direction = "out"
                elif sign == "+":
                    direction = "in"
                else:
                    direction = "out"

                line_fp = compute_line_fingerprint(raw_date, amt_val, direction, "", desc)
                is_dup = line_fp in seen_fingerprints
                seen_fingerprints[line_fp] = row_idx

                parsed_lines.append({
                    "row_index": row_idx,
                    "raw_date": raw_date,
                    "raw_amount": round(amt_val, 2),
                    "direction": direction,
                    "raw_description": desc[:500],
                    "raw_reference": "",
                    "line_fingerprint": line_fp,
                    "is_duplicate": is_dup,
                    "is_valid": True,
                })
                row_idx += 1

        return parsed_lines, errors, ["Date", "Description", "Amount", "Direction"], {}

    @classmethod
    def parse(cls, content: bytes) -> List[Dict[str, Any]]:
        valid, _, _, _ = cls.parse_with_validation(content)
        return valid
