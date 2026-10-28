"""
services/pdf_converter.py
Post-generation document converter converting .docx bytes to .pdf bytes.
Supports:
1. LibreOffice CLI (`soffice --headless --convert-to pdf`) for Linux / Docker / cross-platform.
2. Microsoft Word COM (`win32com.client`) on Windows hosts.
Gracefully returns None if no converter engine is available in the environment.
"""
import io
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from logging_config import get_logger

logger = get_logger("pdf_converter")

_VERTICAL_BAND_STYLES = re.compile(r'<w:tblStylePr w:type="band[12]Vert">.*?</w:tblStylePr>', re.DOTALL)
_HORIZONTAL_BAND_STYLES = re.compile(r'<w:tblStylePr w:type="band[12]Horz">.*?</w:tblStylePr>', re.DOTALL)
_SIDE_BORDERS = re.compile(r'<w:(?:left|right|start|end) [^>]*/>')


def _like_word_table_look(docx_bytes: bytes) -> bytes:
    """
    LibreOffice draws table style borders that Word does not, so PDFs show blue column lines between cells
    that the Word document does not have (e.g. the "Light List" table style of the invoice template):
    - banded-row rules (band1Horz/band2Horz) carry left/right cell borders, which Word keeps at the table
      edge only (the table's own borders still draw the outer box);
    - banded-column rules (band1Vert/band2Vert) apply even when the table has "Banded Columns" off
      (w:noVBand="1"), which Word honours.
    The Word file itself is never changed: this adjusts the copy handed to LibreOffice.
    Returns the input unchanged if there is nothing to change or the file cannot be processed.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(docx_bytes)) as zin:
            document = zin.read("word/document.xml").decode("utf-8", errors="ignore")
            styles = zin.read("word/styles.xml").decode("utf-8", errors="ignore")
            patched = _HORIZONTAL_BAND_STYLES.sub(lambda m: _SIDE_BORDERS.sub("", m.group(0)), styles)
            looks = re.findall(r"<w:tblLook\b[^>]*>", document)
            if looks and all('w:noVBand="1"' in look for look in looks):
                patched = _VERTICAL_BAND_STYLES.sub("", patched)
            if patched == styles:
                return docx_bytes
            out = io.BytesIO()
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = patched.encode("utf-8") if item.filename == "word/styles.xml" else zin.read(item.filename)
                    zout.writestr(item, data)
            return out.getvalue()
    except Exception as exc:
        logger.warning("Could not adjust table look before PDF conversion: %s", exc)
        return docx_bytes


def _convert_with_libreoffice(docx_path: str, output_dir: str) -> Optional[str]:
    soffice_cmd = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice_cmd:
        return None

    try:
        logger.debug("Attempting PDF conversion with LibreOffice (%s)", soffice_cmd)
        # A private profile in the temp folder: the default (~/.config) is not writable in the read-only
        # production container, and a shared profile blocks concurrent conversions.
        profile_uri = Path(output_dir, "lo-profile").as_uri()
        cmd = [
            soffice_cmd,
            f"-env:UserInstallation={profile_uri}",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            output_dir,
            docx_path,
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if result.returncode == 0:
            base_name = os.path.splitext(os.path.basename(docx_path))[0]
            pdf_path = os.path.join(output_dir, f"{base_name}.pdf")
            if os.path.isfile(pdf_path):
                return pdf_path
        logger.warning("LibreOffice conversion exited with code %s: %s", result.returncode, result.stderr.decode(errors="ignore"))
    except Exception as exc:
        logger.warning("LibreOffice conversion failed: %s", exc)
    return None


def _convert_with_word_com(docx_path: str, output_path: str) -> Optional[str]:
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return None

    word = None
    doc = None
    try:
        logger.debug("Attempting PDF conversion with Word COM")
        pythoncom.CoInitialize()
        # DispatchEx creates a new isolated Word process to avoid attaching to existing busy sessions
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = False
        doc = word.Documents.Open(
            FileName=os.path.abspath(docx_path),
            ConfirmConversions=False,
            ReadOnly=True,
            AddToRecentFiles=False,
            Visible=False,
        )
        # 17 is wdFormatPDF
        doc.SaveAs(FileName=os.path.abspath(output_path), FileFormat=17)
        doc.Close(SaveChanges=0)
        doc = None
        if os.path.isfile(output_path):
            return output_path
    except Exception as exc:
        logger.warning("Word COM PDF conversion failed: %s", exc)
    finally:
        try:
            if doc is not None:
                doc.Close(SaveChanges=0)
        except Exception:
            pass
        try:
            if word is not None:
                word.Quit()
        except Exception:
            pass
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass
    return None



def convert_docx_to_pdf_bytes(docx_bytes: bytes) -> Optional[bytes]:
    """
    Converts raw .docx bytes into raw .pdf bytes.
    Returns bytes on success, or None if conversion fails / no converter is available.
    """
    if not docx_bytes:
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        docx_path = os.path.join(tmpdir, "input.docx")
        pdf_path = os.path.join(tmpdir, "input.pdf")

        with open(docx_path, "wb") as f:
            f.write(docx_bytes)

        # 1. Try LibreOffice CLI first (standard on Linux/Docker), on a copy adjusted to match Word's table look
        libreoffice_path = os.path.join(tmpdir, "lo_input.docx")
        with open(libreoffice_path, "wb") as f:
            f.write(_like_word_table_look(docx_bytes))
        converted_pdf = _convert_with_libreoffice(libreoffice_path, tmpdir)

        # 2. Try Word COM on Windows
        if not converted_pdf:
            converted_pdf = _convert_with_word_com(docx_path, pdf_path)

        if converted_pdf and os.path.isfile(converted_pdf):
            try:
                with open(converted_pdf, "rb") as f:
                    pdf_bytes = f.read()
                logger.info("Successfully converted .docx to .pdf (%d bytes -> %d bytes)", len(docx_bytes), len(pdf_bytes))
                return pdf_bytes
            except Exception as exc:
                logger.warning("Failed to read converted PDF file: %s", exc)

    logger.info("PDF conversion was not possible (no office converter available or conversion failed); returning None")
    return None
