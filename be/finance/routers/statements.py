"""
be/finance/routers/statements.py
Router for Bank Statement Import Wizard, Preview, Validation, Template Management,
and Review-Driven Reconciliation (Phase 6 / Phase 7).
Gated with RBAC permissions:
- finance.account.read
- finance.account.write
"""
import json
from typing import List, Optional
from fastapi import (
    APIRouter,
    Depends,
    Query,
    status,
    UploadFile,
    File,
    Form,
    HTTPException,
)

from core.permissions import require_permission
from finance.schemas import (
    StatementImportResponse,
    StatementLineResponse,
    StatementLineResolveRequest,
    StatementPreviewResponse,
    StatementMappingTemplateCreate,
    StatementMappingTemplateResponse,
    CSVColumnMapping,
    ReconciliationWorkspaceSummary,
    ReconciliationCloseRequest,
    ReconciliationReopenRequest,
    ReconciliationCompletionReport,
)
from finance.services.statements_service import StatementsService
from finance.deps import get_statements_service

router = APIRouter(prefix="/api/finance", tags=["Finance - Bank Statements & Reconciliation"])


@router.post(
    "/accounts/{account_id}/statements/preview",
    response_model=StatementPreviewResponse,
    dependencies=[Depends(require_permission("finance.account.write"))],
)
async def preview_bank_statement(
    account_id: int,
    period_month: str = Form(..., description="Statement period month (YYYY-MM)"),
    file: UploadFile = File(...),
    column_mapping: Optional[str] = Form(None, description="Optional JSON string of CSVColumnMapping"),
    encoding: Optional[str] = Form("utf-8", description="File text encoding"),
    date_format: Optional[str] = Form("auto", description="Date convention (auto, YYYY-MM-DD, DD/MM/YYYY, etc.)"),
    decimal_separator: Optional[str] = Form(".", description="Decimal separator (. or ,)"),
    opening_balance: Optional[float] = Form(None, description="Opening statement balance"),
    closing_balance: Optional[float] = Form(None, description="Closing statement balance"),
    statements_service: StatementsService = Depends(get_statements_service),
):
    """
    In-memory statement parsing and validation.
    Detects column mappings, errors, duplicate lines, and checks balance delta.
    No rows are committed to the database at this stage.
    """
    mapping = None
    if column_mapping:
        try:
            mapping_dict = json.loads(column_mapping)
            mapping = CSVColumnMapping(**mapping_dict)
        except Exception:
            pass

    return await statements_service.preview_statement(
        account_id=account_id,
        period_month=period_month,
        file=file,
        mapping=mapping,
        encoding=encoding or "utf-8",
        date_format=date_format or "auto",
        decimal_separator=decimal_separator or ".",
        opening_balance=opening_balance,
        closing_balance=closing_balance,
    )


@router.post(
    "/accounts/{account_id}/statements",
    response_model=StatementImportResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("finance.account.write"))],
)
async def upload_bank_statement(
    account_id: int,
    period_month: str = Form(..., description="Statement period month (YYYY-MM)"),
    file: UploadFile = File(...),
    column_mapping: Optional[str] = Form(None, description="Optional JSON string of CSVColumnMapping"),
    opening_balance: Optional[float] = Form(None, description="Opening statement balance"),
    closing_balance: Optional[float] = Form(None, description="Closing statement balance"),
    encoding: Optional[str] = Form("utf-8", description="File text encoding"),
    date_format: Optional[str] = Form("auto", description="Date convention"),
    decimal_separator: Optional[str] = Form(".", description="Decimal separator"),
    allow_duplicate: bool = Form(False, description="Whether to permit importing a duplicate file"),
    review_state: Optional[str] = Form("needs_review", description="Initial review state"),
    statements_service: StatementsService = Depends(get_statements_service),
    current_user=Depends(require_permission("finance.account.write")),
):
    """Confirm and commit an ingested bank statement into database."""
    mapping = None
    if column_mapping:
        try:
            mapping_dict = json.loads(column_mapping)
            mapping = CSVColumnMapping(**mapping_dict)
        except Exception:
            pass

    user_email = current_user.get("email") if isinstance(current_user, dict) else str(current_user)
    return await statements_service.upload_and_parse_statement(
        account_id=account_id,
        period_month=period_month,
        file=file,
        mapping=mapping,
        opening_balance=opening_balance,
        closing_balance=closing_balance,
        encoding=encoding or "utf-8",
        date_format=date_format or "auto",
        decimal_separator=decimal_separator or ".",
        allow_duplicate=allow_duplicate,
        review_state=review_state or "needs_review",
        created_by=user_email,
    )


@router.delete(
    "/statements/{statement_id}",
    dependencies=[Depends(require_permission("finance.account.write"))],
)
def discard_statement_import(
    statement_id: int,
    statements_service: StatementsService = Depends(get_statements_service),
):
    """Safely discard an un-reconciled or interrupted statement import."""
    return statements_service.discard_statement(statement_id)


# Mapping Templates
@router.get(
    "/statements/templates",
    response_model=List[StatementMappingTemplateResponse],
    dependencies=[Depends(require_permission("finance.account.read"))],
)
def list_statement_templates(
    account_id: Optional[int] = Query(None, description="Optional filter by account ID"),
    statements_service: StatementsService = Depends(get_statements_service),
):
    """List reusable column mapping templates."""
    return statements_service.list_templates(account_id=account_id)


