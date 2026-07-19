@echo off
chcp 65001 > nul
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

echo ===================================================
echo  가계부 전체 실행 (백엔드 5000 + 프론트 3000)
echo ===================================================
echo.

REM ── 기존 인스턴스 정리 (겹침 방지) ──────────────────────────────────
REM   백엔드 5000 / 프론트 3000 을 잡은 프로세스 중 **이 폴더(expense_tracker) 소속만**
REM   종료한다. 포트만 보고 죽이면 3000 에 다른 프로젝트가 떠 있을 때 남의 서버를
REM   내린다(실제로 그런 경우가 있었다). 판정 로직은 _stop_gagebu.ps1 에 있다.
echo [0/2] 기존 5000/3000 인스턴스 정리...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_stop_gagebu.ps1"
REM   포트 해제 대기
timeout /t 2 > nul

REM ── 백엔드 (FastAPI, 포트 5000) ──
REM   start 가 부모 배치의 현재 폴더(%~dp0)와 환경변수(PYTHONUTF8 등)를 그대로 상속하므로
REM   중첩 따옴표 없이 /d 로 작업 폴더만 지정한다.
echo [1/2] 백엔드 시작 (FastAPI : 5000)
start "Gagye Backend (5000)" /d "%~dp0" cmd /k .venv64\Scripts\python.exe app.py

REM ── 프론트 (Next.js, 포트 3000) ──
echo [2/2] 프론트 시작 (Next.js : 3000)
if not exist "frontend\node_modules" (
    echo     node_modules 가 없어 npm install 을 먼저 실행합니다...
    start "Gagye Frontend (3000)" /d "%~dp0frontend" cmd /k npm install ^&^& npm run dev
) else (
    start "Gagye Frontend (3000)" /d "%~dp0frontend" cmd /k npm run dev
)

echo.
echo 두 창이 각각 떴는지 확인하세요.
echo 잠시 후 브라우저에서  http://localhost:3000  접속.
echo (이 창은 닫아도 됩니다)
echo.

REM 프론트가 컴파일될 시간을 주고 브라우저 열기
timeout /t 6 > nul
start "" "http://localhost:3000"

endlocal
