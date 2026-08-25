@echo off
REM KAKSHA numerical engine. Must be running before the frontend is useful.
cd /d "%~dp0backend"
if not exist .venv\Scripts\python.exe (
  echo Creating virtual environment...
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
echo Starting KAKSHA backend on http://127.0.0.1:8000
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
