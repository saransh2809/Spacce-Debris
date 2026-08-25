@echo off
REM KAKSHA interface. Requires the backend on port 8000.
cd /d "%~dp0frontend"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting KAKSHA frontend on http://localhost:5173
call npm run dev
