"""
be/finance/routers/rules.py
Router for Reconciliation Rules (Phase 6 / Story 6.3):
- Suggestion vs. Auto-Apply rules
- Ordered rule evaluation & deterministic conflict detection
- Dry-run preview before activation
- Reversible auto-applied line resolution
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, status, HTTPException

from core.permissions import require_permission
from finance.schemas import (
    ReconciliationRuleCreate,
    ReconciliationRuleUpdate,
    ReconciliationRuleResponse,
    ReconciliationRulePreviewRequest,
    ReconciliationRulePreviewResponse,
    StatementApplyRulesResponse,
)
from finance.services.rules_service import RulesService
from finance.deps import get_rules_service

router = APIRouter(prefix="/api/finance", tags=["Finance - Reconciliation Rules"])


@router.get(
    "/rules",
    response_model=List[ReconciliationRuleResponse],
    summary="List prioritized reconciliation rules",
)
def list_reconciliation_rules(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    account_id: Optional[int] = Query(None, description="Filter by bank account scope"),
    mode: Optional[str] = Query(None, description="Filter by mode: suggestion | auto_apply"),
    rules_service: RulesService = Depends(get_rules_service),
    current_user: dict = Depends(require_permission("finance.account.read")),
):
    return rules_service.list_rules(is_active=is_active, account_id=account_id, mode=mode)


@router.post(
    "/rules",
    response_model=ReconciliationRuleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new reconciliation rule",
)
def create_reconciliation_rule(
    payload: ReconciliationRuleCreate,
    rules_service: RulesService = Depends(get_rules_service),
    current_user: dict = Depends(require_permission("finance.account.write")),
):
    user_email = current_user.get("email") or current_user.get("sub") or "user"
    return rules_service.create_rule(payload, user_email=user_email)


@router.get(
    "/rules/{rule_id}",
    response_model=ReconciliationRuleResponse,
    summary="Get reconciliation rule details",
)
def get_reconciliation_rule(
    rule_id: int,
    rules_service: RulesService = Depends(get_rules_service),
    current_user: dict = Depends(require_permission("finance.account.read")),
):
    return rules_service.get_rule(rule_id)


@router.put(
    "/rules/{rule_id}",
    response_model=ReconciliationRuleResponse,
    summary="Update an existing reconciliation rule",
)
def update_reconciliation_rule(
    rule_id: int,
    payload: ReconciliationRuleUpdate,
    rules_service: RulesService = Depends(get_rules_service),
    current_user: dict = Depends(require_permission("finance.account.write")),
):
    user_email = current_user.get("email") or current_user.get("sub") or "user"
    return rules_service.update_rule(rule_id, payload, user_email=user_email)


@router.delete(
    "/rules/{rule_id}",
    summary="Delete a reconciliation rule",
)
def delete_reconciliation_rule(
    rule_id: int,
    rules_service: RulesService = Depends(get_rules_service),
    current_user: dict = Depends(require_permission("finance.account.write")),
):
    return rules_service.delete_rule(rule_id)


@router.post(
    "/rules/preview",
    response_model=ReconciliationRulePreviewResponse,
    summary="Dry-run preview a rule candidate against unmatched lines to detect conflicts and inspect affected lines",
)
def preview_reconciliation_rule(
    payload: ReconciliationRulePreviewRequest,
    rules_service: RulesService = Depends(get_rules_service),
    current_user: dict = Depends(require_permission("finance.account.read")),
):
    return rules_service.preview_rule(payload)


@router.post(
    "/statements/{statement_id}/apply-rules",
    response_model=StatementApplyRulesResponse,
    summary="Execute active reconciliation rules against unmatched lines in a statement",
)
def apply_rules_to_statement(
    statement_id: int,
    dry_run: bool = Query(False, description="Simulate evaluation without modifying line statuses"),
    rules_service: RulesService = Depends(get_rules_service),
    current_user: dict = Depends(require_permission("finance.account.write")),
):
    actor = current_user.get("email") or current_user.get("sub") or "user"
    return rules_service.apply_rules_to_statement(statement_id, dry_run=dry_run, actor=actor)


@router.post(
    "/rules/{rule_id}/revert",
    summary="Revert all auto-applied line resolutions for a rule on non-reconciled statements",
)
def revert_rule_applications(
    rule_id: int,
    rules_service: RulesService = Depends(get_rules_service),
    current_user: dict = Depends(require_permission("finance.account.write")),
):
    return rules_service.revert_rule(rule_id)
