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
    if "%%A"=="PORT" set "PORT=%%B"
    if "%%A"=="BIND_IP" set "BIND_IP=%%B"
  )
)

if not exist "%DUMP_DIR%" (
  echo 【エラー】復元用ダンプフォルダが見つかりません: %DUMP_DIR%
  pause
  exit /b 1
)

echo === MongoDB 復元開始 (ダンプ元: %DUMP_DIR%) ===
mongorestore --host %BIND_IP% --port %PORT% "%DUMP_DIR%"
echo === MongoDB 復元完了 ===
pause
