#!/bin/sh
# Generates the browser config (config.js) from the container environment at start-up, so one
# image runs in any environment. Values are public (served to every visitor): never put secrets here.
set -e
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
: "${GOOGLE_CLIENT_ID:?GOOGLE_CLIENT_ID must be set for the web container}"
printf 'window.HRFLOW_CONFIG = { API_BASE_URL: "%s", GOOGLE_CLIENT_ID: "%s" };\n' \
    "$(esc "${HRFLOW_API_BASE_URL:-}")" "$(esc "$GOOGLE_CLIENT_ID")" > /usr/share/nginx/html/config.js
echo "[hrflow-config] wrote config.js (API_BASE_URL='${HRFLOW_API_BASE_URL:-}')"
