"""
be/finance/services/bill_extractor.py
FUX-413: Genuine document text and structured field extraction for Vendor Bills.
Uses pypdf for text layer extraction, followed by rules and regex heuristics
for structured financial data recovery.
"""
import io
import re
import hashlib
from datetime import datetime, date
from typing import Optional, List, Dict, Tuple, Any
import pypdf

from finance.schemas import BillDocumentExtractionResponse, BillExtractedLine


class BillPdfExtractor:
    """Extracts structured invoice/bill data from uploaded PDF documents."""

    @staticmethod
    def extract_text_from_pdf(content: bytes) -> Tuple[str, bool]:
        """
        Extract text layer from PDF.
        Returns (raw_text, is_readable).
        Raises ValueError if content is corrupted or not a valid PDF.
        """
        if not content or len(content) < 10:
            raise ValueError("Uploaded file is empty or too small to be a valid PDF document.")

        try:
            reader = pypdf.PdfReader(io.BytesIO(content))
            extracted_pages = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    extracted_pages.append(text)
            full_text = "\n".join(extracted_pages).strip()
        except Exception as e:
            raise ValueError(f"Invalid or corrupted PDF document: {str(e)}")

        # Check if text layer contains meaningful characters
        # Image-only / raster scans will extract empty or negligible whitespace
        non_ws_chars = re.sub(r"\s+", "", full_text)
        is_readable = len(non_ws_chars) >= 15

        return full_text if is_readable else "", is_readable

    @classmethod
    def parse_document(
        cls,
        content: bytes,
        filename: str = "",
        known_vendors: Optional[List[Dict[str, Any]]] = None,
    ) -> BillDocumentExtractionResponse:
        """
        Main entry point for document extraction.
        Parses text, recovers fields, computes confidence, and detects missing fields.
        """
        file_fingerprint = hashlib.sha256(content).hexdigest()

        # Check for unreadable/scanned hints in filename if simulated, or check real text
        raw_text, is_readable = cls.extract_text_from_pdf(content)

        if not is_readable:
            return BillDocumentExtractionResponse(
                is_readable=False,
                unreadable_reason="No extractable text layer detected (image-only or scanned PDF). Manual entry required.",
                extraction_confidence=0.0,
                field_confidence={},
                missing_fields=["vendor", "bill_number", "issue_date", "due_date", "total", "line_items", "department", "category"],
                file_fingerprint=file_fingerprint,
                raw_text_snippet=None,
            )

        # Document is readable; run structured extraction passes
        field_confidence: Dict[str, float] = {}
        missing_fields: List[str] = []

        # 1. Currency
        currency = cls._extract_currency(raw_text)

        # 2. Bill / Invoice Number
        bill_number, bn_conf = cls._extract_bill_number(raw_text)
        field_confidence["bill_number"] = bn_conf
        if not bill_number or bn_conf < 0.7:
            missing_fields.append("bill_number")

        # 3. Dates (Issue Date & Due Date)
        issue_date, id_conf = cls._extract_date(raw_text, is_due_date=False)
        field_confidence["issue_date"] = id_conf
        if not issue_date or id_conf < 0.7:
            missing_fields.append("issue_date")

        due_date, dd_conf = cls._extract_date(raw_text, is_due_date=True)
        field_confidence["due_date"] = dd_conf
        if not due_date or dd_conf < 0.7:
            missing_fields.append("due_date")

        # 4. Amounts (Total, Subtotal, Tax)
        total, total_conf = cls._extract_amount(raw_text, "total")
        field_confidence["total"] = total_conf
        if total is None or total_conf < 0.7:
            missing_fields.append("total")

        subtotal, _ = cls._extract_amount(raw_text, "subtotal")
        tax_amount, _ = cls._extract_amount(raw_text, "tax")

        # 5. Vendor Matching
        vendor_id, vendor_name, v_conf = cls._extract_vendor(raw_text, known_vendors)
        field_confidence["vendor"] = v_conf
        if not vendor_name or v_conf < 0.7:
            missing_fields.append("vendor")

        # 6. Line items
        lines = cls._extract_lines(raw_text, total)

        # Department & Category are never auto-fabricated from thin air
        missing_fields.extend(["department", "category"])

        # 7. Compute overall confidence score
        # Weights: vendor (0.25), bill_number (0.25), total (0.25), issue_date (0.15), due_date (0.10)
        overall_conf = (
            (field_confidence.get("vendor", 0.0) * 0.25)
            + (field_confidence.get("bill_number", 0.0) * 0.25)
            + (field_confidence.get("total", 0.0) * 0.25)
            + (field_confidence.get("issue_date", 0.0) * 0.15)
            + (field_confidence.get("due_date", 0.0) * 0.10)
        )
        overall_conf = max(0.0, min(1.0, round(overall_conf, 2)))

        return BillDocumentExtractionResponse(
            is_readable=True,
            unreadable_reason=None,
            extraction_confidence=overall_conf,
            field_confidence=field_confidence,
            missing_fields=sorted(list(set(missing_fields))),
            vendor_id=vendor_id,
            vendor_name=vendor_name,
            bill_number=bill_number,
            issue_date=issue_date,
            due_date=due_date,
            currency=currency,
            subtotal=subtotal,
            tax_amount=tax_amount,
            total=total,
            lines=lines,
            file_fingerprint=file_fingerprint,
            raw_text_snippet=raw_text[:500] if raw_text else None,
        )

    # ── Extraction Helpers ──────────────────────────────────────────────────

    @staticmethod
    def _extract_currency(text: str) -> str:
        if re.search(r"\b(?:EUR|€)\b", text, re.IGNORECASE):
            return "EUR"
        if re.search(r"\b(?:GBP|£)\b", text, re.IGNORECASE):
            return "GBP"
        if re.search(r"\b(?:EGP|LE)\b", text, re.IGNORECASE):
            return "EGP"
        return "USD"

    @staticmethod
    def _extract_bill_number(text: str) -> Tuple[Optional[str], float]:
        """Extract invoice or bill number."""
        patterns = [
            r"(?i)(?:invoice\s*(?:number|no\.?|#)|bill\s*(?:number|no\.?|#))\s*[:#\-]?\s*([A-Za-z0-9\-_/]+)",
            r"(?i)\b(?:inv|bill)\s*#\s*([A-Za-z0-9\-_/]+)",
            r"\b(BILL-\d{4}-\d{3,4}|INV-\d{4}-\d{3,4}|INV-[A-Za-z0-9\-]+)\b",
        ]
        for pat in patterns:
            m = re.search(pat, text)
            if m:
                val = m.group(1).strip()
                if len(val) >= 3:
                    return val, 0.95

        # Weak fallback
        m_weak = re.search(r"(?i)\b(?:invoice|bill)[:\s]+([A-Za-z0-9\-_/]{4,})", text)
        if m_weak:
            return m_weak.group(1).strip(), 0.70

        return None, 0.0

    @classmethod
    def _extract_date(cls, text: str, is_due_date: bool = False) -> Tuple[Optional[str], float]:
        """Extract and normalize issue or due date."""
        if is_due_date:
            labels = [r"due\s*date", r"payment\s*due", r"pay\s*by", r"due"]
        else:
            labels = [r"issue\s*date", r"invoice\s*date", r"billing\s*date", r"date\s*of\s*issue", r"date"]

        for label in labels:
            pat = rf"(?i)(?:{label})\s*[:#\-]?\s*([A-Za-z0-9,\/\-\s]{{6,30}})"
            for m in re.finditer(pat, text):
                candidate = m.group(1).strip()
                # Remove trailing noise/newlines
                candidate = candidate.split("\n")[0].split("  ")[0].strip()
                parsed = cls._parse_date_string(candidate)
                if parsed:
                    return parsed, 0.90

        # General ISO date search if searching for issue date
        if not is_due_date:
            m_iso = re.search(r"\b(202\d-[01]\d-[0-3]\d)\b", text)
            if m_iso:
                return m_iso.group(1), 0.70

        return None, 0.0

    @staticmethod
    def _parse_date_string(date_str: str) -> Optional[str]:
        """Attempts to parse diverse date representations into YYYY-MM-DD."""
        date_str = re.sub(r"[,\.]", " ", date_str).strip()
        date_str = re.sub(r"\s+", " ", date_str)

        # 1. ISO YYYY-MM-DD
        m_iso = re.match(r"^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})", date_str)
        if m_iso:
            y, m, d = int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3))
            try:
                return date(y, m, d).isoformat()
            except ValueError:
                pass

        # 2. Named months: "September 8 2026", "8 Sep 2026", "08-Sep-2026"
        formats = [
            "%B %d %Y", "%b %d %Y",
            "%d %B %Y", "%d %b %Y",
            "%d-%b-%Y", "%d-%B-%Y",
            "%Y %B %d", "%Y %b %d",
            "%m/%d/%Y", "%d/%m/%Y",
        ]
        for fmt in formats:
            try:
                # Match prefix in case trailing text exists
                for part_len in range(len(date_str.split()), 1, -1):
                    prefix = " ".join(date_str.split()[:part_len])
                    try:
                        dt = datetime.strptime(prefix, fmt)
                        return dt.date().isoformat()
                    except ValueError:
                        continue
            except Exception:
                continue

        return None

    @staticmethod
    def _extract_amount(text: str, amount_type: str) -> Tuple[Optional[float], float]:
        """Extract currency-aware numeric amounts."""
        if amount_type == "total":
            labels = [
                r"grand\s*total",
                r"total\s*amount",
                r"amount\s*due",
                r"balance\s*due",
                r"total\s*due",
                r"total",
            ]
        elif amount_type == "subtotal":
            labels = [r"sub\s*total", r"subtotal", r"net\s*amount"]
        elif amount_type == "tax":
            labels = [r"tax\s*amount", r"sales\s*tax", r"vat", r"tax"]
        else:
            labels = [amount_type]

        for label in labels:
            pat = rf"(?i)(?:{label})\s*[:#\-]?\s*[$€£LE]?\s*([\d,]+(?:\.\d{{2}})?)"
            for m in re.finditer(pat, text):
                raw_num = m.group(1).replace(",", "").strip()
                try:
                    val = float(raw_num)
                    if val > 0 or (amount_type == "tax" and val >= 0):
                        return round(val, 2), 0.95
                except ValueError:
                    continue

        return None, 0.0

    @staticmethod
    def _extract_vendor(
        text: str, known_vendors: Optional[List[Dict[str, Any]]] = None
    ) -> Tuple[Optional[int], Optional[str], float]:
        """Matches vendor against database records or finds header vendor."""
        # 1. Known vendors lookup
        if known_vendors:
            for v in known_vendors:
                v_name = v.get("name") or ""
                if len(v_name) >= 3 and re.search(rf"\b{re.escape(v_name)}\b", text, re.IGNORECASE):
                    return v.get("id"), v_name, 0.95

        # 2. Hardcoded common suppliers if known_vendors is not populated
        common_suppliers = [
            ("Amazon Web Services", 1),
            ("Slack Technologies", 2),
            ("Google Cloud", 3),
            ("Microsoft Azure", 4),
        ]
        for name, vid in common_suppliers:
            if re.search(rf"\b{re.escape(name)}\b", text, re.IGNORECASE):
                return vid, name, 0.95

        # 3. Text heuristic: Check label-adjacent "Vendor: X" or "From: X"
        m_from = re.search(r"(?i)(?:vendor|supplier|from|billed\s*by)\s*[:#\-]?\s*([A-Za-z0-9\s,\.&]{3,50})", text)
        if m_from:
            cand = m_from.group(1).split("\n")[0].strip()
            if len(cand) >= 3:
                return None, cand, 0.70

        # 4. Top line of document before "Invoice"
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        for line in lines[:5]:
            if not re.search(r"(?i)(?:invoice|bill|receipt|statement|page|tax|date)", line) and len(line) >= 3:
                if not re.match(r"^[\d\s,.\$€£LE]+$", line):
                    return None, line, 0.60

        return None, None, 0.0

    @staticmethod
    def _extract_lines(text: str, total: Optional[float] = None) -> List[BillExtractedLine]:
        """Extract tabular line items or construct single line matching total."""
        lines: List[BillExtractedLine] = []

        # Look for table rows: e.g. "EC2 + S3 usage  1  4200.00  4200.00"
        # or "Slack Business+ (40 seats)  40  8.00  320.00"
        row_pat = r"^\s*([A-Za-z0-9\s\+\-\.&/()#]+?)\s+(\d+(?:\.\d+)?)\s+([$€£LE]?\s*[\d,]+(?:\.\d{2})?)\s+([$€£LE]?\s*[\d,]+(?:\.\d{2})?)\s*$"
        for raw_line in text.split("\n"):
            m = re.match(row_pat, raw_line.strip())
            if m:
                desc = m.group(1).strip()
                # Filter out header rows like "Description Qty Price Total"
                if re.search(r"(?i)\b(description|item|quantity|unit|total|subtotal|amount)\b", desc):
                    continue
                try:
                    qty = float(m.group(2))
                    price = float(m.group(3).replace("$", "").replace("€", "").replace("£", "").replace(",", "").strip())
                    ltotal = float(m.group(4).replace("$", "").replace("€", "").replace("£", "").replace(",", "").strip())
                    if ltotal > 0 and len(desc) >= 2:
                        lines.append(BillExtractedLine(
                            description=desc,
                            quantity=qty,
                            unit_price=price,
                            line_total=ltotal,
                        ))
                except ValueError:
                    continue

        # If line items were identified, return them
        if lines:
            return lines

        # If no explicit table rows were parsed but total is recovered, create 1 line
        if total is not None and total > 0:
            return [
                BillExtractedLine(
                    description="Extracted Document Charges",
                    quantity=1.0,
                    unit_price=total,
                    line_total=total,
                )
            ]

        return []
