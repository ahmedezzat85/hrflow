# Alerts and Email — Plan (DRAFT, email on hold)

**Status:** Draft. The alerts part (sections 1 to 7) can be finalized now. The email part is **on hold** until a short, free feasibility check passes (section 8). Nothing here is committed to code.
**Origin:** Follow-up to the Official holidays page (PR 105): automatic notice of holidays, and later an email announcement.
**Risk class:** High-risk for the email part (outbound mail to staff, secrets, scheduled jobs). Medium for alerts (new table, new permissions, new UI).

## 1. Decisions taken

- **No bell.** Notifications appear as **alerts with a severity**: `info`, `warning`, `critical`. The empty bell and panel in the top bar are removed (their parity tests need updating).
- **Email is separate and optional.** The alert system works fully without email. Email is added later as one more delivery channel for the same alert, only if it can be done free and without certification.
- **No paid service, no registration with an email vendor, no Google certification.**

## 2. What exists today (verified in code)

| Area | State |
| :--- | :--- |
| Notification UI | Only a placeholder bell and empty panel in the admin top bar. Nothing behind it. |
| Backend alerts / email | None. No mailer, no templates, no outbox. |
| Scheduler | None. Only request handling. |
| Recipients | `employees.email` (unique, required), `status`, `archived_at`. |
| Dependencies | `google-api-python-client`, `google-auth`, `email-validator` installed. Python's built-in `smtplib` needs nothing new. |
| Deployment | One `app` container plus `postgres` on the same Windows host. Config is env-only; new variables go into `.env.example`, `.env.prod.example` and compose (`be/tests/test_env_contract.py`). |

## 3. Alerts: how they look and behave (proposal, please confirm)

- **Where:** a strip of alert banners under the top bar of the portal, plus an "Alerts" page listing recent and dismissed ones. No bell, no panel.
- **Severities:**
  - `info` (blue): for example "Revolution Day is on 23 July". Dismissible. Expires on its own date.
  - `warning` (amber): for example a document or payroll period needing attention. Dismissible; can reappear if the condition is still true.
  - `critical` (red): needs the person to press **Acknowledge** before it goes away; acknowledgement is recorded (who, when). Used sparingly.
- **Who sees what:** an alert targets everyone, a role, or one employee. Backend decides who may read it; the browser never filters.
- **Lifecycle:** `starts_at`, optional `expires_at`, per-person dismissed or acknowledged state, a `dedupe_key` so an automatic rule cannot create the same alert twice.
- **Styling:** semantic tokens from `tokens.css` (the existing success, warning and danger tokens), no colour literals; accessible (`role="status"` for info and warning, `role="alert"` for critical), keyboard dismissible.

## 4. Data model (one Alembic migration, PostgreSQL-safe, tested on the scratch container)

- `alerts`: id, `severity` (`info`, `warning`, `critical`), `title`, `body`, `link_page` (an in-app page id, never a URL), `audience_type` (`all`, `role`, `employee`) and `audience_value`, `starts_at`, `expires_at`, `source_type`, `source_id`, `dedupe_key` (unique), `created_by`, `created_at`.
- `alert_receipts`: `alert_id`, `employee_id`, `dismissed_at`, `acknowledged_at` (unique per pair).
- `scheduled_job_runs`: job name plus run date, unique, so a daily job runs once after a restart.
- Later, only if email goes ahead: `email_outbox` (status, attempts, next attempt, truncated error, `dedupe_key`, source) and `announcements`.

## 5. API and permissions

New permission keys (catalog, role seed and RBAC tests change, so this step needs care): `self.alert.read` (read, dismiss, acknowledge own), `hr.alert.write` (create, edit, expire alerts for the company), and `hr.alert.read` (see all alerts and who acknowledged critical ones).

Endpoints: `GET /api/alerts` (active alerts for the caller), `POST /api/alerts/{id}/dismiss`, `POST /api/alerts/{id}/acknowledge`, `GET/POST/PUT/DELETE /api/alerts/admin` for HR. Every read is scoped to the caller on the backend.

