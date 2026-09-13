"""
be/finance/services/statement_parsers.py
Bank statement parsers for CSV and PDF formats (Phase 7).
Converts bank export files into normalized statement line records.
"""
import io
import csv
import re
from datetime import datetime
from typing import List, Dict, Any, Optional

try:
    import pypdf
except ImportError:
    pypdf = None


def normalize_date_string(raw_date_str: str) -> str:
    """Attempt to parse various common date formats and return YYYY-MM-DD."""
    cleaned = raw_date_str.strip()
    # Common formats
    formats = [
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%d-%m-%Y",
        "%d.%m.%Y",
        "%Y/%m/%d",
        "%d-%b-%Y",
        "%d %b %Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    # If already matches YYYY-MM-DD pattern via regex
    match = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", cleaned)
    if match:
        y, m, d = match.groups()
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    # Return today if unparseable
    return datetime.utcnow().strftime("%Y-%m-%d")


def parse_amount(val_str: Any) -> float:
    """Clean monetary strings ($1,234.50, -100.00, etc.) into float."""
    if isinstance(val_str, (int, float)):
        return float(val_str)
    if not val_str:
        return 0.0
    s = str(val_str).strip().replace("$", "").replace("£", "").replace("€", "").replace("EGP", "").replace(",", "")
    # Handle accounting parentheses (100.00) -> -100.00
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1].strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


class CSVStatementParser:
    """Parses bank statement CSV files with auto-detection and optional column mapping."""

    DATE_ALIASES = ["date", "posting date", "transaction date", "booking date", "value date", "valuta"]
    DESC_ALIASES = ["description", "narrative", "details", "memo", "particulars", "payee", "transaction description"]
    DEBIT_ALIASES = ["debit", "withdrawal", "outflow", "dr", "paid out", "debit amount"]
    CREDIT_ALIASES = ["credit", "deposit", "inflow", "cr", "paid in", "credit amount"]
    AMOUNT_ALIASES = ["amount", "transaction amount", "net amount"]
    REF_ALIASES = ["reference", "ref", "cheque number", "check no", "trans id", "reference number", "ref no"]

    @classmethod
    def parse(cls, content: bytes, mapping: Optional[Dict[str, Optional[str]]] = None) -> List[Dict[str, Any]]:
        text = content.decode("utf-8-sig", errors="replace")
        f = io.StringIO(text)
        reader = csv.reader(f)

        rows = list(reader)
        if not rows:
            return []

        # 1. Find header row
        header_idx = -1
        for i, row in enumerate(rows[:10]):
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
        col_map: Dict[str, int] = {}
        for col_i, col_name in enumerate(header_row):
            norm = col_name.strip().lower()
            if norm:
                col_map[norm] = col_i

        # Resolve column indices
        def find_col(field_key: str, custom_name: Optional[str], aliases: List[str]) -> Optional[int]:
            if custom_name and custom_name.strip().lower() in col_map:
                return col_map[custom_name.strip().lower()]
            for alias in aliases:
                if alias in col_map:
                    return col_map[alias]
            return None

        custom_map = mapping or {}
        date_col = find_col("date_col", custom_map.get("date_col"), cls.DATE_ALIASES)
        desc_col = find_col("description_col", custom_map.get("description_col"), cls.DESC_ALIASES)
        debit_col = find_col("debit_col", custom_map.get("debit_col"), cls.DEBIT_ALIASES)
        credit_col = find_col("credit_col", custom_map.get("credit_col"), cls.CREDIT_ALIASES)
        amount_col = find_col("amount_col", custom_map.get("amount_col"), cls.AMOUNT_ALIASES)
        ref_col = find_col("reference_col", custom_map.get("reference_col"), cls.REF_ALIASES)

        parsed_lines: List[Dict[str, Any]] = []
        for row in rows[header_idx + 1:]:
            if not row or not any(row):
                continue

            raw_date_str = row[date_col].strip() if date_col is not None and date_col < len(row) else ""
            if not raw_date_str:
                continue

            raw_date = normalize_date_string(raw_date_str)
            raw_desc = row[desc_col].strip() if desc_col is not None and desc_col < len(row) else "Transaction"
            raw_ref = row[ref_col].strip() if ref_col is not None and ref_col < len(row) else ""

            # Determine amount and direction
            amount = 0.0
            direction = "out"

            has_split = False
            if debit_col is not None and debit_col < len(row) and row[debit_col].strip():
                d_val = parse_amount(row[debit_col])
                if d_val != 0.0:
                    amount = abs(d_val)
                    direction = "out"
                    has_split = True

            if credit_col is not None and credit_col < len(row) and row[credit_col].strip():
                c_val = parse_amount(row[credit_col])
                if c_val != 0.0:
                    amount = abs(c_val)
                    direction = "in"
                    has_split = True

            if not has_split and amount_col is not None and amount_col < len(row) and row[amount_col].strip():
                a_val = parse_amount(row[amount_col])
                if a_val < 0:
                    amount = abs(a_val)
                    direction = "out"
                else:
                    amount = a_val
                    direction = "in"

            if amount > 0:
                parsed_lines.append({
                    "raw_date": raw_date,
                    "raw_amount": round(amount, 2),
                    "direction": direction,
                    "raw_description": raw_desc[:500],
                    "raw_reference": raw_ref[:100],
                })

        return parsed_lines


class PDFStatementParser:
    """Best-effort PDF statement extractor. Always lands in needs_review, never auto-confirmed."""

    @classmethod
    def parse(cls, content: bytes) -> List[Dict[str, Any]]:
        if not pypdf:
            return []

        try:
            reader = pypdf.PdfReader(io.BytesIO(content))
            full_text = ""
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    full_text += "\n" + text
        except Exception:
            return []

        parsed_lines: List[Dict[str, Any]] = []
        # Pattern for standard statement line: Date (YYYY-MM-DD or DD/MM/YYYY) + Description + Amount
        line_pattern = re.compile(
            r"(?P<date>\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+"
            r"(?P<desc>.+?)\s+"
            r"(?P<sign>-|\+)?(?P<curr>[\$€£]|EGP\s*)?(?P<amount>\d{1,3}(?:,\d{3})*(?:\.\d{2}))(?:\s+(?P<dir>CR|DR))?",
            re.IGNORECASE,
        )

        for line in full_text.splitlines():
            line_str = line.strip()
            if not line_str:
                continue

            m = line_pattern.search(line_str)
            if m:
                raw_date = normalize_date_string(m.group("date"))
                desc = m.group("desc").strip()
                amt_val = parse_amount(m.group("amount"))
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

                if amt_val > 0:
                    parsed_lines.append({
                        "raw_date": raw_date,
                        "raw_amount": round(amt_val, 2),
                        "direction": direction,
                        "raw_description": desc[:500],
                        "raw_reference": "",
                    })

        return parsed_lines
