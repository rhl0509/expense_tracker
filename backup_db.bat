@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

:: .env 파일에서 DB 설정 로드
for /f "tokens=1,* delims==" %%A in ('type .env ^| findstr /r "^DB_HOST ^DB_USER ^DB_PASSWORD ^DB_NAME"') do set %%A=%%B

:: 기본값 (로드 실패 시 폴백)
if "%DB_HOST%"==""     set DB_HOST=localhost
if "%DB_USER%"==""     set DB_USER=root
if "%DB_NAME%"==""     set DB_NAME=expense_tracker
set BACKUP_DIR=backup\db

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

:: Get date from Python (locale-safe)
for /f %%d in ('.venv64\Scripts\python.exe -c "from datetime import date; print(date.today())"') do set TODAY=%%d
set OUTFILE=%BACKUP_DIR%\%DB_NAME%_%TODAY%.sql

:: Find mysqldump
set MYSQLDUMP=
if exist "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"  set MYSQLDUMP=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe
if exist "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe"  set MYSQLDUMP=C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe
if exist "C:\xampp\mysql\bin\mysqldump.exe"                           set MYSQLDUMP=C:\xampp\mysql\bin\mysqldump.exe
if "%MYSQLDUMP%"=="" (
    where mysqldump > nul 2>&1
    if %ERRORLEVEL%==0 set MYSQLDUMP=mysqldump
)
if "%MYSQLDUMP%"=="" (
    echo [ERROR] mysqldump not found. Add MySQL bin directory to PATH.
    pause
    exit /b 1
)

echo Backing up %DB_NAME% to %OUTFILE% ...
"%MYSQLDUMP%" -h %DB_HOST% -u %DB_USER% -p%DB_PASSWORD% %DB_NAME% > "%OUTFILE%"
if %ERRORLEVEL%==0 (
    echo Done: %OUTFILE%
) else (
    echo [ERROR] Dump failed.
    del "%OUTFILE%" 2>nul
)

echo.
echo Keeping last 30 backups...
.venv64\Scripts\python.exe -c "import os,glob; files=sorted(glob.glob('%BACKUP_DIR%/*.sql')); [os.remove(f) for f in files[:-30]]"

pause
