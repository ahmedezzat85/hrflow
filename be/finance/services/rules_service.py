"""
be/finance/services/rules_service.py
Service layer for Reconciliation Rules:
- Rules management & validation
- Deterministic conflict detection
- Previews before activation
- Controlled statement rule execution
- Reversal of auto-applied resolutions
"""
from typing import List, Optional, Dict, Any
from fastapi import HTTPException, status

from finance.repositories.rules_repository import RulesRepository
from finance.repositories.statements_repository import StatementsRepository
from finance.models import ReconciliationRuleDB, StatementLineDB
from finance.schemas import (
    ReconciliationRuleCreate,
    ReconciliationRuleUpdate,
    ReconciliationRuleResponse,
    ReconciliationRulePreviewRequest,
    ReconciliationRulePreviewResponse,
    StatementApplyRulesResponse,
    StatementLineResponse,
    SuggestedMatch,
)


class RulesService:
    def __init__(self, rules_repo: RulesRepository, statements_repo: Optional[StatementsRepository] = None):
        self.rules_repo = rules_repo
        self.statements_repo = statements_repo

    def _rule_to_response(self, rule: ReconciliationRuleDB) -> ReconciliationRuleResponse:
        return ReconciliationRuleResponse.from_orm(rule)

    def _line_to_response(self, line: StatementLineDB) -> StatementLineResponse:
        return StatementLineResponse(
            id=line.id,
            import_id=line.import_id,
            raw_date=line.raw_date,
            raw_amount=line.raw_amount,
            direction=line.direction,
            raw_description=line.raw_description,
            raw_reference=line.raw_reference or "",
            status=line.status,
            notes=line.notes or "",
            matched_transaction_id=line.matched_transaction_id,
            matched_cheque_id=line.matched_cheque_id,
            applied_rule_id=line.applied_rule_id,
            is_auto_applied=line.is_auto_applied,
            parent_line_id=line.parent_line_id,
            created_at=line.created_at,
            suggested_matches=[],
            child_lines=[],
        )

    def list_rules(
        self,
        is_active: Optional[bool] = None,
        account_id: Optional[int] = None,
        mode: Optional[str] = None,
    ) -> List[ReconciliationRuleResponse]:
        rules = self.rules_repo.get_rules(is_active=is_active, account_id=account_id, mode=mode)
        return [self._rule_to_response(r) for r in rules]

    def get_rule(self, rule_id: int) -> ReconciliationRuleResponse:
        rule = self.rules_repo.get_rule_by_id(rule_id)
        if not rule:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Rule #{rule_id} not found")
        return self._rule_to_response(rule)

    def create_rule(self, data: ReconciliationRuleCreate, user_email: Optional[str] = None) -> ReconciliationRuleResponse:
        if user_email and not data.creator:
            data.creator = user_email

        # If user requests auto_apply, ensure approval semantics
        if data.mode == "auto_apply" and data.is_approved:
            data.approved_by = user_email or "admin"

        try:
            rule = self.rules_repo.create_rule(data)
            return self._rule_to_response(rule)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    def update_rule(self, rule_id: int, data: ReconciliationRuleUpdate, user_email: Optional[str] = None) -> ReconciliationRuleResponse:
        if data.is_approved and not data.approved_by:
            data.approved_by = user_email or "admin"

        try:
            rule = self.rules_repo.update_rule(rule_id, data)
            if not rule:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Rule #{rule_id} not found")
            return self._rule_to_response(rule)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    def delete_rule(self, rule_id: int) -> Dict[str, Any]:
        success = self.rules_repo.delete_rule(rule_id)
        if not success:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Rule #{rule_id} not found")
        return {"status": "success", "message": f"Rule #{rule_id} deleted successfully"}

    def preview_rule(self, req: ReconciliationRulePreviewRequest) -> ReconciliationRulePreviewResponse:
        """Evaluates rule candidate against current unmatched lines without mutating state."""
        matched_lines, conflicts = self.rules_repo.preview_rule_matches(
            req.rule,
            statement_id=req.statement_id,
            account_id=req.account_id or req.rule.account_id,
        )

        sample_lines = [self._line_to_response(l) for l in matched_lines[:10]]
        summary = (
            f"Rule '{req.rule.name}' matches {len(matched_lines)} unmatched statement line(s). "
            f"Detected {len(conflicts)} conflict(s) with existing rules."
        )

        return ReconciliationRulePreviewResponse(
            matched_lines_count=len(matched_lines),
            sample_matched_lines=sample_lines,
            conflicts=conflicts,
            mode=req.rule.mode,
            is_approved=bool(req.rule.is_approved),
            summary=summary,
        )

    def apply_rules_to_statement(
        self,
        statement_id: int,
        dry_run: bool = False,
        actor: Optional[str] = None,
    ) -> StatementApplyRulesResponse:
        try:
            result = self.rules_repo.execute_rules_on_statement(
                statement_id=statement_id,
                dry_run=dry_run,
                actor=actor,
            )
            return StatementApplyRulesResponse(
                statement_id=statement_id,
                evaluated_lines_count=result["evaluated_lines_count"],
                suggestions_count=result["suggestions_count"],
                auto_applied_count=result["auto_applied_count"],
                conflicts=result["conflicts"],
                updated_lines=[self._line_to_response(l) for l in result["updated_lines"]],
            )
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    def revert_rule(self, rule_id: int) -> Dict[str, Any]:
        try:
            reverted_count = self.rules_repo.revert_rule_applications(rule_id)
            return {
                "rule_id": rule_id,
                "reverted_lines_count": reverted_count,
                "status": "success",
                "message": f"Successfully reverted {reverted_count} line resolution(s) auto-applied by rule #{rule_id}.",
            }
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
