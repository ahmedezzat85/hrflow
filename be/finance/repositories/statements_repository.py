"""
be/finance/repositories/statements_repository.py
Repository for Bank Statement Imports, Statement Lines, and Reconciliation Matching.
"""
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc, and_

from finance.models import (
    BankStatementImportDB,
    StatementLineDB,
    LedgerTransactionDB,
    FinanceChequeDB,
    FinanceBankAccountDB,
    FinanceAttachmentDB,
)
from finance.schemas import SuggestedMatch


class StatementsRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_import(
        self,
        account_id: int,
        period_month: str,
        file_type: str,
        uploaded_file_ref: str,
        created_by: Optional[str] = None,
    ) -> BankStatementImportDB:
        statement_import = BankStatementImportDB(
            account_id=account_id,
            period_month=period_month,
            file_type=file_type,
            status="needs_review",
            uploaded_file_ref=uploaded_file_ref,
            total_lines_count=0,
            matched_lines_count=0,
            created_at=datetime.utcnow(),
            created_by=created_by,
        )
        self.db.add(statement_import)
        self.db.commit()
        self.db.refresh(statement_import)
        return statement_import

    def get_import_by_id(self, import_id: int) -> Optional[BankStatementImportDB]:
        return (
            self.db.query(BankStatementImportDB)
            .options(
                joinedload(BankStatementImportDB.account),
                joinedload(BankStatementImportDB.attachments),
            )
            .filter(BankStatementImportDB.id == import_id)
            .first()
        )

    def list_imports(
        self, account_id: Optional[int] = None, period_month: Optional[str] = None
    ) -> List[BankStatementImportDB]:
        query = self.db.query(BankStatementImportDB).options(
            joinedload(BankStatementImportDB.account),
            joinedload(BankStatementImportDB.attachments),
        )
        if account_id:
            query = query.filter(BankStatementImportDB.account_id == account_id)
        if period_month:
            query = query.filter(BankStatementImportDB.period_month == period_month)
        return query.order_by(desc(BankStatementImportDB.created_at)).all()

    def add_statement_lines(
        self, import_id: int, lines_data: List[Dict[str, Any]]
    ) -> List[StatementLineDB]:
        lines: List[StatementLineDB] = []
        for d in lines_data:
            line = StatementLineDB(
                import_id=import_id,
                raw_date=d.get("raw_date", datetime.utcnow().strftime("%Y-%m-%d")),
                raw_amount=float(d.get("raw_amount", 0.0)),
                direction=d.get("direction", "out"),
                raw_description=d.get("raw_description", ""),
                raw_reference=d.get("raw_reference", ""),
                status="unmatched",
                notes="",
                created_at=datetime.utcnow(),
            )
            self.db.add(line)
            lines.append(line)

        # Update total count on import
        statement_import = (
            self.db.query(BankStatementImportDB)
            .filter(BankStatementImportDB.id == import_id)
            .first()
        )
        if statement_import:
            statement_import.total_lines_count += len(lines)

        self.db.commit()
        for l in lines:
            self.db.refresh(l)
        return lines

    def get_statement_lines(self, import_id: int) -> List[StatementLineDB]:
        return (
            self.db.query(StatementLineDB)
            .options(
                joinedload(StatementLineDB.matched_transaction),
                joinedload(StatementLineDB.matched_cheque),
            )
            .filter(StatementLineDB.import_id == import_id)
            .order_by(StatementLineDB.raw_date.asc(), StatementLineDB.id.asc())
            .all()
        )

    def get_line_by_id(self, line_id: int) -> Optional[StatementLineDB]:
        return (
            self.db.query(StatementLineDB)
            .options(
                joinedload(StatementLineDB.statement_import),
                joinedload(StatementLineDB.matched_transaction),
                joinedload(StatementLineDB.matched_cheque),
            )
            .filter(StatementLineDB.id == line_id)
            .first()
        )

    def find_suggested_matches(
        self, account_id: int, line: StatementLineDB
    ) -> List[SuggestedMatch]:
        suggestions: List[SuggestedMatch] = []
        target_amount = line.raw_amount
        target_dir = line.direction

        try:
            line_dt = datetime.strptime(line.raw_date, "%Y-%m-%d")
        except ValueError:
            line_dt = datetime.utcnow()

        # 1. Match against Ledger Transactions on same account and direction
        # Look for transactions within 10 days before/after
        min_date = (line_dt - timedelta(days=10)).strftime("%Y-%m-%d")
        max_date = (line_dt + timedelta(days=10)).strftime("%Y-%m-%d")

        candidate_txs = (
            self.db.query(LedgerTransactionDB)
            .filter(
                LedgerTransactionDB.account_id == account_id,
                LedgerTransactionDB.direction == target_dir,
                LedgerTransactionDB.date >= min_date,
                LedgerTransactionDB.date <= max_date,
            )
            .all()
        )

        for tx in candidate_txs:
            score = 0.0
            reasons = []

            # Check exact amount
            if abs(tx.amount - target_amount) < 0.01:
                score += 0.6
                reasons.append("Exact amount match")
            elif abs(tx.amount - target_amount) / (target_amount or 1.0) < 0.05:
                score += 0.3
                reasons.append("Proximity amount match")
            else:
                continue

            # Check date proximity
            try:
                tx_dt = datetime.strptime(tx.date, "%Y-%m-%d")
                day_diff = abs((tx_dt - line_dt).days)
                if day_diff == 0:
                    score += 0.4
                    reasons.append("Exact date match")
                elif day_diff <= 3:
                    score += 0.3
                    reasons.append(f"Within {day_diff} day(s)")
                elif day_diff <= 7:
                    score += 0.1
                    reasons.append(f"Within {day_diff} days")
            except ValueError:
                pass

            # Check reference / description text similarity
            if (
                line.raw_reference
                and tx.reference
                and line.raw_reference.lower() in tx.reference.lower()
            ):
                score += 0.2
                reasons.append("Reference match")

            suggestions.append(
                SuggestedMatch(
                    transaction_id=tx.id,
                    cheque_id=None,
                    match_type="exact_transaction" if score >= 0.9 else "probable_transaction",
                    score=min(round(score, 2), 1.0),
                    date=tx.date,
                    amount=tx.amount,
                    direction=tx.direction,
                    description=tx.description or "Ledger Outflow" if tx.direction == "out" else "Ledger Inflow",
                    reference=tx.reference or "",
                    reason=", ".join(reasons),
                )
            )

        # 2. Match against Issued Cheques if direction is outflow
        if target_dir == "out":
            candidate_cheques = (
                self.db.query(FinanceChequeDB)
                .filter(
                    FinanceChequeDB.account_id == account_id,
                    FinanceChequeDB.status == "issued",
                )
                .all()
            )
            for chq in candidate_cheques:
                if abs(chq.amount - target_amount) < 0.01:
                    score = 0.7
                    reasons = ["Cheque amount match", f"Cheque #{chq.cheque_number}"]
                    try:
                        chq_dt = datetime.strptime(chq.issue_date, "%Y-%m-%d")
                        diff = abs((line_dt - chq_dt).days)
                        if diff <= 7:
                            score += 0.25
                            reasons.append("Issued within 7 days")
                    except ValueError:
                        pass

                    # If statement description mentions cheque number
                    if chq.cheque_number in line.raw_description or (
                        line.raw_reference and chq.cheque_number in line.raw_reference
                    ):
                        score += 0.2
                        reasons.append("Cheque number found in statement")

                    suggestions.append(
                        SuggestedMatch(
                            transaction_id=chq.linked_transaction_id,
                            cheque_id=chq.id,
                            match_type="cheque",
                            score=min(round(score, 2), 1.0),
                            date=chq.issue_date,
                            amount=chq.amount,
                            direction="out",
                            description=f"Cheque #{chq.cheque_number} to {chq.payee}",
                            reference=chq.cheque_number,
                            reason=", ".join(reasons),
                        )
                    )

        # Sort descending by score
        suggestions.sort(key=lambda s: s.score, reverse=True)
        return suggestions

    def resolve_line(
        self,
        line: StatementLineDB,
        action: str,
        matched_transaction_id: Optional[int] = None,
        matched_cheque_id: Optional[int] = None,
        category_id: Optional[int] = None,
        payment_type_id: Optional[int] = None,
        description: Optional[str] = None,
        reference: Optional[str] = None,
        notes: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> StatementLineDB:
        account_id = line.statement_import.account_id

        if action == "match":
            if matched_cheque_id:
                chq = (
                    self.db.query(FinanceChequeDB)
                    .filter(FinanceChequeDB.id == matched_cheque_id)
                    .first()
                )
                if chq:
                    chq.status = "cleared"
                    chq.clear_date = line.raw_date
                    line.matched_cheque_id = chq.id
                    if chq.linked_transaction_id:
                        line.matched_transaction_id = chq.linked_transaction_id
            elif matched_transaction_id:
                line.matched_transaction_id = matched_transaction_id

            line.status = "matched"
            if notes:
                line.notes = notes

        elif action == "create":
            # Auto-create ledger transaction
            account = (
                self.db.query(FinanceBankAccountDB)
                .filter(FinanceBankAccountDB.id == account_id)
                .first()
            )
            curr = account.currency if account else "USD"

            tx = LedgerTransactionDB(
                account_id=account_id,
                date=line.raw_date,
                amount=line.raw_amount,
                direction=line.direction,
                currency=curr,
                category_id=category_id,
                payment_type_id=payment_type_id,
                reference=reference or line.raw_reference or "STMT-RESOLVE",
                description=description or line.raw_description or "Statement line reconciliation",
                source="statement_import",
                created_at=datetime.utcnow(),
                created_by=created_by,
            )
            self.db.add(tx)
            self.db.flush()

            # Recalculate running balance
            from finance.repositories.ledger_repository import LedgerRepository
            ledger_repo = LedgerRepository(self.db)
            ledger_repo.recalculate_account_running_balances(account_id)

            line.matched_transaction_id = tx.id
            line.status = "created"
            if notes:
                line.notes = notes

        elif action == "ignore":
            line.status = "ignored"
            if notes:
                line.notes = notes

        # Update matched lines count on import
        matched_count = (
            self.db.query(StatementLineDB)
            .filter(
                StatementLineDB.import_id == line.import_id,
                StatementLineDB.status.in_(["matched", "created", "ignored"]),
            )
            .count()
        )
        line.statement_import.matched_lines_count = matched_count

        self.db.commit()
        self.db.refresh(line)
        return line

    def reconcile_import(
        self, import_id: int, user_email: Optional[str] = None
    ) -> BankStatementImportDB:
        statement_import = (
            self.db.query(BankStatementImportDB)
            .filter(BankStatementImportDB.id == import_id)
            .first()
        )
        if not statement_import:
            raise ValueError("Statement import not found")

        matched_count = (
            self.db.query(StatementLineDB)
            .filter(
                StatementLineDB.import_id == import_id,
                StatementLineDB.status.in_(["matched", "created", "ignored"]),
            )
            .count()
        )
        statement_import.matched_lines_count = matched_count
        statement_import.status = "reconciled"
        statement_import.reconciled_at = datetime.utcnow()
        statement_import.reconciled_by = user_email
        self.db.commit()
        self.db.refresh(statement_import)
        return statement_import
