# HRFlow Security Analysis Plan

Branch: security-analysis
Base: main
Scope: Backend (FastAPI), Frontend (Vanilla JS/Vite), auth/session handling, document streaming, config, browser-side storage

## Objective
Track security findings from the review of the `salary` branch and apply fixes in controlled phases, so the highest-risk issues are addressed first while leaving room for design discussion before code changes land.

## Findings Summary

### Critical
1. Default fallback JWT secret in `be/config.py`
   - `SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-in-production")`
   - Risk: if the env var is unset, all session tokens are signed with a publicly known secret, allowing forged admin tokens.
   - Action: require an explicit secret at startup; fail fast if missing or equal to the placeholder.

2. Session JWT passed as a `?token=` query parameter for document streaming
   - Endpoints: `/api/employees/documents/{doc_id}/stream`, `/api/company-documents/{doc_id}/stream`
   - Risk: token leakage via server access logs, browser history, proxy/CDN logs, Referer headers.
   - Action: replace with a short-lived, single-use signed download ticket issued by a dedicated endpoint.

### High
3. JWT stored in `localStorage` and mirrored into non-HttpOnly cookies (`fe/api.js`, `fe/src/js/session.js`)
   - Risk: any XSS on the page yields full, durable session takeover.
   - Action: move toward HttpOnly/Secure/SameSite cookie-based sessions, or at minimum reduce token lifetime and add CSP.

4. CORS configured as `allow_origins=["*"]` combined with `allow_credentials=True` when `ALLOWED_ORIGINS` is left as default (`be/main.py`)
   - Risk: unsafe cross-origin behavior if misconfigured in production.
   - Action: require an explicit origin allowlist in production; refuse to start with wildcard + credentials in prod mode.

5. No rate limiting on `/api/auth/google`, `/api/salary/raise`, or any other endpoint
   - Risk: brute-force abuse, PII scraping, Google Sheets/Drive API quota exhaustion (DoS).
   - Action: add per-IP rate limiting (e.g. `slowapi`), stricter limits on auth and mutation endpoints.

6. Weak enforcement of `ALLOWED_WORKSPACE_DOMAIN` (`be/auth.py`)
   - The `hd` claim used for domain restriction is absent for personal Gmail accounts; if the setting is left blank, any Google account can sign in.
   - Action: make this setting mandatory in production; add a secondary check against the verified `email` domain.

### Medium
7. File upload validation trusts the client-declared `file_type`, not actual file bytes (`be/main.py`)
   - Risk: disguised/malicious files (e.g. HTML/SVG with scripts) uploaded as "pdf"/"image".
   - Action: decode the base64 payload server-side and validate magic bytes before upload to Drive.

8. `Content-Disposition` filename built via unsanitized string interpolation (`be/main.py`)
   - Risk: header injection if a document name contains quotes/control characters.
   - Action: sanitize/strip unsafe characters; prefer RFC 5987 `filename*=UTF-8''...` encoding.

9. Authorization logic in list endpoints relies on statement ordering rather than a single authoritative filter (e.g. `/api/salary/history`)
   - Risk: fragile access control that could regress silently during refactors.
   - Action: centralize per-role filtering into one explicit helper used consistently across endpoints.

### Low
10. Session cookies set without `Secure`/`SameSite` flags (`fe/src/js/session.js`)
11. No standard security response headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
12. Hardcoded date `'2026-08-02'` in `fe/src/js/salary.js` affecting "upcoming raises" logic correctness (not a vulnerability, but a time-bomb bug worth fixing in this pass)

## Remediation Phases

### Phase 1: Secrets and session fundamentals
- Remove the default secret fallback; fail startup without a real `SECRET_KEY`
- Add startup validation for other security-critical env vars (`ALLOWED_WORKSPACE_DOMAIN`, `ALLOWED_ORIGINS` in prod)
- Decide on token expiry policy and short-term vs target-state session storage model

### Phase 2: Document access security
- Design a signed, short-lived, single-use ticket flow for document preview/download
- Remove the session JWT from any URL/query string
- Sanitize filenames used in `Content-Disposition`

### Phase 3: Browser and API hardening
- Tighten CORS per environment (explicit allowlist in prod)
- Add standard security headers middleware
- Add `Secure; SameSite=Strict` to cookies (or retire the cookie mirror entirely, pending Phase 1 decision)

### Phase 4: Validation and abuse protection
- Add magic-byte validation for uploads
- Add rate limiting on auth and mutation endpoints
- Centralize role-based filtering logic (finding #9)

### Phase 5: Audit and verification
- Add a security regression checklist
- Add auth/session/authorization test cases
- Add structured audit logging for sensitive actions (raises, deletions, claim approvals)

## Discussion Points Before Changes
1. End-state auth model: keep Bearer JWT with hardened storage, or move to server-managed HttpOnly cookie sessions?
2. Document streaming: one-time signed ticket endpoint, or authenticated fetch + blob URL flow from the frontend?
3. Should `ALLOWED_ORIGINS` be locked to a single known frontend origin from Phase 1 onward, or staged later?
4. Fix the hardcoded `2026-08-02` date now (Phase 1, low effort) or defer to the architecture pass?

## Validation Checklist
- [ ] App refuses to start without a real `SECRET_KEY`
- [ ] No session token appears in any URL, log line, or browser history entry
- [ ] Non-admin cannot retrieve another employee's salary/insurance/document data via query param manipulation
- [ ] Upload rejects files whose content doesn't match the declared type
- [ ] Rate limits trigger on repeated auth/mutation calls
- [ ] Security headers present on all responses
- [ ] Cookies (if retained) carry `Secure` and `SameSite` flags
