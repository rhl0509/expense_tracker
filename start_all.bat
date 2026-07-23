@echo off
chcp 65001 > nul
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

echo ===================================================
echo  가계부 전체 실행 (백엔드 8010 + 프론트 3010)
echo ===================================================
echo.

REM ── 기존 인스턴스 정리 (겹침 방지) ──────────────────────────────────
REM   백엔드 8010 / 프론트 3010 을 잡은 프로세스 중 **이 폴더(expense_tracker) 소속만**
REM   종료한다. 포트만 보고 죽이면 3010 에 다른 프로젝트가 떠 있을 때 남의 서버를
REM   내린다(실제로 그런 경우가 있었다). 판정 로직은 _stop_gagebu.ps1 에 있다.
echo [0/2] 기존 8010/3010 인스턴스 정리...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_stop_gagebu.ps1"
REM   포트 해제 대기
timeout /t 2 > nul

REM ── 포트 가용성 확인 ────────────────────────────────────────────────
REM   정리 후에도 8010/3010 이 남아 있으면 = 남의 프로젝트가 점유 중이다
REM   (_stop_gagebu 는 가계부 소속만 죽인다). next dev/uvicorn 은 포트가 막히면
REM   자동으로 옮기지 않고 하드 에러로 죽으므로, 조용히 실패하기 전에 미리 막는다.
echo [0.5] 8010/3010 포트 가용성 확인...
REM   주의: 포트가 비면 Get-NetTCPConnection 이 "매칭 없음" 비종료 에러로 $?를 false 로
REM   만들어, 명시적 exit 가 없으면 powershell 이 exit 1 로 끝나(=오탐 중단) 버린다.
REM   그래서 마지막에 exit 0/1 을 명시해 종료코드를 확정한다.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$bad=$false; foreach($p in 8010,3010){ $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){ $cl = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess)).CommandLine; Write-Host ('  [사용중] 포트 ' + $p + ' -- PID ' + $c.OwningProcess + ' : ' + $cl); $bad=$true } }; if($bad){ exit 1 } else { exit 0 }"
if errorlevel 1 (
    echo.
    echo  [중단] 8010 또는 3010 포트를 다른 프로젝트가 사용 중입니다.
    echo         위에 표시된 프로세스를 먼저 종료하거나 포트를 비운 뒤 다시 실행하세요.
    echo         가계부 소속 인스턴스는 방금 정리됐으니 남은 점유자는 다른 프로젝트입니다.
    echo.
    pause
    exit /b 1
)

REM ── 백엔드 (FastAPI, 포트 8010) ──
REM   start 가 부모 배치의 현재 폴더(%~dp0)와 환경변수(PYTHONUTF8 등)를 그대로 상속하므로
REM   중첩 따옴표 없이 /d 로 작업 폴더만 지정한다.
echo [1/2] 백엔드 시작 (FastAPI : 8010)
start "Gagye Backend (8010)" /d "%~dp0" cmd /k .venv64\Scripts\python.exe app.py

REM ── 프론트 (Next.js, 포트 3010) ──
echo [2/2] 프론트 시작 (Next.js : 3010)
if not exist "frontend\node_modules" (
    echo     node_modules 가 없어 npm install 을 먼저 실행합니다...
    start "Gagye Frontend (3010)" /d "%~dp0frontend" cmd /k npm install ^&^& npm run dev
) else (
    start "Gagye Frontend (3010)" /d "%~dp0frontend" cmd /k npm run dev
)

echo.
echo 두 창이 각각 떴는지 확인하세요.
echo 잠시 후 브라우저에서  http://localhost:3010  접속.
echo (이 창은 닫아도 됩니다)
echo.

REM 프론트가 컴파일될 시간을 주고 브라우저 열기
timeout /t 6 > nul
start "" "http://localhost:3010"

endlocal
