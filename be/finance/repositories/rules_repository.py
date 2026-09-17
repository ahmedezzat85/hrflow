"""
be/finance/repositories/rules_repository.py
Repository layer for Statement Reconciliation Rules:
- CRUD for prioritized rules
- Pattern & condition matching against statement lines
- Deterministic conflict detection
- Safe dry-run previews
- Auto-apply execution for approved rules
- Reversible resolution rollback
"""
import re
from datetime import datetime
from typing import List, Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, desc, asc

from finance.models import (
    ReconciliationRuleDB,
    StatementLineDB,
    BankStatementImportDB,
    LedgerTransactionDB,
    FinanceBankAccountDB,
    VendorDB,
)
from finance.schemas import (
    ReconciliationRuleCreate,
    ReconciliationRuleUpdate,
    RuleMatchConflict,
)


class RulesRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_rules(
        self,
        is_active: Optional[bool] = None,
        account_id: Optional[int] = None,
        mode: Optional[str] = None,
    ) -> List[ReconciliationRuleDB]:
        """Fetch rules ordered by priority ascending (1 = highest priority), then id ascending."""
        query = self.db.query(ReconciliationRuleDB)
        if is_active is not None:
            query = query.filter(ReconciliationRuleDB.is_active == is_active)
        if account_id is not None:
            query = query.filter(
                or_(
                    ReconciliationRuleDB.account_id == account_id,
                    ReconciliationRuleDB.account_id.is_(None),
                )
            )
        if mode is not None:
            query = query.filter(ReconciliationRuleDB.mode == mode)

        return query.order_by(
            ReconciliationRuleDB.priority.asc(), ReconciliationRuleDB.id.asc()
        ).all()

    def get_rule_by_id(self, rule_id: int) -> Optional[ReconciliationRuleDB]:
        return self.db.query(ReconciliationRuleDB).filter(ReconciliationRuleDB.id == rule_id).first()

    def get_rule_by_name(self, name: str) -> Optional[ReconciliationRuleDB]:
        return self.db.query(ReconciliationRuleDB).filter(ReconciliationRuleDB.name == name.strip()).first()

    def create_rule(self, data: ReconciliationRuleCreate) -> ReconciliationRuleDB:
        existing = self.get_rule_by_name(data.name)
        if existing:
            raise ValueError(f"A reconciliation rule with name '{data.name}' already exists.")

        # If auto_apply, require approval
        is_approved = bool(data.is_approved) if data.mode == "auto_apply" else False
        approved_by = data.approved_by if is_approved else None

        rule = ReconciliationRuleDB(
            name=data.name.strip(),
            description=data.description or "",
            priority=data.priority,
            is_active=data.is_active,
            mode=data.mode,
            account_id=data.account_id,
            description_pattern=data.description_pattern.strip() if data.description_pattern else None,
            direction=data.direction,
            min_amount=data.min_amount,
            max_amount=data.max_amount,
            counterparty=data.counterparty.strip() if data.counterparty else None,
            action=data.action,
            target_category=data.target_category,
            target_vendor_id=data.target_vendor_id,
            payment_method=data.payment_method or "bank_transfer",
            audit_reason=data.audit_reason.strip() if data.audit_reason else None,
            creator=data.creator,
            approved_by=approved_by,
            is_approved=is_approved,
        )
        self.db.add(rule)
        self.db.commit()
        self.db.refresh(rule)
        return rule

    def update_rule(self, rule_id: int, data: ReconciliationRuleUpdate) -> Optional[ReconciliationRuleDB]:
        rule = self.get_rule_by_id(rule_id)
        if not rule:
            return None

        update_data = data.dict(exclude_unset=True)
        if "name" in update_data and update_data["name"]:
            name = update_data["name"].strip()
            existing = self.get_rule_by_name(name)
            if existing and existing.id != rule.id:
                raise ValueError(f"A reconciliation rule with name '{name}' already exists.")
            rule.name = name

        for field in [
            "description",
            "priority",
            "is_active",
            "mode",
            "account_id",
            "description_pattern",
            "direction",
            "min_amount",
            "max_amount",
            "counterparty",
            "action",
            "target_category",
            "target_vendor_id",
            "payment_method",
            "audit_reason",
            "is_approved",
            "approved_by",
        ]:
            if field in update_data:
                setattr(rule, field, update_data[field])

        # Security check: if mode switched to auto_apply without approval, force unapproved
        if rule.mode == "auto_apply" and not rule.is_approved:
            rule.is_approved = False
            rule.approved_by = None

        rule.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(rule)
        return rule

    def delete_rule(self, rule_id: int) -> bool:
        rule = self.get_rule_by_id(rule_id)
        if not rule:
            return False
        self.db.delete(rule)
        self.db.commit()
        return True

    def line_matches_rule(
        self,
        line: StatementLineDB,
        rule: Any,
        account_id: Optional[int] = None,
    ) -> bool:
        """Evaluates whether a statement line meets all criteria of a given rule."""
        target_acc = account_id
        if target_acc is None and line.statement_import:
            target_acc = line.statement_import.account_id

        # Account scope
        if rule.account_id is not None and target_acc is not None:
            if rule.account_id != target_acc:
                return False

        # Direction check
        if rule.direction and rule.direction.strip():
            if line.direction != rule.direction.strip():
                return False

        # Amount bounds
        amt = float(line.raw_amount)
        if rule.min_amount is not None:
            if amt < float(rule.min_amount):
                return False
        if rule.max_amount is not None:
            if amt > float(rule.max_amount):
                return False

        # Description pattern (regex or substring match, case-insensitive)
        if rule.description_pattern and rule.description_pattern.strip():
            pat = rule.description_pattern.strip()
            haystack = f"{line.raw_description or ''} {line.raw_reference or ''}".lower()
            try:
                if not re.search(pat, haystack, re.IGNORECASE):
                    return False
            except re.error:
                # If invalid regex, fallback to substring
                if pat.lower() not in haystack:
                    return False

        # Counterparty check
        if rule.counterparty and rule.counterparty.strip():
            cp = rule.counterparty.strip().lower()
            haystack = f"{line.raw_description or ''}".lower()
            if cp not in haystack:
                return False

        return True

    def preview_rule_matches(
        self,
        rule_candidate: Any,
        statement_id: Optional[int] = None,
        account_id: Optional[int] = None,
    ) -> Tuple[List[StatementLineDB], List[RuleMatchConflict]]:
        """
        Runs dry-run evaluation of rule_candidate across unmatched statement lines.
        Detects conflicts against existing active rules in the system.
        """
        query = (
            self.db.query(StatementLineDB)
            .options(joinedload(StatementLineDB.statement_import))
            .filter(StatementLineDB.status == "unmatched")
        )

        if statement_id:
            query = query.filter(StatementLineDB.import_id == statement_id)
        elif account_id:
            query = query.join(StatementLineDB.statement_import).filter(
                BankStatementImportDB.account_id == account_id
            )

        unmatched_lines = query.order_by(StatementLineDB.raw_date.desc(), StatementLineDB.id.desc()).all()

        # Get existing active rules
        active_rules = self.get_rules(is_active=True)

        matched_lines: List[StatementLineDB] = []
        conflicts: List[RuleMatchConflict] = []

        for line in unmatched_lines:
            line_acc_id = line.statement_import.account_id if line.statement_import else None
            if self.line_matches_rule(line, rule_candidate, account_id=line_acc_id):
                matched_lines.append(line)

                # Check if other existing rules also match this line
                for existing_rule in active_rules:
                    # Skip self if updating
                    if getattr(rule_candidate, "id", None) and existing_rule.id == rule_candidate.id:
                        continue

                    if self.line_matches_rule(line, existing_rule, account_id=line_acc_id):
                        # Both match! Determine winner by priority
                        candidate_priority = getattr(rule_candidate, "priority", 10)
                        candidate_name = getattr(rule_candidate, "name", "New Rule")
                        candidate_id = getattr(rule_candidate, "id", 0) or 0

                        if candidate_priority < existing_rule.priority:
                            winner_id, winner_name = candidate_id, candidate_name
                            loser_id, loser_name = existing_rule.id, existing_rule.name
                            reason = f"Candidate rule '{candidate_name}' (priority {candidate_priority}) takes precedence over '{existing_rule.name}' (priority {existing_rule.priority})."
                        elif existing_rule.priority < candidate_priority:
                            winner_id, winner_name = existing_rule.id, existing_rule.name
                            loser_id, loser_name = candidate_id, candidate_name
                            reason = f"Existing rule '{existing_rule.name}' (priority {existing_rule.priority}) takes precedence over candidate rule '{candidate_name}' (priority {candidate_priority})."
                        else:
                            # Equal priority: deterministic tie-breaker by ID
                            if candidate_id and candidate_id < existing_rule.id:
                                winner_id, winner_name = candidate_id, candidate_name
                                loser_id, loser_name = existing_rule.id, existing_rule.name
                                reason = f"Equal priority {candidate_priority}: rule #{candidate_id} selected deterministically."
                            else:
                                winner_id, winner_name = existing_rule.id, existing_rule.name
                                loser_id, loser_name = candidate_id, candidate_name
                                reason = f"Equal priority {candidate_priority}: rule #{existing_rule.id} selected deterministically."

                        conflicts.append(
                            RuleMatchConflict(
                                winning_rule_id=winner_id,
                                winning_rule_name=winner_name,
                                conflicting_rule_id=loser_id,
                                conflicting_rule_name=loser_name,
                                line_id=line.id,
                                conflict_reason=reason,
                            )
                        )

        return matched_lines, conflicts

    def execute_rules_on_statement(
        self,
        statement_id: int,
        dry_run: bool = False,
        actor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Evaluates and applies active reconciliation rules on unmatched lines of a statement.
        - Rules evaluated in priority order.
        - Suggestions attach metadata/notes.
        - Approved auto_apply rules resolve lines (auto-create ledger entry or auto-ignore).
        """
        statement = (
            self.db.query(BankStatementImportDB)
            .filter(BankStatementImportDB.id == statement_id)
            .first()
        )
        if not statement:
            raise ValueError(f"Statement Import #{statement_id} not found.")

        active_rules = self.get_rules(is_active=True, account_id=statement.account_id)
        if not active_rules:
            return {
                "statement_id": statement_id,
                "evaluated_lines_count": 0,
                "suggestions_count": 0,
                "auto_applied_count": 0,
                "conflicts": [],
                "updated_lines": [],
            }

        unmatched_lines = (
            self.db.query(StatementLineDB)
            .filter(
                StatementLineDB.import_id == statement_id,
                StatementLineDB.status == "unmatched",
            )
            .order_by(StatementLineDB.id.asc())
            .all()
        )

        evaluated_count = len(unmatched_lines)
        suggestions_count = 0
        auto_applied_count = 0
        conflicts: List[RuleMatchConflict] = []
        updated_lines: List[StatementLineDB] = []

        for line in unmatched_lines:
            matching_rules = [
                r for r in active_rules if self.line_matches_rule(line, r, statement.account_id)
            ]
            if not matching_rules:
                continue

            # Deterministic winning rule: lowest priority number (highest precedence)
            winning_rule = matching_rules[0]

            if len(matching_rules) > 1:
                for loser in matching_rules[1:]:
                    conflicts.append(
                        RuleMatchConflict(
                            winning_rule_id=winning_rule.id,
                            winning_rule_name=winning_rule.name,
                            conflicting_rule_id=loser.id,
                            conflicting_rule_name=loser.name,
                            line_id=line.id,
                            conflict_reason=f"Winning rule '{winning_rule.name}' (priority {winning_rule.priority}) superseded '{loser.name}' (priority {loser.priority}).",
                        )
                    )

            if dry_run:
                continue

            # Mode handling
            if winning_rule.mode == "suggestion":
                suggestion_note = f"[Rule: {winning_rule.name}] Suggest: {winning_rule.action}"
                if winning_rule.target_category:
                    suggestion_note += f" -> Category: {winning_rule.target_category}"
                if not line.notes:
                    line.notes = suggestion_note
                elif suggestion_note not in line.notes:
                    line.notes = f"{line.notes} | {suggestion_note}"
                line.applied_rule_id = winning_rule.id
                line.is_auto_applied = False
                suggestions_count += 1
                updated_lines.append(line)

            elif winning_rule.mode == "auto_apply" and winning_rule.is_approved:
                if winning_rule.action == "auto_ignore":
                    line.status = "ignored"
                    line.notes = (
                        winning_rule.audit_reason
                        or f"Auto-ignored by approved rule '{winning_rule.name}'"
                    )
                    line.applied_rule_id = winning_rule.id
                    line.is_auto_applied = True
                    auto_applied_count += 1
                    updated_lines.append(line)

                elif winning_rule.action == "auto_create":
                    desc = (
                        f"{line.raw_description or 'Statement line'} (Auto-created by rule {winning_rule.name})"
                    )

                    account = (
                        self.db.query(FinanceBankAccountDB)
                        .filter(FinanceBankAccountDB.id == statement.account_id)
                        .first()
                    )
                    curr = account.currency if account else "USD"

                    new_tx = LedgerTransactionDB(
                        account_id=statement.account_id,
                        date=line.raw_date,
                        amount=line.raw_amount,
                        direction=line.direction,
                        currency=curr,
                        reference=line.raw_reference or f"RULE-{winning_rule.id}",
                        description=desc,
                        source="statement_import",
                        entry_type="bank_fee" if "FEE" in desc.upper() else "standard",
                        created_at=datetime.utcnow(),
                        created_by=actor or "system:rule-engine",
                    )
                    self.db.add(new_tx)
                    self.db.flush()

                    from finance.repositories.ledger_repository import LedgerRepository
                    LedgerRepository(self.db).recalculate_account_running_balances(statement.account_id)

                    line.status = "created"
                    line.matched_transaction_id = new_tx.id
                    line.applied_rule_id = winning_rule.id
                    line.is_auto_applied = True
                    auto_applied_count += 1
                    updated_lines.append(line)

                winning_rule.times_applied += 1
                winning_rule.last_used_at = datetime.utcnow()

        if not dry_run and updated_lines:
            resolved_count = (
                self.db.query(StatementLineDB)
                .filter(
                    StatementLineDB.import_id == statement_id,
                    StatementLineDB.status.in_(["matched", "created", "ignored", "split"]),
                )
                .count()
            )
            statement.matched_lines_count = resolved_count
            self.db.commit()

        return {
            "statement_id": statement_id,
            "evaluated_lines_count": evaluated_count,
            "suggestions_count": suggestions_count,
            "auto_applied_count": auto_applied_count,
            "conflicts": conflicts,
            "updated_lines": updated_lines,
        }

    def revert_rule_applications(self, rule_id: int) -> int:
        """
        Reverts any auto-applied lines made by this rule on non-reconciled statements.
        Guarantees that auto-applied results are identifiable and reversible.
        """
        rule = self.get_rule_by_id(rule_id)
        if not rule:
            raise ValueError(f"Rule #{rule_id} not found.")

        lines = (
            self.db.query(StatementLineDB)
            .join(StatementLineDB.statement_import)
            .filter(
                StatementLineDB.applied_rule_id == rule_id,
                StatementLineDB.is_auto_applied.is_(True),
                BankStatementImportDB.status != "reconciled",
            )
            .all()
        )

        reverted_count = 0
        affected_imports = set()

        for line in lines:
            if line.matched_transaction_id and line.status == "created":
                tx = (
                    self.db.query(LedgerTransactionDB)
                    .filter(LedgerTransactionDB.id == line.matched_transaction_id)
                    .first()
                )
                if tx:
                    self.db.delete(tx)
                line.matched_transaction_id = None

            line.status = "unmatched"
            line.applied_rule_id = None
            line.is_auto_applied = False
            line.notes = f"{line.notes} [Reverted rule #{rule_id}]".strip()
            affected_imports.add(line.import_id)
            reverted_count += 1

        rule.times_applied = max(0, rule.times_applied - reverted_count)

        for imp_id in affected_imports:
            resolved_count = (
                self.db.query(StatementLineDB)
                .filter(
                    StatementLineDB.import_id == imp_id,
                    StatementLineDB.status.in_(["matched", "created", "ignored", "split"]),
                )
                .count()
            )
            imp = (
                self.db.query(BankStatementImportDB)
                .filter(BankStatementImportDB.id == imp_id)
                .first()
            )
            if imp:
                imp.matched_lines_count = resolved_count

        self.db.commit()
        return reverted_count
