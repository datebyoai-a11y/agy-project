@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "PORT=27017"
set "BIND_IP=127.0.0.1"

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

echo 🍃 MongoDB (ポート: %PORT%) を停止しています...

where mongosh >nul 2>&1
if %errorlevel% equ 0 (
  mongosh --port %PORT% --host %BIND_IP% admin --eval "db.shutdownServer()" >nul 2>&1
  if %errorlevel% equ 0 (
    echo ✅ MongoDB を正常に停止しました。
    timeout /t 2 >nul
    exit /b 0
  )
)

taskkill /F /IM mongod.exe >nul 2>&1
if %errorlevel% equ 0 (
  echo ✅ mongod.exe プロセスを停止しました。
) else (
  echo ⚠️ 停止対象の mongod.exe プロセスが見つかりませんでした。
)
timeout /t 2 >nul