@router.post(
    "/statements/templates",
    response_model=StatementMappingTemplateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("finance.account.write"))],
)
def create_statement_template(
    req: StatementMappingTemplateCreate,
    statements_service: StatementsService = Depends(get_statements_service),
):
    """Save or update a reusable bank column mapping template."""
    return statements_service.create_template(req)


@router.delete(
    "/statements/templates/{template_id}",
    dependencies=[Depends(require_permission("finance.account.write"))],
)
def delete_statement_template(
    template_id: int,
    statements_service: StatementsService = Depends(get_statements_service),
):
    """Delete a saved column mapping template."""
    return statements_service.delete_template(template_id)


@router.get(
    "/accounts/{account_id}/statements",
    response_model=List[StatementImportResponse],
    dependencies=[Depends(require_permission("finance.account.read"))],
)
def list_account_statements(
    account_id: int,
    period_month: Optional[str] = Query(None, description="Filter by statement month YYYY-MM"),
    statements_service: StatementsService = Depends(get_statements_service),
):
    """List statement imports for a specific bank account."""
    return statements_service.list_statements(account_id=account_id, period_month=period_month)


@router.get(
    "/statements",
    response_model=List[StatementImportResponse],
    dependencies=[Depends(require_permission("finance.account.read"))],
)
def list_all_statements(
    account_id: Optional[int] = Query(None, description="Optional filter by account ID"),
    period_month: Optional[str] = Query(None, description="Filter by statement month YYYY-MM"),
    statements_service: StatementsService = Depends(get_statements_service),
):
    """List statement imports across all accounts or filtered by account."""
    return statements_service.list_statements(account_id=account_id, period_month=period_month)


@router.get(
    "/statements/{statement_id}",
    response_model=StatementImportResponse,
    dependencies=[Depends(require_permission("finance.account.read"))],
)
def get_statement_import(
    statement_id: int,
    statements_service: StatementsService = Depends(get_statements_service),
):
    """Get single statement import summary and progress."""
    return statements_service.get_statement(statement_id)


@router.get(
    "/statements/{statement_id}/lines",
    response_model=List[StatementLineResponse],
    dependencies=[Depends(require_permission("finance.account.read"))],
)
def get_statement_lines(
    statement_id: int,
    statements_service: StatementsService = Depends(get_statements_service),
):
    """List parsed statement lines with calculated suggested matches."""
    return statements_service.get_statement_lines(statement_id)


@router.post(
    "/statements/{statement_id}/lines/{line_id}/resolve",
    response_model=StatementLineResponse,
    dependencies=[Depends(require_permission("finance.account.write"))],
)
def resolve_statement_line(
    statement_id: int,
    line_id: int,
    req: StatementLineResolveRequest,
    statements_service: StatementsService = Depends(get_statements_service),
    current_user=Depends(require_permission("finance.account.write")),
):
    """Resolve a statement line: confirm match, auto-create ledger entry, or ignore."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else str(current_user)
    return statements_service.resolve_statement_line(
        import_id=statement_id,
        line_id=line_id,
        req=req,
        user_email=user_email,
    )


@router.get(
    "/statements/{statement_id}/summary",
    response_model=ReconciliationWorkspaceSummary,
    dependencies=[Depends(require_permission("finance.account.read"))],
)
def get_reconciliation_workspace_summary(
    statement_id: int,
    statements_service: StatementsService = Depends(get_statements_service),
):
    """Get live reconciliation workspace balance summary, differences, and resolved totals."""
    return statements_service.get_reconciliation_workspace_summary(statement_id)


@router.post(
    "/statements/{statement_id}/reconcile",
    response_model=StatementImportResponse,
    dependencies=[Depends(require_permission("finance.account.write"))],
)
def reconcile_statement_import(
    statement_id: int,
    statements_service: StatementsService = Depends(get_statements_service),
    current_user=Depends(require_permission("finance.account.write")),
):
    """Finalize reconciliation for a statement import once all lines are addressed."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else str(current_user)
    return statements_service.reconcile_statement(statement_id, user_email=user_email)


@router.post(
    "/statements/{statement_id}/close",
    response_model=StatementImportResponse,
    dependencies=[Depends(require_permission("finance.account.write"))],
)
def close_reconciliation_period(
    statement_id: int,
    req: ReconciliationCloseRequest,
    statements_service: StatementsService = Depends(get_statements_service),
    current_user=Depends(require_permission("finance.account.write")),
):
    """Close the reconciliation period with zero-difference gate or authorized exception override."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else str(current_user)
    return statements_service.close_period(statement_id, req, user_email=user_email)


@router.post(
    "/statements/{statement_id}/reopen",
    response_model=StatementImportResponse,
    dependencies=[Depends(require_permission("finance.account.write"))],
)
def reopen_reconciliation_period(
    statement_id: int,
    req: ReconciliationReopenRequest,
    statements_service: StatementsService = Depends(get_statements_service),
    current_user=Depends(require_permission("finance.account.write")),
):
    """Reopen a closed reconciliation period with mandatory audited justification."""
    user_email = current_user.get("email") if isinstance(current_user, dict) else str(current_user)
    return statements_service.reopen_period(statement_id, req, user_email=user_email)


@router.get(
    "/statements/{statement_id}/completion-report",
    response_model=ReconciliationCompletionReport,
    dependencies=[Depends(require_permission("finance.account.read"))],
)
def get_reconciliation_completion_report(
    statement_id: int,
    statements_service: StatementsService = Depends(get_statements_service),
):
    """Generate completion report with balance breakdown, line reconciliation metrics, and uncleared items."""
    return statements_service.get_completion_report(statement_id)

