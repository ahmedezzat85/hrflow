#!/bin/sh
# Applies database migrations, then starts the API. Alembic is the schema authority in production.
set -e
cd /app
echo "[entrypoint] Applying database migrations..."
alembic upgrade head
echo "[entrypoint] Starting HRFlow API..."
# One worker on purpose. Payroll previews and the Idempotency-Key registry are held in process memory, so with two workers a
# request can reach a worker that never saw the preview or the first request (lost bonuses, a retried transfer processed
# twice; docs/REVIEW.md ARC-07). Requests are still handled concurrently inside the single worker. Raise this only after
# those two are stored in the database.
exec uvicorn main:app --host 0.0.0.0 --port 8000 \
    --proxy-headers --forwarded-allow-ips="*" --no-server-header --workers 1
