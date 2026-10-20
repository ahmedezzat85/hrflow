"""
be/finance/services/import_service.py
Engine for the bulk / historical import (D-033, plan 25). One run = one manifest + one ZIP + one document kind.

The service parses and validates the package, runs the kind's importer checks per row, and on commit creates
Draft records one row at a time, each in its own transaction. A dry run writes nothing. The engine itself knows
nothing about bills, cheques or invoices: each kind registers an importer (see `register_importer`).
"""
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Callable, Dict, FrozenSet, List, Optional, Protocol

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from finance import import_config as cfg
from finance.import_archive import Archive, ArchiveEntry, ArchiveRejected, open_archive
from finance.import_manifest import Manifest, ManifestError, ManifestRow, parse_confidence, parse_manifest
from finance.import_report import (
    LEVEL_DUPLICATE,
    LEVEL_ERROR,
    LEVEL_WARNING,
    ROW_DUPLICATE,
    ROW_ERROR,
    ROW_OK,
    ROW_WARNING,
    Finding,
    ImportReport,
    ImportRowResult,
)
from finance.models import ImportBatchDB

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ImportActor:
    email: str
    is_super_admin: bool = False
    permissions: FrozenSet[str] = field(default_factory=frozenset)

    def can(self, key: str) -> bool:
        return self.is_super_admin or key in self.permissions


@dataclass
class RowContext:
    kind: str
    row: ManifestRow
    entry: Optional[ArchiveEntry]  # the matched ZIP file, None when the row has no source_file
    actor: ImportActor
    batch_id: Optional[int] = None  # set only during a commit
    confidence: Optional[float] = None


class KindImporter(Protocol):
    """What a document kind plugs into the engine."""

    def check_row(self, ctx: RowContext) -> List[Finding]:
        """Validate one row against the database. Must not write anything."""

    def create_row(self, ctx: RowContext) -> int:
        """Create the Draft (and store its file) and return its id. Commits its own transaction."""


ImporterFactory = Callable[[Session, ImportActor], KindImporter]
_IMPORTERS: Dict[str, ImporterFactory] = {}


def register_importer(kind: str, factory: ImporterFactory) -> None:
    _IMPORTERS[kind] = factory


def finding(level: str, code: str, message: str) -> Finding:
    return Finding(level=level, code=code, message=message)


def _status_of(findings: List[Finding]) -> str:
    levels = {f.level for f in findings}
    if LEVEL_ERROR in levels:
        return ROW_ERROR
    if LEVEL_DUPLICATE in levels:
        return ROW_DUPLICATE
    if LEVEL_WARNING in levels:
        return ROW_WARNING
    return ROW_OK


