@echo off
chcp 65001 > nul
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

echo ===================================================
echo Starting FastAPI Main Server (Port 5000)
echo ===================================================

".venv64\Scripts\uvicorn.exe" app:app --host 127.0.0.1 --port 5000

pause
