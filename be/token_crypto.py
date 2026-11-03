"""
token_crypto.py
Encrypts the Google refresh tokens kept in auth_sessions. Fernet (AES-128-CBC + HMAC) with the keys in
Config.TOKEN_ENCRYPTION_KEY: the first key encrypts, every key decrypts, so a new key placed first rotates
the store without invalidating existing rows. In development (no key set) a key is derived from SECRET_KEY.
"""
import base64
import hashlib
from typing import List

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from config import Config


def _split_keys(raw: str) -> List[str]:
    return [k.strip() for k in (raw or "").split(",") if k.strip()]


def validate_keys(raw: str):
    """Returns an error message when `raw` is not a usable list of Fernet keys, else None."""
    keys = _split_keys(raw)
    if not keys:
        return "no key given"
    for key in keys:
        try:
            Fernet(key.encode())
        except (ValueError, TypeError):
            return "each key must be a 32-byte url-safe base64 Fernet key"
    return None


def _cipher() -> MultiFernet:
    keys = _split_keys(Config.TOKEN_ENCRYPTION_KEY)
    if keys:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    derived = base64.urlsafe_b64encode(hashlib.sha256(("hrflow-token-key:" + Config.SECRET_KEY).encode()).digest())
    return MultiFernet([Fernet(derived)])


def encrypt_token(plain: str) -> str:
    return _cipher().encrypt(plain.encode()).decode()


def decrypt_token(stored: str):
    """Returns the plain token, or None when it cannot be decrypted (wrong or removed key)."""
    try:
        return _cipher().decrypt(stored.encode()).decode()
    except InvalidToken:
        return None
