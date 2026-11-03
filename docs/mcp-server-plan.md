# HRFlow MCP Server — Plan (DRAFT, nothing built)

**Status:** Draft for owner review. No code, no migration, no decision logged yet.
**Origin:** The owner wants to load historical HR data (leave and work-from-home decisions, scanned documents, old emails) by talking to Claude in a chat app, with HRFlow as the context.
**Risk class:** High-risk (new authentication path, new permissions, a migration, writes of HR data driven by AI-read content).
**Relation to earlier decisions:** D-033 rejected an MCP for the finance backlog as disproportionate and chose "read outside HRFlow, validate inside HRFlow, dry run, then commit as drafts". This plan keeps that principle. What changes: the work is now recurring and conversational, and the owner asked for it. The finance import engine is not touched.

## 1. Goal and non-goals

**Goal.** From a chat with Claude, the owner can (a) ask HRFlow questions (who is this employee, what leave did they take, what is the balance, what holidays exist) and (b) hand Claude a scanned document or an old email thread and have the decisions found in it (vacation, work from home, sick leave) recorded in HRFlow, each one reviewed by a human before it counts.

**Non-goals (phase 1).**
- No finance, payroll, salary, bank, tax or insurance-claim tools.
- No approving, rejecting, deleting or editing existing live records.
- No OCR or AI inside HRFlow. Claude (the chat app) reads the documents with the owner's own connectors; HRFlow only receives typed values. Same stance as D-032/D-033.
- No change to the existing REST contracts, cookie login, or the Employee portal.

## 2. Verified facts (from code)

| Area | Fact | Where |
| :--- | :--- | :--- |
| Leave storage | `vacation_history` (employee, `type`, start/end date as strings, `days`, `status`) plus a mirrored `requests` row of type `Vacation`. | `be/models_db.py` |
| Work from home | A request `type = "Work From Home"` in `requests`; not in `vacation_history`. Request types are a closed set: Vacation, Work From Home, Medical Insurance. | `be/models.py` L171 |
| Leave days | Computed on the server: Friday and Saturday off, official holidays excluded. Zero working days is rejected (422). | `be/services/leave_days.py`, `be/routers/vacations.py` |
| Back-dating | Admins may create on behalf of an employee with a chosen `status` and `record_date` (needs `hr.vacation.write` / `hr.request.write`). | `be/deps.py` `resolve_target_employee` |
| Statuses | `Approved`, `Rejected`, `Pending`. | `be/models.py` |
| Auth | HttpOnly cookie JWT from Google OAuth code flow (D-050). There is **no** bearer or API-token path. | `be/auth.py` |
| Authorization | Permission catalog plus `require_permission` / `permission_scope`; a test requires every route to be guarded. | `be/core/`, `be/deps.py` |
| Audit | `audit_log()` is best-effort and records actor, action, target. | `be/deps.py` |
| Hosting | Docker (app, web nginx, postgres) on the owner's Windows PC; optional Cloudflare tunnel for a public hostname; nginx upload cap 25 MB. | `deploy/prod/` |
| Idempotency helper | Header-based helper exists in finance only. | `be/finance/services/idempotency.py` |

