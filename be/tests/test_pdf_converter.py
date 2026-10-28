"""
Unit tests for the PDF converter's pre-processing (the conversion itself needs an office engine).
"""
import io
import zipfile

from services.pdf_converter import _like_word_table_look

STYLES = (
    '<w:styles><w:style w:styleId="T">'
    '<w:tblStylePr w:type="firstRow"><w:tcPr/></w:tblStylePr>'
    '<w:tblStylePr w:type="band1Vert"><w:tcPr><w:tcBorders/></w:tcPr></w:tblStylePr>'
    '<w:tblStylePr w:type="band1Horz"><w:tcPr><w:tcBorders><w:top w:val="single"/><w:left w:val="single"/>'
    '<w:bottom w:val="single"/><w:right w:val="single"/></w:tcBorders></w:tcPr></w:tblStylePr>'
    '</w:style></w:styles>'
)


def _docx(looks: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f"<w:document><w:tbl><w:tblPr>{looks}</w:tblPr></w:tbl></w:document>")
        z.writestr("word/styles.xml", STYLES)
        z.writestr("[Content_Types].xml", "<Types/>")
    return buf.getvalue()


def _styles_of(docx_bytes: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as z:
        return z.read("word/styles.xml").decode("utf-8")


def test_vertical_band_rules_are_dropped_when_banded_columns_are_off():
    out = _like_word_table_look(_docx('<w:tblLook w:val="04A0" w:noVBand="1"/>'))
    styles = _styles_of(out)
    assert "band1Vert" not in styles
    assert "firstRow" in styles and "band1Horz" in styles


def test_banded_row_rules_lose_their_side_borders_but_keep_top_and_bottom():
    styles = _styles_of(_like_word_table_look(_docx('<w:tblLook w:val="0480" w:noVBand="0"/>')))
    assert "w:left" not in styles and "w:right" not in styles
    assert 'w:top w:val="single"' in styles and 'w:bottom w:val="single"' in styles
    assert "band1Vert" in styles


def test_vertical_band_rules_are_kept_when_a_table_does_not_turn_them_off():
    styles = _styles_of(_like_word_table_look(_docx('<w:tblLook w:val="04A0"/>')))
    assert "band1Vert" in styles


def test_invalid_input_is_returned_untouched():
    assert _like_word_table_look(b"not a zip") == b"not a zip"
