@echo off
chcp 65001 > nul
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

REM ── 경로 설정 ──────────────────────────────────────────────
REM   FRONTEND = 이 배치 파일이 있는 폴더 (신버전 Next.js)
REM   BACKEND  = 같은 상위 폴더의 expense_tracker (FastAPI)
set "FRONTEND=%~dp0"
pushd "%~dp0..\expense_tracker" 2>nul
if errorlevel 1 (
    echo [오류] 백엔드 폴더를 찾을 수 없습니다: %~dp0..\expense_tracker
    pause
    exit /b 1
)
set "BACKEND=%CD%"
popd

echo ===================================================
echo  가계부 Pro 실행 (백엔드 5000 + 신버전 프론트 3000)
echo ===================================================
echo   백엔드 : %BACKEND%
echo   프론트 : %FRONTEND%
echo.

REM ── 백엔드 (FastAPI, 포트 5000) ────────────────────────────
echo [1/2] 백엔드 시작 (FastAPI : 5000)
if not exist "%BACKEND%\.venv64\Scripts\python.exe" (
    echo     [경고] .venv64 가상환경을 찾지 못했습니다. 시스템 python 으로 시도합니다.
    start "Gagye Backend (5000)" /d "%BACKEND%" cmd /k python app.py
) else (
    start "Gagye Backend (5000)" /d "%BACKEND%" cmd /k .venv64\Scripts\python.exe app.py
)

REM ── 프론트 (Next.js, 포트 3000) ────────────────────────────
echo [2/2] 프론트 시작 (Next.js : 3000)
if not exist "%FRONTEND%node_modules" (
    echo     node_modules 가 없어 npm install 을 먼저 실행합니다...
    start "Gagye Frontend (3000)" /d "%FRONTEND%" cmd /k npm install ^&^& npm run dev
) else (
    start "Gagye Frontend (3000)" /d "%FRONTEND%" cmd /k npm run dev
)

echo.
echo 두 창이 각각 떴는지 확인하세요.
echo 잠시 후 브라우저에서  http://localhost:3000  접속.
echo (이 창은 닫아도 됩니다)
echo.

REM 프론트가 컴파일될 시간을 주고 브라우저 열기
timeout /t 8 > nul
start "" "http://localhost:3000"

endlocal
