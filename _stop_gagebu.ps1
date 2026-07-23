# _stop_gagebu.ps1 — 가계부 백엔드(8010)/프론트(3010) 기존 인스턴스만 안전 종료.
# start_all.bat 이 새로 띄우기 전에 호출한다. 단독 실행도 가능(정지만).
#
# ■ 왜 포트만으로 안 죽이나
#   3010/8010 에 다른 프로젝트가 떠 있을 수 있다(실제로 그런 경우가 있었다).
#   포트만 보고 죽이면 남의 서버를 내린다. 그래서 "이 폴더(expense_tracker)의
#   프로세스인가" 를 확인한 것만 죽인다.
#
# ■ 판정 (아래 중 하나라도 참이면 이 폴더 소속)
#   ① 프로세스 커맨드라인에 이 폴더 경로가 들어 있다(프론트: next 경로가 박힘)
#   ② 부모 프로세스 체인 어딘가의 커맨드라인에 이 폴더 경로가 있다
#      (백엔드: python app.py 는 경로가 안 박혀도, 조상인 start_all.bat 이 잡힌다)
#   실행 이미지 경로(.Path)로는 판정하지 않는다 — python.exe/node.exe 는 폴더 밖에 있다.

$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot            # 이 스크립트가 있는 폴더 = D:\expense_tracker
$selfPid = $PID                  # 나(그리고 나를 부른 배치) 는 죽이지 않는다

# 나의 조상 PID 집합 — start_all.bat → powershell 체인을 종료 대상에서 제외
$ancestors = @{}
$cur = Get-CimInstance Win32_Process -Filter "ProcessId = $selfPid"
$d = 0
while ($cur -and $d -lt 6) {
    $ancestors[$cur.ProcessId] = $true
    $cur = Get-CimInstance Win32_Process -Filter "ProcessId = $($cur.ParentProcessId)"
    $d++
}

function Test-BelongsHere($proc) {
    if ($proc.CommandLine -like "*$root*") { return $true }
    $c = $proc; $depth = 0
    while ($c -and $depth -lt 6) {
        $par = Get-CimInstance Win32_Process -Filter "ProcessId = $($c.ParentProcessId)"
        if ($par -and $par.CommandLine -like "*$root*") { return $true }
        $c = $par; $depth++
    }
    return $false
}

foreach ($port in 8010, 3010) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen
    if (-not $conns) { Write-Host "  [$port] 점유 없음"; continue }
    foreach ($conn in $conns) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)"
        if (-not $p) { continue }
        if ($ancestors.ContainsKey($p.ProcessId)) { continue }   # 나 자신/조상 제외
        if (Test-BelongsHere $p) {
            # 트리로 종료 — uvicorn 자식/워커까지 함께 내린다. taskkill 의 stdout/stderr 를
            # 파이프로 버리면 PowerShell 이 네이티브 stderr 를 오류로 승격시켜 조용히
            # 실패할 수 있다. cmd 로 감싸 출력을 그쪽에서 흡수하고 결과만 확인한다.
            & cmd /c "taskkill /PID $($p.ProcessId) /T /F >nul 2>&1"
            Start-Sleep -Milliseconds 300
            $alive = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
            if ($alive) { Write-Host "  [$port] 종료 실패 pid=$($p.ProcessId) (권한 확인)" }
            else        { Write-Host "  [$port] 종료 pid=$($p.ProcessId)" }
        } else {
            Write-Host "  [$port] 건너뜀 pid=$($p.ProcessId) — 이 폴더 밖 프로젝트"
        }
    }
}
