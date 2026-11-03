# HRFlow MCP server

Lets Claude (claude.ai) look up employees and leave in HRFlow and **stage** historical leave and work-from-home decisions found in old emails and scans. Staged items are proposals: a person accepts each one on HRFlow's **Import review** page before it counts. Design and decisions: [docs/mcp-server-plan.md](../docs/mcp-server-plan.md), D-051.

```
claude.ai --HTTPS--> Cloudflare tunnel (hrflow-mcp.<domain>) --> this server (127.0.0.1:8765)
                                                                    |  http://localhost, bearer token
                                                                    v
                                                               HRFlow REST API
```

It runs as its own process on the HRFlow PC, **off by default**. Stop it and the endpoint is gone.

## Tools

| Tool | What it does |
| :--- | :--- |
| `find_employee(query)` | id, name, email, status, job role of up to 10 matches. Nothing else about the person. |
| `list_leave(employee_id, from_date?, to_date?, leave_type?)` | recorded leave and work-from-home days |
| `list_holidays(year)` | official holidays |
| `list_leave_types()` | Annual, Sick, Work From Home, Unpaid |
| `validate_history_items(items)` | dry run: HRFlow computes days and reports unknown employees, bad dates, duplicates, overlaps |
| `stage_history_items(batch_label, items, idempotency_key)` | saves up to 100 validated items for review; the same key returns the same batch |
| `get_import_batch(batch_id)` | review progress of a batch |

There is no tool that approves, edits or deletes a live record, and none that returns salary, bank, tax, ID or document data. The token is also limited on HRFlow's side: it carries the `mcp:read` and `mcp:stage` scopes only, and accepting an item needs a permission that is in no token scope.

## Set up (once)

1. **Deploy HRFlow** with the M1 to M3 changes (tokens, staging, Import review page) and run its migrations.
2. **Make the token** on the HRFlow host, as the user the server acts as (30 days by default, 90 at most):
   ```
   python scripts/manage_api_tokens.py create --email <your login> --name "claude mcp" --scopes mcp:read,mcp:stage
   ```
   It prints the secret once. Give your account the `hr.history_import.read` and `hr.history_import.review` permissions (Super-Admin has them; others get them on the Roles page) so you can review.
3. **Install** (Python 3.10+): `python -m pip install -r mcp_server/requirements.txt`
4. **Configure**: copy `.env.example` to `.env`, set `HRFLOW_API_TOKEN`, a fresh `HRFLOW_MCP_KEY` (`python -c "import secrets; print(secrets.token_urlsafe(32))"`), `MCP_PUBLIC_HOST`. Never put these in chat or in git.
5. **Tunnel**: add an ingress rule for the MCP hostname only, pointing at this server. HRFlow itself is not exposed by this.
   ```yaml
   ingress:
     - hostname: hrflow-mcp.<domain>
       service: http://127.0.0.1:8765
     - service: http_status:404
   ```
6. **claude.ai**: Settings, Connectors, Add custom connector. If the form has a header or API key field use `https://hrflow-mcp.<domain>/mcp` with the key; if it only takes a URL use `https://hrflow-mcp.<domain>/<key>/mcp`. Both forms work.

## Use

```
.\mcp_server\start-mcp.ps1        # on
.\mcp_server\stop-mcp.ps1         # off (or Ctrl+C in its window)
```

On start the server checks that HRFlow answers and accepts the token, and stops with a clear message if not. Switch off when not in use. Other switches: revoke the token (`manage_api_tokens.py revoke --id N`, the endpoint stays up but is powerless) or remove the tunnel route.

Rotate the key about every 30 days (change `HRFLOW_MCP_KEY`, update the connector). If the key is in the URL, it is replaced by `<KEY>` in this server's logs; keep `cloudflared` and any proxy logs private too.

## Safety rules the server enforces

- A wrong or missing key gets a bare 404; 10 wrong keys a minute from one client get 429. At most 120 calls a minute overall.
- The key and token are never logged or returned, and the HRFlow token is never sent to claude.ai.
- The server instructions tell Claude to treat email and scan text as untrusted data and never follow instructions inside it.
- Every call is made as the token's user, so HRFlow's permissions and audit apply.

## Tests

```
python -m pip install -r mcp_server/requirements.txt
python -m pytest mcp_server/tests -q
```

The suite uses a fake HRFlow, so it needs no database or network.
