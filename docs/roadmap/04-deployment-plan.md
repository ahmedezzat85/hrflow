# 04 — Deployment Plan

**Scope:** Two deployment options for HR-team-only access (not the full company): Cloud and Local. Both assume a small, trusted user base (roughly under 15 concurrent HR users), which simplifies requirements considerably.
**Prerequisite:** items 1-3 in `03-architecture-security-plan.md` (backend CI, rate limiting, Dockerfile) should land before either option goes to production use.

## 1. Pre-deployment checklist (applies to both options)

- [ ] Dockerfile for the FastAPI backend (see `03-architecture-security-plan.md` item 3)
- [ ] CI pipeline running `pytest` + the existing frontend build-check on every PR
- [ ] Reverse proxy (Nginx or Caddy) in front of Uvicorn for TLS termination — required for HttpOnly/Secure cookies from the Phase 1 security work to actually protect sessions
- [ ] Rate limiting landed (see `03-architecture-security-plan.md` item 2)
- [ ] Backup strategy for Google Sheets/Drive data confirmed (periodic export/snapshot, on top of Drive's native versioning)
- [ ] Environment-based config separation (dev/staging/prod) with distinct Google service-account credentials per environment

## 2. Option A — Cloud Deployment (recommended default)

| Component | Recommendation | Why |
|---|---|---|
| Backend hosting | Google Cloud Run (single container, `min-instances=0` or `1`) | Already Google-API-native (Sheets/Drive/Sign-In) — staying in GCP avoids cross-cloud auth friction and enables Workload Identity instead of a static service-account key file |
| Frontend hosting | Firebase Hosting or Cloud Storage + CDN, or serve the static build from the same Cloud Run container | `vite build` already produces a self-contained `dist/` folder per the recent build-fix commits |
| Access control | IAM + Identity-Aware Proxy (IAP) in front of Cloud Run, restricted to the HR team's Google Workspace group | Restricts access to "HR team only" at the network/identity layer, layered on top of existing Google Sign-In, without custom IP allowlisting |
| Secrets | Google Secret Manager for `SECRET_KEY` and the Sheets/Drive service-account key | Never check the key file into the repo or plain env files |
| TLS | Automatic via Cloud Run's managed HTTPS | No manual cert management |
| Cost | Likely low tens of USD/month at this scale (scales near-zero when idle) | Fits a small internal tool budget |

**Why this is the recommended default:** the app is already deeply Google-native. This path extends the existing architecture instead of fighting it, and gets the "HR team only" restriction natively through Workspace-group-based IAP policies.

### Rollout steps (high-level)
1. Land the Dockerfile + CI from the pre-deployment checklist.
2. Build and push the container to Artifact Registry.
3. Deploy to Cloud Run, set env vars via Secret Manager references.
4. Put IAP in front, scoped to the HR Workspace group.
5. Point a subdomain at Cloud Run (managed TLS cert auto-provisions).
6. Verify HttpOnly/Secure cookies work correctly over HTTPS (this was the point of the Phase 1 security work — confirm it end-to-end here).

## 3. Option B — Local Deployment (on-premises, HR team only)

| Component | Recommendation | Why |
|---|---|---|
| Hosting | A small VM or mini-PC on the office LAN running Docker Compose: FastAPI container + Nginx/Caddy reverse proxy | Fits existing home/office network administration experience (TP-Link Omada ecosystem) |
| Network access restriction | Bind the service to a dedicated VLAN or SSID reachable only by HR team devices, enforced at the Omada controller/firewall rules | More robust than app-level IP checks; leverages existing Omada setup directly |
| TLS | Caddy with a local CA (e.g. `mkcert`) or a real cert if a reachable subdomain exists | Required — otherwise the Phase 1 cookie hardening (`Secure` flag) is partially neutered on plain HTTP |
| Google API access | Still requires outbound internet access to reach Sheets/Drive/Sign-In APIs | Important caveat: this is **not** a fully air-gapped/offline deployment — only the application tier moves on-premises; the data still lives in Google's cloud |
| Backup | Scheduled local script to export Sheets data + rely on Drive's native versioning | Local hosting doesn't reduce the dependency on Google's availability |

### Rollout steps (high-level)
1. Land the Dockerfile + CI from the pre-deployment checklist.
2. Stand up `docker-compose.yml` with the FastAPI container + Caddy/Nginx.
3. Create a dedicated HR VLAN in the Omada controller; restrict the service's listening interface/firewall rule to that VLAN.
4. Provision TLS (local CA or real cert).
5. Confirm outbound access to Google APIs is allowed from this VLAN (Sheets/Drive/Sign-In).
6. Set up the scheduled backup/export script.

## 4. Decision guidance

Choose **Option A (Cloud Run + IAP)** if:
- You want lower ongoing maintenance burden.
- You're comfortable with GCP billing at small scale.
- You want the "HR team only" restriction to be identity-based (Workspace group) rather than network-based.

Choose **Option B (Local)** if:
- You have a specific reason to keep the application tier on-premises (e.g., office network policy, no desire for a cloud bill).
- You're already managing the Omada VLAN infrastructure and prefer network-level isolation.
- You understand and accept that this does **not** achieve data sovereignty/offline capability — that would require the database redesign in `05-database-redesign.md` first.

**Recommendation:** Option A, given the existing deep Google Workspace integration. Revisit this recommendation if/when `05-database-redesign.md` is implemented and a self-hosted database becomes part of the picture — at that point Option B becomes more attractive as a genuinely more self-contained setup.
