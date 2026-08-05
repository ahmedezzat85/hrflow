# HRFlow Backend — Setup Guide (FastAPI + Google Sheets + Sign in with Google)

This backend uses **FastAPI**, a **Google Sheet** as the database, and
**Sign in with Google** as the ONLY authentication method — no passwords
anywhere in the system. Since your company already runs on Google
Workspace, employees simply click "Sign in with Google" and use their
existing work account; there's nothing new for them to remember.

## 1. Create the Google Sheet

1. Go to https://sheets.new to create a blank Google Sheet, rename it
   `HRFlow Database`.
2. Create these 6 tabs (exact names, case-sensitive):
   `Employees`, `Users`, `Requests`, `VacationHistory`, `InsuranceClaims`, `SalaryHistory`.
   Headers are auto-created by the backend on first connect if a tab is empty.
3. Copy the Spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_ID`**`/edit` → this goes
   into `.env` as `SPREADSHEET_ID`.

## 2. Create a Service Account (for Sheets access only)

This is unrelated to user login — it's just a "robot" account so the backend
can read/write your Sheet.

1. https://console.cloud.google.com/ → select/create a project.
2. Enable **Google Sheets API** and **Google Drive API**.
3. **APIs & Services → Credentials → Create Credentials → Service Account**,
   name it `hrflow-backend`.
4. On the service account, **Keys → Add Key → Create new key → JSON** →
   download, rename to `credentials.json`, place next to `main.py`.
5. Copy the `client_email` from that JSON file.
6. In your Google Sheet, click **Share** → paste that email → give **Editor** access.

## 3. Set Up Sign in with Google (this is the new part)

This is a SEPARATE credential from the service account above — it identifies
your web app to Google so it can show the Sign-In button and issue ID tokens.

1. In the same Google Cloud project, go to **APIs & Services → OAuth consent
   screen**.
   - User Type: choose **Internal** if your Workspace admin allows it (this
     automatically restricts sign-in to your organization only, which is
     ideal here). If Internal isn't available, choose External and add your
     domain restriction via the `hd` claim check (already built into the
     backend, see below).
   - Fill in app name, support email, and save.
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**.
   - Application type: **Web application**.
   - Name it `hrflow-frontend`.
   - Under **Authorized JavaScript origins**, add the exact URL where you'll
     serve the HTML file, e.g. `http://127.0.0.1:5500` for local testing, or
     your real domain once deployed (e.g. `https://hr.yourcompany.com`).
   - Click **Create**. Copy the **Client ID** (looks like
     `123456789-abc.apps.googleusercontent.com`).
3. Put that Client ID in TWO places:
   - Backend `.env` → `GOOGLE_OAUTH_CLIENT_ID=...`
   - Frontend `api.js` → the `GOOGLE_CLIENT_ID` constant near the top of the file.
4. Set `ALLOWED_WORKSPACE_DOMAIN` in `.env` to your company's Workspace
   domain (the part after @ in staff emails, e.g. `yourcompany.com`). Any
   Google account outside this domain will be rejected, even if the Google
   sign-in itself succeeds - this is enforced server-side via the token's
   `hd` (hosted domain) claim, so it can't be bypassed from the browser.

## 4. Configure and Run

```
pip install -r requirements.txt
cp .env.example .env   # then fill in the values from steps 1-3
python seed_data.py    # OPTIONAL: replace the demo emails in seed_data.py
                        # with real Workspace addresses you can test with first!
uvicorn main:app --reload --host 0.0.0.0 --port 5000
```
Visit `http://localhost:5000/docs` for interactive API docs.

## 5. How Employees Get Access

Because there's no password to set, onboarding a new employee is simpler
than before:
1. Admin logs into HRFlow, goes to **Employees → Add Employee**, and enters
   the new hire's **real Google Workspace email address**.
2. That's it - the employee can now click "Sign in with Google" on the
   HRFlow login page and use their existing company Google account.
3. If someone outside the company (or someone not yet added by HR) tries to
   sign in, they'll see: *"This Google account is not registered in HRFlow."*

## 6. Frontend Files

- `hrflow_hr_management_system_google_signin.html` — the prototype, now with
  the email/password form replaced by the official Google Sign-In button.
- `api.js` — handles the Google Identity Services flow and calls
  `/api/auth/google` with the resulting token; also contains all the other
  endpoint wrappers used throughout the app.

Serve both files from the same origin you registered in step 3 (an
"Authorized JavaScript origin" only works for the exact URL/port you added).

## API Endpoint Reference

| Method | Endpoint                          | Purpose                          | Access |
|--------|-----------------------------------|-----------------------------------|--------|
| POST   | /api/auth/google                  | Exchange a Google ID token for an HRFlow session token | Public (but restricted to your Workspace domain) |
| GET    | /api/employees                    | List employees                    | Admin: all, Employee: self |
| POST   | /api/employees                    | Add employee (their Google account becomes their login) | Admin only |
| PUT    | /api/employees/{id}                | Edit employee                     | Admin only |
| DELETE | /api/employees/{id}                | Remove employee                   | Admin only |
| GET    | /api/requests                      | List requests                     | Admin: all, Employee: self |
| POST   | /api/requests                      | Submit a request                  | Logged-in employee |
| POST   | /api/requests/{id}/action          | Approve/Reject                    | Admin only |
| GET    | /api/vacations/history             | Vacation history                  | Admin: all, Employee: self |
| POST   | /api/vacations/request             | Submit vacation/WFH request       | Logged-in employee |
| GET    | /api/insurance/claims              | List claims                       | Admin: all, Employee: self |
| POST   | /api/insurance/claims              | Submit new claim                  | Logged-in employee |
| POST   | /api/insurance/claims/{id}/action  | Approve/Reject                    | Admin only |
| GET    | /api/salary/history                | Salary/raise history              | Admin: all, Employee: self |
| POST   | /api/salary/raise                  | Apply a new raise                 | Admin only |
| GET    | /api/health                        | Health check                      | Public |

## Why This Is a Good Fit for a Google Workspace Company

- Zero password resets, zero password database to secure or leak.
- Employees who leave the company automatically lose access the moment IT
  disables their Google Workspace account - no separate "delete HRFlow
  login" step to remember.
- The `hd` domain check means even a correctly-verified Google sign-in from
  a personal Gmail account is rejected outright.
- Combined with the Google Sheets database, your entire stack (auth +
  data) now lives inside the Google ecosystem your company already trusts
  and pays for.


## Dummy Password Login (for testing before Google OAuth is set up)

To make the app immediately testable - even before you've finished the
Google Cloud OAuth setup in section 3 - the login screen also shows a
plain email + password form below the Google button. This is intentionally
a DUMMY mechanism:

- There is a single shared test password: `demo1234`
- It works for ANY email that already exists in your Users tab (added via
  "Add Employee" in the admin portal, or via seed_data.py)
- No real per-user passwords are stored anywhere in the Sheet

Use the demo-account chips on the login screen to autofill valid emails
from your seeded data. Once you've completed the Google Sign-In setup, you
can leave this fallback in place for convenience, or remove the
`/api/auth/login` endpoint and the password form from the HTML if you want
to enforce Google Sign-In exclusively.

**Security note:** because this shared password is public (it's printed in
this guide), never expose this login path on a real production deployment
containing genuine employee data unless you first replace it with a proper
per-user password system (e.g. bcrypt hashes) or remove it entirely.
