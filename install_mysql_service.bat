@echo off
chcp 65001 > nul
setlocal

:: Admin check
net session > nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Please run as Administrator. Right-click and select "Run as administrator".
    pause
    exit /b 1
)

set MYSQLD="C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe"
set MYINI="C:\ProgramData\MySQL\MySQL Server 8.0\my.ini"
set SVC_NAME=MySQL80

echo [1/3] Registering MySQL as a Windows service...
%MYSQLD% --install %SVC_NAME% --defaults-file=%MYINI%
if %errorLevel% neq 0 (
    echo [WARN] Registration may have failed or service already exists. Continuing...
)

echo.
echo [2/3] Setting startup type to Automatic...
sc config %SVC_NAME% start= auto
if %errorLevel%==0 (echo   OK) else (echo   FAILED)

echo.
echo [3/3] Starting MySQL service now...
net start %SVC_NAME%
if %errorLevel%==0 (echo   Started successfully.) else (echo   Already running or failed to start.)

echo.
echo ===================================================
sc query %SVC_NAME% | findstr "STATE"
echo ===================================================
echo MySQL will now start automatically on every reboot.
pause
