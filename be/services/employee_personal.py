"""
be/services/employee_personal.py
Validation and masking helpers for employee personal details (D-035): phone, ID type/number.
Pure functions, no I/O, so the API models and the repository can share them.
"""
import re
from typing import Optional, Tuple

ID_TYPES = ("national_id", "passport")

_PHONE_CLEAN = re.compile(r"[\s\-().]")
_PHONE_VALID = re.compile(r"^\+?\d{7,15}$")
_NATIONAL_ID = re.compile(r"^\d{14}$")
_PASSPORT = re.compile(r"^[A-Z0-9]{6,12}$")


def normalize_phone(value: Optional[str]) -> Optional[str]:
    """Strip spaces, dashes, dots and brackets; keep an optional leading '+' and 7-15 digits."""
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    cleaned = _PHONE_CLEAN.sub("", raw)
    if not _PHONE_VALID.match(cleaned):
        raise ValueError("Enter a valid phone number (7-15 digits, optional leading +)")
    return cleaned


def normalize_id(id_type: Optional[str], id_number: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (id_type, id_number), both None when no ID is given. A number needs a type and a type needs
    a number. National ID: exactly 14 digits. Passport: 6-12 letters/digits, upper-cased, spaces removed.
    The number is always text.
    """
    t = (str(id_type).strip().lower() if id_type is not None else "") or None
    n = (str(id_number).strip() if id_number is not None else "") or None
    if t is None and n is None:
        return None, None
    if t is not None and t not in ID_TYPES:
        raise ValueError("ID type must be 'national_id' or 'passport'")
    if t is None:
        raise ValueError("Choose an ID type for the ID number")
    if n is None:
        raise ValueError("Enter the ID number for the chosen ID type")
    compact = re.sub(r"\s+", "", n)
    if t == "national_id":
        if not _NATIONAL_ID.match(compact):
            raise ValueError("A national ID must be exactly 14 digits")
        return t, compact
    compact = compact.upper()
    if not _PASSPORT.match(compact):
        raise ValueError("A passport number must be 6-12 letters or digits")
    return t, compact


def mask_id(id_number: Optional[str]) -> str:
    """Show only the last 4 characters, e.g. '**********1234'."""
    if not id_number:
        return ""
    s = str(id_number)
    if len(s) <= 4:
        return "*" * len(s)
    return "*" * (len(s) - 4) + s[-4:]
