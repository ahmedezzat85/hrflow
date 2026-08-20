# Invoice Autopay — Required Config Additions

This feature (docs/analysis/invoice-autopay-plan.md) needs three new
settings in `be/config.py`'s `Config` class, read from environment
variables the same way `DRIVE_ROOT_FOLDER_ID` already is. They are
intentionally NOT hardcoded anywhere in the invoice service/router —
`services/invoices.py` and `routers/invoices.py` reference them only as
`Config.INVOICE_TEMPLATE_PATH`, `Config.INVOICE_TEMPLATE_VERSION`.

Add to `be/config.py`, alongside the existing Drive/Sheets settings:

```python
INVOICE_TEMPLATE_PATH = os.getenv("INVOICE_TEMPLATE_PATH", "")
INVOICE_TEMPLATE_VERSION = os.getenv("INVOICE_TEMPLATE_VERSION", "v1")
```

## What each value means

- `INVOICE_TEMPLATE_PATH`: absolute or relative filesystem path to the
  approved `Invoice_Template.docx` (the version with `{{ invoice_number }}`,
  `{{ employee_full_name }}`, `{{ address_line_1 }}`, `{{ address_line_2 }}`,
  `{{ invoice_date }}`, `{{ current_month }}`, `{{ amount }}` placeholders).
  `services.invoices.render_invoice_document()` raises a clear
  `RuntimeError` at generation time if this is unset, rather than failing
  confusingly deep inside `docxtpl`.
- `INVOICE_TEMPLATE_VERSION`: a free-text label (e.g. `"v1"`) stored on
  every generated `Invoices` row, so if the template is revised later you
  can tell which version produced a given historical invoice.

## Where the template file itself should live

Not decided by this commit — options to choose between before enabling
this in production:

1. Bundle the approved `.docx` inside the repo (e.g. `be/templates/
   invoice_template.docx`) and point `INVOICE_TEMPLATE_PATH` at it. Simple,
   but means template edits require a code deploy.
2. Store it in a fixed location on the deployment host/volume and set
   `INVOICE_TEMPLATE_PATH` via environment variable per-environment.
3. Fetch it from a dedicated Google Drive file at startup/on first use
   (would need a small addition to `drive_client.py` to download by a
   configured `INVOICE_TEMPLATE_FILE_ID` and cache it locally) — closer to
   the original plan's "Drive-hosted template" option, at the cost of one
   more moving part.

`services/invoices.render_invoice_document()` only needs a local file
path today (option 1 or 2 work as-is); option 3 would need a small
loader added before that function runs.

## Also required (already covered by existing Drive config)

`DRIVE_ROOT_FOLDER_ID` must already be set for uploads to succeed — the
new `DriveClient.get_or_create_invoices_period_folder()` reuses that same
root and creates `Invoices/<year>/<year>-<month>/` under it. No new Drive
config is needed beyond the two invoice-specific settings above.
