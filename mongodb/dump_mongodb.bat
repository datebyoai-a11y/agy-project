@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "PORT=27017"
set "BIND_IP=127.0.0.1"
set "DUMP_DIR=%SCRIPT_DIR%\dump"

if exist "%SCRIPT_DIR%\config.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%SCRIPT_DIR%\config.env") do (
    set "KEY=%%A"
    set "VAL=%%B"
    if not "!KEY!"=="" (
      for /f "tokens=* delims= " %%x in ("!KEY!") do set "KEY=%%x"
      if "!KEY!"=="PORT" set "PORT=!VAL!"
      if "!KEY!"=="BIND_IP" set "BIND_IP=!VAL!"
    )
  )
)

echo === MongoDB エクスポート開始 (ポート: %PORT%) ===
if not exist "%DUMP_DIR%" mkdir "%DUMP_DIR%"
mongodump --host %BIND_IP% --port %PORT% --out "%DUMP_DIR%"
echo === MongoDB エクスポート完了: %DUMP_DIR% ===
pause
