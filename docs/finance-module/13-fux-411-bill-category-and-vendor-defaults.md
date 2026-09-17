# FUX-411 — Bill category dropdown fix and default category per vendor

Related: `docs/finance-module/08-fux-406-unified-settlement-linking.md`, `docs/finance-module/10-fux-408-combined-bill-payment-guard.md`

**User story:** As a finance user, I want bill categorization to use the same governed category list as the rest of Finance, and I want recurring vendors (like utility or internet providers) to default to the correct category automatically, so that bill payments never silently land in "Other" and I don't have to reselect the same category every time I bill the same vendor.

## Context

Direct review of `bills_repository.record_payment()` confirms the reported behavior. When a bill payment is recorded, the system attempts to resolve a ledger category by string-matching `bill.category` against `TransactionCategoryDB.name`:

```python
bill_cat = None
if bill and bill.category:
    bill_cat = self.db.query(TransactionCategoryDB).filter(
        TransactionCategoryDB.name.ilike(bill.category.strip())
    ).first()
if not bill_cat:
    bill_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == "Other").first()
```

The root cause is that the bill creation/edit form's Category field is a free-text `<input>`, not a dropdown bound to the same `TransactionCategory` table used everywhere else in Finance (Add Transaction, Reports, Category Spend Rollup). Any bill created with an empty category field, or with text that does not exactly match an existing category name (case-insensitive), silently falls back to "Other" at payment time with no warning that the fallback occurred. This has likely caused an unknown number of historical bill payments to be miscategorized without visibility into which ones.

Separately, a complementary improvement was confirmed as standard, well-established practice across QuickBooks, Xero, ERPNext, and other accounting platforms: a **default expense category/account per vendor**, which pre-fills on new transactions for that vendor but always remains overridable per transaction. This directly serves the common case of recurring vendors (electricity, internet, hosting providers) who almost always bill the same category, reducing repetitive re-selection without removing the ability to categorize an exceptional bill differently.

## High-level scope

1. Replace the bill form's free-text Category field with a `category_id` dropdown sourced from the same `TransactionCategory` list used by Add Transaction and Reports.
2. Update `bills_repository.record_payment()` (and any other code path relying on `bill.category` string matching) to use `bill.category_id` directly, removing the string-matching lookup and the silent "Other" fallback entirely.
3. Add an optional `default_category_id` field to the Vendor profile.
4. When creating a new bill and selecting a vendor that has a default category set, auto-select that category in the bill's Category dropdown — pre-filled, not locked, and freely editable for that specific bill.
5. Provide a one-time data-quality pass identifying existing bills whose free-text `category` did not match any real category (i.e., bills that were silently miscategorized as "Other" historically), so those can be reviewed and corrected rather than left permanently misclassified.

## Implementation level

- Add `category_id` (FK to `TransactionCategoryDB`, nullable during migration) to `BillDB`, alongside the existing `category` string field (kept temporarily for backward compatibility and migration purposes, not removed immediately).
- Add a one-time migration attempting to backfill `category_id` on existing bills by matching the existing free-text `category` value against `TransactionCategoryDB.name`, and producing a report of bills where no match was found (these are the historically-miscategorized "Other" bills needing manual review).
- Update `bill-modal.html`'s Category field from `<input type="text" id="billCategory">` to a `<select id="billCategoryId">` populated from `GET /api/finance/categories`, matching the pattern already used correctly for the transaction modal's category dropdown.
- Update `bills_service.create_bill()` / `update_bill()` to accept and persist `category_id` directly.
- Update `bills_repository.record_payment()` to use `bill.category_id` directly when constructing the settlement's `LedgerTransaction`, removing the `ilike` string-match block and its "Other" fallback entirely. If `bill.category_id` is somehow null at payment time (should not normally happen once the dropdown is enforced), fall back to "Other" explicitly with a visible warning logged/surfaced, rather than silently.
- Add `default_category_id` (FK to `TransactionCategoryDB`, nullable) to `VendorDB`, with a corresponding field in the vendor creation/edit form (dropdown, optional, labeled "Default Bill Category").
- In the bill creation form, when a vendor is selected (`onchange` on the vendor dropdown), check that vendor's `default_category_id`; if set and the bill's Category field is still empty/unset, auto-select it. If the bill's Category field was already manually changed by the user, do not override it.
- Ensure the vendor default is a convenience pre-fill only: switching vendors on an existing draft, or manually changing the category, never re-locks or resets the field against the user's own edit.

## Acceptance criteria

- Creating or editing a bill requires selecting a category from the real category list; free-text category entry is no longer possible.
- Recording a bill payment always uses the bill's actual `category_id`; the string-matching fallback to "Other" is removed from the normal path.
- Setting a default category on a vendor causes new bills for that vendor to pre-select that category automatically.
- The vendor-default pre-fill is always editable; selecting a different category for an individual bill is not blocked or reset.
- A vendor with no default category set behaves exactly as before (no auto-selection, category chosen manually).
- A data-quality report identifies existing bills that were previously miscategorized as "Other" due to the free-text mismatch, for manual review and correction.
- No regression to existing bill CRUD, payment recording, duplicate detection, or approval workflows from Stories 4.1, 4.2, FUX-406, and FUX-408.

## Verification plan

- Create a vendor with a default category set (e.g., "Electricity Provider" → default category "Electricity"); create a new bill for that vendor and confirm the category pre-fills correctly.
- On the same bill, manually change the category before saving; confirm the manual selection is respected and not overridden.
- Create a bill for a vendor with no default category; confirm the category field starts unselected as before.
- Record a payment against a bill with a properly set `category_id`; confirm the resulting ledger transaction uses that exact category, not "Other".
- Run the backfill migration against a copy of existing bill data; confirm the match/no-match report correctly identifies bills whose original free-text category did not correspond to a real category name.
- Regression-test bill creation, editing, payment, approval, and duplicate-detection flows (Stories 4.1, 4.2, FUX-406, FUX-408) to confirm no functional regression from the schema and form changes.
