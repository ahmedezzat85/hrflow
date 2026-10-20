"""
be/tests/import_test_helpers.py
Synthetic packages for the bulk / historical import tests (D-033). Nothing here is real financial data:
PDFs are generated in memory, one with a text layer and one image-only (no text operators).
"""
import csv
import io
import zipfile
from typing import Dict, Iterable, List, Optional

from finance.import_manifest import all_columns


def text_pdf(vendor: str, number: str, total: float, issue="2026-04-10", due="2026-05-10") -> bytes:
    """A one-page PDF with a text layer that BillPdfExtractor can read."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n"
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        b"5 0 obj << /Length 300 >> stream\nBT\n/F1 12 Tf\n72 700 Td\n"
        + f"(Vendor: {vendor}) Tj\n0 -20 Td\n(Invoice Number: {number}) Tj\n0 -20 Td\n(Date: {issue}) Tj\n0 -20 Td\n".encode()
        + f"(Due Date: {due}) Tj\n0 -20 Td\n(Hosting 1 {total:.2f} {total:.2f}) Tj\n0 -20 Td\n(Total: {total:.2f} USD) Tj\nET\n".encode()
        + b"endstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n"
        + b"0000000115 00000 n \n0000000224 00000 n \n0000000293 00000 n \n"
        + b"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n546\n%%EOF"
    )


def image_only_pdf(tag: str = "scan") -> bytes:
    """A one-page PDF with no text operators at all (what a scan looks like to a text extractor)."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >> endobj\n"
        b"4 0 obj << /Length 20 >> stream\n0.5 g 10 10 100 100 re f\nendstream\nendobj\n"
        + f"% {tag}\n".encode()
        + b"trailer << /Size 5 /Root 1 0 R >>\n%%EOF"
    )


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 24


def build_zip(files: Dict[str, bytes], extra: Optional[Iterable[zipfile.ZipInfo]] = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
        for info in extra or []:
            zf.writestr(info, b"x")
    return buf.getvalue()


def manifest_csv(kind: str, rows: List[dict], columns: Optional[List[str]] = None, bom: bool = False) -> bytes:
    cols = columns or list(all_columns(kind))
    out = io.StringIO(newline="")
    w = csv.writer(out)
    w.writerow(cols)
    for r in rows:
        w.writerow([r.get(c, "") for c in cols])
    text = out.getvalue()
    return (("﻿" if bom else "") + text).encode("utf-8")


def manifest_xlsx(kind: str, rows: List[dict], columns: Optional[List[str]] = None) -> bytes:
    from openpyxl import Workbook

    cols = columns or list(all_columns(kind))
    wb = Workbook()
    ws = wb.active
    ws.append(cols)
    for r in rows:
        ws.append([r.get(c, "") if r.get(c, "") != "" else None for c in cols])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def post_import(client, cookies, kind: str, manifest: bytes, archive: bytes, commit: bool = False,
                manifest_name: str = "manifest.csv"):
    url = f"/api/finance/imports/{kind}" + ("" if commit else "/dry-run")
    return client.post(
        url,
        files={
            "manifest": (manifest_name, io.BytesIO(manifest), "text/csv"),
            "archive": ("package.zip", io.BytesIO(archive), "application/zip"),
        },
        cookies=cookies,
    )
