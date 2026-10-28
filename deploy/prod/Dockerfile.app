# HRFlow backend (FastAPI) - production image. Build context: repository root.
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# LibreOffice (headless) converts the generated Word documents to PDF. Fonts: Liberation is metric-compatible
# with Arial/Times/Courier, Carlito with Calibri and Caladea with Cambria (the template's theme fonts);
# DejaVu is the last fallback. Tahoma (proprietary) is not installed here: it is mounted from the host
# at /usr/local/share/fonts/hrflow (see docker-compose.yml and RUNBOOK).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-dejavu-core \
       fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY be/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY be/ ./
COPY docs/templates /app/templates
COPY deploy/prod/scripts/entrypoint.sh /entrypoint.sh

RUN sed -i 's/\r$//' /entrypoint.sh \
    && chmod +x /entrypoint.sh \
    && useradd --system --uid 10001 --home-dir /app hrflow \
    && mkdir -p /data/documents /data/logs \
    && chown -R hrflow:hrflow /data /app

USER hrflow
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)"

ENTRYPOINT ["/entrypoint.sh"]