class ImportService:
    def __init__(self, db: Session, audit=None):
        self.db = db
        self.audit = audit

    # ------------------------------------------------------------------
    # Request intake
    # ------------------------------------------------------------------
    @staticmethod
    async def _read_bounded(upload: UploadFile, limit: int, label: str) -> bytes:
        chunks, total = [], 0
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"The {label} is larger than {limit // (1024 * 1024)} MB. {cfg.LIMIT_HELP}",
                )
            chunks.append(chunk)
        return b"".join(chunks)

    async def run(
        self,
        kind: str,
        manifest_file: UploadFile,
        archive_file: UploadFile,
        actor: ImportActor,
        commit: bool,
    ) -> ImportReport:
        if kind not in cfg.KINDS:
            raise HTTPException(status_code=404, detail=f"Unknown import kind '{kind}'")
        manifest_bytes = await self._read_bounded(manifest_file, cfg.MAX_MANIFEST_BYTES, "manifest")
        archive_bytes = await self._read_bounded(archive_file, cfg.MAX_REQUEST_BYTES, "ZIP file")
        if len(manifest_bytes) + len(archive_bytes) > cfg.MAX_REQUEST_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"The upload is larger than {cfg.MAX_REQUEST_BYTES // (1024 * 1024)} MB. {cfg.LIMIT_HELP}",
            )
        return self.process(
            kind=kind,
            manifest_name=manifest_file.filename or "manifest",
            manifest_bytes=manifest_bytes,
            archive_name=archive_file.filename or "archive.zip",
            archive_bytes=archive_bytes,
            actor=actor,
            commit=commit,
        )

    # ------------------------------------------------------------------
    # Validation and commit
    # ------------------------------------------------------------------
    def process(
        self,
        kind: str,
        manifest_name: str,
        manifest_bytes: bytes,
        archive_name: str,
        archive_bytes: bytes,
        actor: ImportActor,
        commit: bool,
    ) -> ImportReport:
        report = ImportReport(kind=kind, dry_run=not commit, manifest_name=manifest_name, archive_name=archive_name)

        try:
            manifest = parse_manifest(manifest_name, manifest_bytes, kind)
        except ManifestError as e:
            report.file_errors.append(str(e))
            return report
        try:
            archive = open_archive(archive_bytes)
        except ArchiveRejected as e:
            report.file_errors.append(str(e))
            return report
        report.file_warnings.extend(manifest.warnings)
        for base in archive.ambiguous:
            report.file_warnings.append(
                f"The ZIP has more than one file named '{base}' in different folders; rows that use it cannot be matched."
            )

        importer = _IMPORTERS[kind](self.db, actor) if kind in _IMPORTERS else None
        if importer is None:
            report.file_warnings.append(
                f"Row checks for '{kind}' are not available yet; only the manifest and ZIP were validated."
            )

        contexts = self._structural_pass(manifest, archive, actor, report)
        for ctx, result in contexts:
            if importer is not None and _status_of(result.findings) != ROW_ERROR:
                result.findings.extend(importer.check_row(ctx))
            result.status = _status_of(result.findings)
            for f in result.findings:
                if f.code == "duplicate_existing" and "#" in f.message:
                    result.duplicate_of = _first_int_after_hash(f.message)

        report.rows = [r for _, r in contexts]
        if not commit:
            self._count(report)
            return report

        if importer is None:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail=f"Importing '{kind}' is not available yet.",
            )
        importable = [(c, r) for c, r in contexts if r.status in (ROW_OK, ROW_WARNING)]
        if not importable:
            self._count(report)
            return report

        batch = ImportBatchDB(
            kind=kind,
            created_by=actor.email,
            manifest_name=(manifest_name or "")[:255],
            archive_name=(archive_name or "")[:255],
            rows_total=len(contexts),
        )
        self.db.add(batch)
        self.db.commit()
        report.batch_id = batch.id
        report.committed = True

        created = 0
        for ctx, result in importable:
            ctx.batch_id = batch.id
            try:
                result.created_id = importer.create_row(ctx)
                created += 1
            except HTTPException as e:
                self.db.rollback()
                self._fail(result, "create_failed", _http_detail(e))
            except Exception:
                self.db.rollback()
                logger.exception("Import row %s (%s) failed", ctx.row.number, kind)
                self._fail(result, "create_failed", "The record could not be created. Nothing was saved for this row.")

        batch = self.db.get(ImportBatchDB, batch.id)
        batch.rows_created = created
        batch.rows_failed = sum(1 for _, r in contexts if r.status in (ROW_ERROR, ROW_DUPLICATE))
        self.db.commit()
        report.rows_created = created
        report.rows_failed = batch.rows_failed
        self._count(report)
        self._audit_batch(batch, actor)
        return report

    # ------------------------------------------------------------------
    def _structural_pass(
        self, manifest: Manifest, archive: Archive, actor: ImportActor, report: ImportReport
    ) -> List[tuple]:
        """Checks that need only the manifest and the ZIP: row_ref, confidence, file matching, repeats."""
        seen_refs: Dict[str, int] = {}
        seen_files: Dict[str, int] = {}
        seen_hashes: Dict[str, int] = {}
        referenced = set()
        out = []
        for row in manifest.rows:
            ref = row.get("row_ref")
            source = row.get("source_file")
            result = ImportRowResult(
                row_number=row.number, line=row.line, row_ref=ref, source_file=source or None, status=ROW_OK
            )
            ctx = RowContext(kind=manifest.kind, row=row, entry=None, actor=actor)

            if not ref:
                result.findings.append(finding(LEVEL_ERROR, "row_ref_missing", "row_ref is required"))
            elif ref in seen_refs:
                result.findings.append(
                    finding(LEVEL_DUPLICATE, "duplicate_row_ref", f"row_ref '{ref}' is already used on line {seen_refs[ref]}")
                )
            else:
                seen_refs[ref] = row.line

            try:
                ctx.confidence = parse_confidence(row.get("confidence"))
            except ValueError as e:
                result.findings.append(finding(LEVEL_ERROR, "confidence_invalid", str(e)))
            if row.get("review_flags"):
                result.findings.append(
                    finding(LEVEL_WARNING, "review_flagged", f"Flagged for review: {row.get('review_flags')}")
                )

            if source:
                key = source.replace("\\", "/").rsplit("/", 1)[-1].strip().lower()
                if key in archive.ambiguous:
                    result.findings.append(
                        finding(LEVEL_ERROR, "source_file_ambiguous", f"'{source}' matches more than one file in the ZIP")
                    )
                else:
                    entry = archive.find(source)
                    if entry is not None:
                        referenced.add(key)
                    if entry is None:
                        result.findings.append(
                            finding(LEVEL_ERROR, "source_file_missing", f"'{source}' was not found in the ZIP")
                        )
                    elif entry.problem:
                        result.findings.append(finding(LEVEL_ERROR, "source_file_invalid", f"'{source}': {entry.problem}"))
                    else:
                        if key in seen_files:
                            result.findings.append(
                                finding(
                                    LEVEL_DUPLICATE,
                                    "duplicate_source_file",
                                    f"'{source}' is already used on line {seen_files[key]}; one file is one document",
                                )
                            )
                        else:
                            seen_files[key] = row.line
                            digest = hashlib.sha256(entry.data).hexdigest()
                            if digest in seen_hashes:
                                result.findings.append(
                                    finding(
                                        LEVEL_DUPLICATE,
                                        "duplicate_file_content",
                                        f"'{source}' has the same content as the file on line {seen_hashes[digest]}",
                                    )
                                )
                            else:
                                seen_hashes[digest] = row.line
                        ctx.entry = entry
            out.append((ctx, result))

        unreferenced = sorted(
            e.base_name for k, e in archive.entries.items() if k not in referenced and k not in archive.ambiguous
        )
        if unreferenced:
            report.unreferenced_files = unreferenced
            report.file_warnings.append(
                f"{len(unreferenced)} file(s) in the ZIP are not referenced by any manifest row and will be ignored."
            )
        return out

    @staticmethod
    def _fail(result: ImportRowResult, code: str, message: str) -> None:
        result.findings.append(finding(LEVEL_ERROR, code, message))
        result.status = ROW_ERROR
        result.created_id = None

    @staticmethod
    def _count(report: ImportReport) -> None:
        report.rows_total = len(report.rows)
        report.rows_ok = sum(1 for r in report.rows if r.status == ROW_OK)
        report.rows_warning = sum(1 for r in report.rows if r.status == ROW_WARNING)
        report.rows_error = sum(1 for r in report.rows if r.status == ROW_ERROR)
        report.rows_duplicate = sum(1 for r in report.rows if r.status == ROW_DUPLICATE)

    def _audit_batch(self, batch: ImportBatchDB, actor: ImportActor) -> None:
        if not self.audit:
            return
        try:
            self.audit.log(
                "finance.import.committed",
                actor.email,
                "import_batch",
                batch.id,
                f"{batch.kind}: created {batch.rows_created} of {batch.rows_total} from {batch.manifest_name}",
            )
        except Exception:
            pass


def _first_int_after_hash(message: str) -> Optional[int]:
    tail = message.split("#", 1)[1]
    digits = ""
    for ch in tail:
        if ch.isdigit():
            digits += ch
        else:
            break
    return int(digits) if digits else None


def _http_detail(e: HTTPException) -> str:
    d = e.detail
    if isinstance(d, str):
        return d
    if isinstance(d, dict):
        return str(d.get("message") or d.get("code") or "The record could not be created")
    if isinstance(d, list):
        return "; ".join(str(x.get("msg", x)) if isinstance(x, dict) else str(x) for x in d)
    return "The record could not be created"
