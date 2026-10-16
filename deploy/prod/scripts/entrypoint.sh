#!/bin/sh
# Applies database migrations, then starts the API. Alembic is the schema authority in production.
set -e
cd /app
echo "[entrypoint] Applying database migrations..."
alembic upgrade head
echo "[entrypoint] Starting HRFlow API..."
exec uvicorn main:app --host 0.0.0.0 --port 8000 \
    --proxy-headers --forwarded-allow-ips="*" --no-server-header --workers 2