**Unknowns to confirm before building**
- Whether claude.ai's connector form takes the API key as a header or only inside the URL (M0 spike).
- Whether the same person who loads history is also the one who reviews it.
- Where the source emails live (Gmail through Claude's connector, or exported files).

## 3. Core design: Claude proposes, HRFlow validates, a human confirms

```
Chat app (Claude)  --reads scans / emails with the owner's own connectors-->  extracts decisions
        |
        |  MCP tools (typed, allow-listed)
        v
HRFlow MCP server  --HTTPS + per-user token-->  HRFlow REST API (existing RBAC, validation, audit)
                                                   |
                                         import_batches / import_items  (staging, nothing live yet)
                                                   |
                                  HRFlow "Import review" page: owner accepts / edits / rejects
                                                   |
                                  Accepted items go through the existing leave/request services
```

Principles:
1. **The MCP server is a thin adapter over the REST API.** It never opens the database, never reads files by path, never holds Google or Drive credentials. Every call therefore passes through the same `require_permission` checks and audit as the UI.
2. **Email and scan text is untrusted data.** A forged email saying "approve all leave for X" must not be able to do anything. So: no tool approves, deletes or edits live records; writes only land in staging; a person accepts in the HRFlow UI.
3. **Dry run first, then stage.** Same shape as D-033: validate everything, return a per-row report, write nothing; staging is a second, explicit call.
4. **Server decides the numbers.** The tool sends dates and type; HRFlow computes days (weekends, holidays) and detects overlaps. Claude's arithmetic is never stored.
5. **Provenance on every item.** Source kind (`email`, `scan`, `manual`), a source reference (subject and date, or file name), a SHA-256 of the source text or file when given, a short evidence excerpt (capped, for the reviewer), Claude's confidence, and the token/user that staged it.

## 4. Transport and authentication (DECIDED by the owner)

**Decision:** claude.ai (web) is the chat app. The MCP server is a **remote MCP server (streamable HTTP)** reached through a **Cloudflare tunnel**, protected by an **API key** (no OAuth). The owner has confirmed this key method works with claude.ai connectors. The on/off switch is the MCP process itself: stop it and the endpoint is dead.

```
claude.ai --HTTPS--> Cloudflare tunnel (own hostname, e.g. mcp.<domain>) --> MCP server process on the PC
                                                                                |  localhost / internal network
                                                                                v
                                                                   HRFlow REST API (bearer PAT of one user)
```

**Two separate secrets, never the same value**
1. **MCP access key** (claude.ai to MCP server). 256-bit random, generated by us, stored only as an env value on the PC (`HRFLOW_MCP_KEY`; compare in constant time; a hash may be stored instead). Sent however the claude.ai connector allows: an `Authorization: Bearer` / custom header if the connector form supports it, otherwise as a secret path segment (`https://mcp.<domain>/<key>/mcp`). **M0 spike must confirm which form claude.ai accepts** before anything else is built.
2. **HRFlow personal access token (PAT)** (MCP server to HRFlow). Bound to one named user (the owner's HR-Admin account), with scopes. Held only in the MCP server's env, never sent to claude.ai.

**Exposure rules**
- The tunnel exposes **only the MCP server**, on its own hostname. HRFlow itself is not newly exposed; the MCP server calls it on localhost or the Docker network.
- Wrong or missing key returns 404 with no detail (does not reveal the endpoint). Rate limit by IP and globally (Cloudflare rule plus in-process).
- If the key travels in the URL, it can leak through access logs: redact it in uvicorn, `cloudflared` and any proxy logs; never write the full URL to HRFlow's audit; rotate on any doubt (rotation = change env value, update the connector URL).
- Check `Origin`/`Host` and accept only the MCP paths.
- **Kill switch:** stop the MCP process (endpoint gone). Second switch: revoke the PAT in HRFlow (endpoint alive but powerless). Third: remove the DNS/tunnel route.
- Even with a stolen MCP key the attacker gets only what the tool set allows (section 5): read minimal employee/leave data and stage items that a human must accept. Hence the tool allow-list matters more than the key.

**Residual risk to accept knowingly:** a static API key has no per-session identity, expiry or consent step. Mitigations are the short-lived PAT, rotation habit (suggest every 30 days), stopping the server when not in use, and the staged-only write model.

**Personal access tokens (new, backend)**
- Table `api_tokens`: id, `user_id`, name, `token_hash` (SHA-256 of a random 256-bit secret; the secret is shown once), `scopes` (list), `expires_at` (default 30 days, max 90), `last_used_at`, `revoked_at`, `created_at`.
- `get_current_user` accepts `Authorization: Bearer hrf_...` as a second path. The resolved user is the same user dict as a cookie session, **with permissions intersected with the token's scopes**. A token can never exceed its owner's role.
- **Changed in M1:** tokens are created, listed and revoked only on the host with `be/scripts/manage_api_tokens.py`, not through the API or a web page. A leaked MCP key or token therefore can never mint another token, and no `self.api_token.write` permission is needed. Archiving a user revokes their tokens (as with `auth_sessions`).
- Never logged, never returned after creation, rate-limited, constant-time compare.
- Bearer requests are not cookie-authenticated, so CSRF does not apply; verify the existing origin checks do not block them.

New permissions (catalog, role seed and RBAC tests change, so handle with care):
- `hr.history_import.write`: stage and review historical leave/WFH items. Seeded for HR-Admin and Super-Admin only.
- `hr.history_import.read`: see batches and items.

## 5. Tool set

All tool names, descriptions and argument schemas are fixed in the MCP server; descriptions state that the content is untrusted.

**Read-only (scope `mcp:read`)**
| Tool | Returns | Notes |
| :--- | :--- | :--- |
| `find_employee(query)` | id, name, email, status, job title (max 10) | Minimal fields only. No salary, ID numbers, bank data. Needs `hr.employee.read`. |
| `list_leave(employee_id, from?, to?, type?)` | leave and WFH records with status | Needs `hr.vacation.read` / `hr.request.read`. |
| `get_leave_balance(employee_id, year?)` | entitlement, used, remaining | Only if the server already exposes it; do not invent a new calculation. |
| `list_holidays(year)` | official holidays | Lets Claude explain day counts. |
| `list_leave_types()` | the allowed `type` values | Prevents invented types. |
| `check_leave_conflicts(employee_id, start, end)` | overlapping records, working-day count | The same code as the create path. |

**Staging (scope `mcp:stage`, needs `hr.history_import.write`)**
| Tool | Effect |
| :--- | :--- |
| `validate_history_items(items[])` | Dry run: resolves employee, computes days, finds overlaps and duplicates, returns a row-by-row report. Writes nothing. |
| `stage_history_items(batch_label, items[], idempotency_key)` | Creates one `import_batch` with `import_items` in status `staged`. Re-sending the same key returns the same batch. Max 100 items per call. |
| `get_import_batch(batch_id)` | Status and per-item review state, so Claude can tell the owner what is left. |

Item fields: `employee_id` (required; Claude must resolve it with `find_employee`, never guess by name), `leave_type` (`Annual Leave` | `Sick Leave` | `Work From Home` | `Unpaid Leave`; in the app all four are `vacation_history` types, so there is no separate kind), `start_date`, `end_date`, `decision` (`approved` | `rejected`), `decided_by` (name as written in the source), `decided_on`, `source_kind`, `source_ref`, `source_sha256?`, `evidence_excerpt` (max 500 chars), `confidence` (`high` | `medium` | `low`), `notes`.

**Deliberately absent in phase 1:** create/approve/reject/delete live leave, upload documents, anything finance or payroll, anything that returns personal or bank details.

**Document attachment (phase 3, optional).** Attach the scan to the employee's documents through the existing upload service, from a local path chosen by the owner in the MCP client (not a server path), size-capped under the 25 MB limit. Deferred because it adds file-handling risk; the evidence excerpt and source reference are enough to start.

**Built in M4 (differences from the plan above):** the directory is `mcp_server/`, not `mcp/`, because a folder named `mcp` would shadow the SDK package of the same name. `get_leave_balance` and `check_leave_conflicts` were not built: balances are already derived in HRFlow and `validate_history_items` reports overlaps and working days with the server's own code. The server keeps all three key forms (Bearer header, `X-API-Key`, URL path) until the M0 spike shows which claude.ai uses. Limits: 10 wrong keys a minute per client, 120 calls a minute overall. See `mcp_server/README.md`.

## 6. Data model (one Alembic migration, PostgreSQL-safe)

- `api_tokens` (section 4).
- `history_import_batches` (named so to avoid the finance `import_batches`): id, `label`, `created_by_user_id`, `token_id`, `idempotency_key` (unique per user), `status` (`open`, `completed`), `created_at`.
- `history_import_items`: id, `batch_id`, `employee_id`, the item fields above, computed `days`, `status` (`staged`, `accepted`, `rejected`, `duplicate`), `reviewed_by`, `reviewed_at`, `result_vacation_id` / `result_request_id` once accepted, `reject_reason`. Double staging is blocked in the service (same employee, type and dates already staged); overlap with a live record blocks staging and accepting.
- Use `sa.true()`/`sa.false()` for any Boolean default (the integer-default problem noted in the project start-here doc). Test on the PostgreSQL scratch container and keep `tests/test_schema_drift.py` green.
- No change to `vacation_history` or `requests` columns. Accepted historical items are created through the existing back-dated admin path (status as decided, `record_date` = decision date, `submitted_by` = reviewer), with an audit row `history_import.accept` linking item id, batch id and source reference.

## 7. Review in HRFlow (frontend)

- New admin page "Import review" (System or HR module), vanilla JS, `.fv`-style tokens, no colour literals.
- Batch list, then item table: employee, type, dates, computed days, decision, source reference, evidence excerpt, confidence badge, conflict/duplicate flags.
- Per item: Accept, Edit dates/type then Accept, Reject with reason. Bulk "accept all high-confidence without conflicts" is allowed only with an explicit confirmation showing the count.
- Mock mode (`?mock=admin`) with seeded batches covering: clean, overlap, duplicate, zero working days, low confidence.
- Run `npm run build` in `fe/` before UI specs.

## 8. Packaging and layout

- New top-level `mcp/` directory (not inside `be/`): `server.py` (official Python MCP SDK, FastMCP, streamable HTTP transport, key-check middleware), `client.py` (httpx wrapper over the REST API with the bearer PAT), `tools/`, `README.md`, own `requirements.txt`, tests.
- Runs as its **own process**, not part of the HRFlow app container, started and stopped by the owner (a small `start-mcp` / `stop-mcp` script; optionally its own compose profile so it is off by default). It must not start with the production stack.
- Config via env only: `HRFLOW_BASE_URL`, `HRFLOW_API_TOKEN`, `HRFLOW_MCP_KEY`, `MCP_PORT`. The README documents adding the connector in claude.ai and the `cloudflared` ingress rule for the MCP hostname. No secrets committed.
- Backend additions stay inside `be/` using the 3-tier pattern (models, repositories, services, routers) in new files, so existing routers are untouched. A new `os.getenv` in `be/` (for example `API_TOKEN_MAX_DAYS`) must be added to `.env.example`, `.env.prod.example` and compose (`be/tests/test_env_contract.py`).

## 9. Security and abuse cases (each needs a test)

1. Token of a user without `hr.history_import.write` calling a staging tool gets 403.
2. A token with scope `mcp:read` cannot stage.
3. Expired, revoked, archived-user and unknown tokens get 401; hashes only in the database.
4. A prompt-injection string in `evidence_excerpt` or `notes` is stored as inert text and escaped in the UI (no HTML rendering).
5. Staging never changes `vacation_history`/`requests`; only an authenticated human accept does.
6. Replaying the same `idempotency_key` does not duplicate; the same natural key in another batch is flagged `duplicate`.
7. Overlap with an existing live record, zero working days, end before start, unknown employee, archived employee are all rejected at validate time with a reason.
8. Rate limit per token; payload cap (100 items, field lengths).
9. `find_employee` output contains no salary, ID, bank or document data (assert the exact key set).
10. Every staging call and every accept writes an audit entry with token id.
11. Tokens and Authorization headers are redacted from logs and error messages.

## 10. Delivery slices (each its own PR; targeted tests per slice, one full backend run at the end)

| Slice | Content | Done when |
| :--- | :--- | :--- |
| **M0** | Decision entry (D-051) and answers to the open questions below. **Spike:** a throwaway "hello" MCP server behind the tunnel, connected in claude.ai with the API key, to confirm where claude.ai accepts the key (header vs URL) and that tools are listed and callable. No HRFlow code. | Spike works end to end; owner approves this plan. |
| **M1** | `api_tokens` migration, bearer path in `get_current_user`, host CLI to create/list/revoke tokens, scope narrowing (`mcp:read` in M1, `mcp:stage` added in M2), tests. No new permission keys or env variables in M1. | Token-auth tests pass; cookie login unchanged; migration verified on PostgreSQL scratch. |
| **M2** (built) | `history_import_batches` / `history_import_items` (migration 0074), `/api/history-import` validate, stage, list, edit, accept, reject; permissions `hr.history_import.read/write/review` (granted to no seeded role; Super-Admin has them; `review` is in no token scope); token scope `mcp:stage`; audit; evidence purge on listing. Accept writes the same `vacation_history` + `requests` rows as the back-dated admin path, in one transaction. | Acceptance criteria in section 9 pass at API level. |
| **M3** | Import review page, mock mode, Playwright specs. | `npm run build` plus the new spec pass. |
| **M4** (built) | `mcp/` server (streamable HTTP, key middleware, log redaction, start/stop scripts) with read tools, then staging tools; README with claude.ai connector and tunnel steps; contract tests against a test backend, including wrong-key and rate-limit cases. | Owner completes a real session in claude.ai: finds an employee, stages 3 items from a sample email, accepts them in the UI; stopping the server makes the connector fail. |
| **M5 (optional)** | Document attachment tool (file upload through MCP over the tunnel is size-limited, so this needs its own design). | Separate plan before starting. |

Run the pilot on a **copy** of production data, then on production with one real batch of about 10 items, before loading the full history.

## 11. Open questions for the owner

1. ~~Chat app~~ **Resolved:** claude.ai web, remote MCP via Cloudflare tunnel with API key, switched off by stopping the server (section 4). Still to confirm in the M0 spike: header vs URL key, and the tunnel hostname to use.
2. ~~Review step~~ **Resolved (owner, Nov 3, 2026):** always review. Every item is staged and accepted/edited/rejected in HRFlow; no direct writes. Bulk-accept of high-confidence, conflict-free items stays available behind one confirmation.
3. ~~Leave types~~ **Resolved:** Annual, Sick, Unpaid, Work From Home. WFH stays a request type and uses no vacation days. To verify in M2: today `leave_type` is free text defaulting to "Annual Leave"; add validation against this list for staged items without breaking existing rows.
4. ~~Effect on balances~~ **Resolved:** all history is stored, but only leave dated in the current balance year deducts from the balance. To verify in M2: how the balance year is defined and computed today, so older imported leave is excluded without a new flag if possible.
5. ~~Source conflicts~~ **Resolved:** stage both items, flag them `conflicting`, show both sources side by side; the reviewer decides. No automatic winner.
6. ~~Who can use it~~ **Resolved:** only the owner, one PAT on the owner's account. The permissions are ordinary role permissions, so widening later needs no code change.
7. ~~Other data later~~ **Resolved:** later phases are (a) attaching the scan to the employee's documents and (b) insurance claims history. Both need their own plan before work starts; claims touch money-related data and need stricter review. Employee notes and finance are not planned. Not in the first release.
8. ~~Retention~~ **Resolved:** `evidence_excerpt` is erased 90 days after an item is accepted or rejected; source reference, decision and audit entry are kept. Needs a small scheduled purge (there is no scheduler today; see `docs/notifications-and-email-plan.md` phase 2), or a purge run on access until a scheduler exists.

## 12. Risks

- **Wrong extraction from handwriting or ambiguous emails.** Mitigated by confidence, evidence excerpt, mandatory review, dry run.
- **MCP key or PAT leaks.** Mitigated by two separate secrets, scopes, 30-day expiry, revoke, role intersection, no finance/bank tools, log redaction, rate limits, and the server being off when not in use.
- **Public endpoint reachable from the internet while on.** Only the MCP server is exposed, with a key check first, minimal read data, and staged-only writes.
- **Prompt injection through documents.** Mitigated by section 3 principle 2 and section 9 tests; the model cannot reach any destructive action.
- **Scope creep toward finance.** Out of scope; needs its own decision, since it changes the D-033 reasoning.
- **Double counting leave** against records entered by hand earlier. Mitigated by overlap and duplicate detection at validate time.