## 6. Frontend

- Alert strip component in both portals; Alerts page (recent, dismissed); HR form to create or expire an alert with a preview of how it looks; mock mode (`?mock=admin`, `?mock=employee`) with seeded alerts of each severity.
- Remove the placeholder bell and update the parity map and specs that mention it.
- Build with `npm run build` before UI specs; semantic tokens only.

## 7. Delivery phases (each its own PR)

1. **Alert foundation:** table, service `raise_alert()`, endpoints, permissions, alert strip and Alerts page, mock mode, remove bell. No email, no scheduler.
2. **Daily scheduler tick:** `scheduled_job_runs` plus a small in-process loop, so rules can run once a day. (Open question 3 below.)
3. **Holiday automation:** when a holiday is added, an `info` alert is created for everyone, starting N days before and expiring on the holiday; editing or deleting the holiday updates or removes it; deduped per holiday.
4. **More automatic alerts, one at a time:** leave request waiting for an approver, claim status, payment document ready, and so on, each choosing its own severity.
5. **Email channel (only after section 8 passes):** outbox, mailer, announcement from HR, dry run, kill switch.

## 8. Email: the free option, and how to be sure before building anything

**What is actually free.** Sending through the company's own Google Workspace mailbox over **SMTP with an app password** costs nothing extra, needs no third-party vendor, and needs **no CASA or any certification**. CASA security assessments apply to public apps that request restricted Gmail API permissions for other people's data; an internal system that only sends mail as one company mailbox with SMTP does not go through that. (This is my understanding of Google's rules; the feasibility check below confirms it in practice rather than relying on my reading.)

**Limits to expect.** A Workspace mailbox can send about 2,000 messages per day (about 500 for a free personal Gmail account). For one company's announcements that is far more than needed, but it is a hard cap, so the worker will rate-limit.

**Free alternatives if SMTP is not allowed:** a mail server the company already runs, or a free tier that is small enough to be permanent (a few hundred emails per month at most). I would not rely on a free tier that can turn paid.

**Feasibility check (about 15 minutes, free, sends one email to a mailbox you own).** Nothing is built and nothing is sent without your go-ahead:
1. A Workspace admin (or you) turns on 2-step verification for a dedicated sender account such as `noreply@<your domain>` and creates an **app password**. Some organizations disable app passwords; this tells us immediately.
2. From the production machine, a one-off script connects to `smtp.gmail.com:587` and sends a single test message to your own address. This proves the outbound port is open, the credentials work, and the message does not land in spam.
3. We record the result here. If it passes, phase 5 is cheap (the mailer is about 50 lines using `smtplib`). If it fails, we stop and email stays off; alerts are unaffected.

**Everything else about email waits** (outbox, announcements, templates, retention) until the check passes. The earlier detailed email design is kept in git history of this file.

## 9. Open decisions

1. Confirm the alert behaviour in section 3 (banner strip, three severities, acknowledge only for critical).
2. Who may create alerts: HR-Admin and Super-Admin only, or also Finance and Payroll admins for their own areas?
3. Scheduler: a small loop inside the app process (my proposal) or a separate worker container. Needs a look at whether the app ever runs more than one uvicorn worker.
4. Holiday alert timing: how many days before a holiday the `info` alert starts showing (proposal: 7 days).
5. Email feasibility check: go or no-go, and who has Google Workspace admin access to create the app password.

## 10. Safeguards (per AGENTS.md)

- Backend authorization on every alert endpoint; `audit_log` for creating, editing and expiring alerts and for critical acknowledgements.
- No secrets in the repo or logs. If email goes ahead: env-only SMTP settings, templates updated, `MAIL_ENABLED=false` kill switch, dry run before the first real send, sending off by default in production.
- Migrations tested up, down, up on the scratch PostgreSQL container, plus `test_migrations_postgres_safe.py`.
- Targeted tests per phase; backend suite and UI suite once before each PR.
