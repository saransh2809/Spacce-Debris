# KAKSHA backend.
#
# Provided for hosts that build from a Dockerfile (Railway, Fly.io, Cloud Run,
# any Kubernetes). Render can use this too, but its native Python runtime via
# render.yaml is faster to build.
#
# Python 3.12: the codebase needs 3.11+ for StrEnum, and 3.12 is what every
# major host has readily available. Nothing here requires anything newer.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first, so a source change does not re-resolve numpy and scipy.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# The catalogue cache is written at runtime; on hosts with a read-only image
# layer this must be a writable path.
ENV KAKSHA_CACHE_DIR=/tmp/kaksha_cache

EXPOSE 8000

# One worker on purpose. The catalogue, the simulation clock and the screening
# cache are process-level singletons, so a second worker would hold a second
# copy of the catalogue (another ~240 MB) and disagree with the first about
# what time it is.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
