"""
be/finance/routers/statements.py
Router for Bank Statement Imports and Review-Driven Reconciliation (Phase 7).
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
    CSVColumnMapping,
)
from finance.services.statements_service import StatementsService
from finance.deps import get_statements_service

router = APIRouter(prefix="/api/finance", tags=["Finance - Bank Statements & Reconciliation"])


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
    statements_service: StatementsService = Depends(get_statements_service),
    current_user=Depends(require_permission("finance.account.write")),
):
    """Upload and ingest a monthly bank statement (CSV or PDF)."""
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
        created_by=user_email,
    )


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
