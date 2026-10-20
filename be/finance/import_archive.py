"""
be/finance/import_archive.py
ZIP validation for the bulk / historical import (plan 25, section 6 "File safety"). Pure functions.

Nothing is extracted to disk: entries are read into memory (bounded) and later stored by the existing
attachment code under a generated name. The entry name is used only to match a manifest row.

A hostile archive (path traversal, absolute path, symlink, nested archive, encrypted entry, too many entries,
declared or actual size over the cap) is refused as a whole with ArchiveRejected. A problem with a single file
(type not allowed, magic bytes do not match the extension, empty, over the per-file cap) is recorded on that
entry so only the rows that reference it fail.
"""
import io
import posixpath
import re
import stat
import zipfile
import zlib
from dataclasses import dataclass
from typing import Dict, List, Optional

from finance import import_config as cfg

_ARCHIVE_EXTENSIONS = (".zip", ".7z", ".rar", ".gz", ".tgz", ".tar", ".bz2", ".xz")
_ARCHIVE_MAGICS = (b"PK\x03\x04", b"PK\x05\x06", b"7z\xbc\xaf\x27\x1c", b"Rar!", b"\x1f\x8b")
_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")


class ArchiveRejected(ValueError):
    """The whole archive is refused; the message is safe to show to the user."""


@dataclass
class ArchiveEntry:
    name: str  # path inside the ZIP, normalised to '/'
    base_name: str
    data: bytes
    problem: Optional[str] = None  # set when this one file cannot be used


@dataclass
class Archive:
    entries: Dict[str, ArchiveEntry]  # key: lowercase base name
    ambiguous: List[str]  # lowercase base names that occur more than once (cannot be matched safely)

    def find(self, source_file: str) -> Optional[ArchiveEntry]:
        return self.entries.get(base_name_key(source_file))


def base_name_key(name: str) -> str:
    """Matching is exact on the base name, case-insensitive (plan 25, section 5)."""
    return posixpath.basename((name or "").replace("\\", "/")).strip().lower()


def detect_content_type(head: bytes) -> Optional[str]:
    """Content type from magic bytes, or None when the bytes are not an allowed document type."""
    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if len(head) >= 12 and head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heim", b"heis"):
        return "heic"
    return None


_EXTENSION_TYPES = {
    ".pdf": ("pdf",),
    ".png": ("png",),
    ".jpg": ("jpeg",),
    ".jpeg": ("jpeg",),
    ".webp": ("webp",),
    ".heic": ("heic",),
}


def check_document_bytes(filename: str, data: bytes) -> Optional[str]:
    """None when the file is usable; otherwise a user-facing reason. Used for ZIP entries."""
    ext = posixpath.splitext(filename)[1].lower()
    if ext not in cfg.ALLOWED_EXTENSIONS:
        return f"File type '{ext or 'none'}' is not allowed (use PDF, PNG, JPG, WEBP or HEIC)"
    if not data:
        return "The file is empty"
    if len(data) > cfg.MAX_FILE_BYTES:
        return f"The file is larger than {cfg.MAX_FILE_BYTES // (1024 * 1024)} MB. Compress it and package it again"
    detected = detect_content_type(data[:16])
    if detected not in _EXTENSION_TYPES[ext]:
        return f"The content of the file does not match its '{ext}' extension"
    return None


def _is_junk(name: str) -> bool:
    parts = name.split("/")
    base = parts[-1].lower()
    return parts[0] == "__MACOSX" or base.startswith("._") or base in cfg.JUNK_NAMES


def open_archive(content: bytes) -> Archive:
    if not content:
        raise ArchiveRejected("The ZIP file is empty.")
    if content[:4] not in (b"PK\x03\x04", b"PK\x05\x06"):
        raise ArchiveRejected("The archive is not a ZIP file.")
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise ArchiveRejected("The ZIP file is damaged or incomplete.")

    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        if len(infos) > cfg.MAX_ARCHIVE_ENTRIES:
            raise ArchiveRejected(f"The ZIP has more than {cfg.MAX_ARCHIVE_ENTRIES} files. {cfg.LIMIT_HELP}")
        if sum(i.file_size for i in infos) > cfg.MAX_UNCOMPRESSED_BYTES:
            raise ArchiveRejected(
                f"The ZIP expands to more than {cfg.MAX_UNCOMPRESSED_BYTES // (1024 * 1024)} MB. {cfg.LIMIT_HELP}"
            )

        entries: Dict[str, ArchiveEntry] = {}
        seen: Dict[str, int] = {}
        remaining = cfg.MAX_UNCOMPRESSED_BYTES
        for info in infos:
            raw_name = info.filename
            name = raw_name.replace("\\", "/")
            # Path safety: refuse the archive, never "clean up" a hostile name
            if name.startswith("/") or _DRIVE_PREFIX.match(name) or "\x00" in name:
                raise ArchiveRejected(f"The ZIP contains an unsafe path ('{raw_name}'). Package the files again.")
            if ".." in name.split("/"):
                raise ArchiveRejected(f"The ZIP contains an unsafe path ('{raw_name}'). Package the files again.")
            mode = info.external_attr >> 16
            if mode and stat.S_ISLNK(mode):
                raise ArchiveRejected(f"The ZIP contains a symbolic link ('{raw_name}'). Package the files again.")
            if info.flag_bits & 0x1:
                raise ArchiveRejected(f"The ZIP contains an encrypted file ('{raw_name}'). Package the files without a password.")
            if _is_junk(name):
                continue
            base = posixpath.basename(name)
            if posixpath.splitext(base)[1].lower() in _ARCHIVE_EXTENSIONS:
                raise ArchiveRejected(f"The ZIP contains a nested archive ('{raw_name}'). Package the files without nested ZIPs.")

            # Bounded read: never trust the declared size
            allowed = min(cfg.MAX_FILE_BYTES, remaining)
            try:
                with zf.open(info) as fh:
                    data = fh.read(allowed + 1)
            except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError, RuntimeError):
                raise ArchiveRejected(f"The ZIP is damaged or uses an unsupported format ('{raw_name}'). Package the files again.")
            if len(data) > allowed:
                if allowed < cfg.MAX_FILE_BYTES:
                    raise ArchiveRejected(
                        f"The ZIP expands to more than {cfg.MAX_UNCOMPRESSED_BYTES // (1024 * 1024)} MB. {cfg.LIMIT_HELP}"
                    )
                data = b""
                problem = f"The file is larger than {cfg.MAX_FILE_BYTES // (1024 * 1024)} MB. Compress it and package it again"
            else:
                remaining -= len(data)
                if any(data.startswith(m) for m in _ARCHIVE_MAGICS):
                    raise ArchiveRejected(f"The ZIP contains a nested archive ('{raw_name}'). Package the files without nested ZIPs.")
                problem = check_document_bytes(base, data)

            key = base.lower()
            seen[key] = seen.get(key, 0) + 1
            entries.setdefault(key, ArchiveEntry(name=name, base_name=base, data=data, problem=problem))

    return Archive(entries=entries, ambiguous=sorted(k for k, n in seen.items() if n > 1))
