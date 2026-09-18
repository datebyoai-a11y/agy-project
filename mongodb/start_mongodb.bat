@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "MONGOD_PATH="
set "DATA_PATH="
set "LOG_PATH="
set "PORT=27017"
set "BIND_IP=127.0.0.1"

:: config.env の読み込み
if exist "%SCRIPT_DIR%\config.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%SCRIPT_DIR%\config.env") do (
    set "KEY=%%A"
    set "VAL=%%B"
    if not "!KEY!"=="" (
      for /f "tokens=* delims= " %%x in ("!KEY!") do set "KEY=%%x"
      if "!KEY!"=="MONGOD_PATH" set "MONGOD_PATH=!VAL!"
      if "!KEY!"=="DATA_PATH" set "DATA_PATH=!VAL!"
      if "!KEY!"=="LOG_PATH" set "LOG_PATH=!VAL!"
      if "!KEY!"=="PORT" set "PORT=!VAL!"
      if "!KEY!"=="BIND_IP" set "BIND_IP=!VAL!"
    )
  )
)

:: 1. mongod.exe の探索
if "%MONGOD_PATH%"=="" (
  where mongod.exe >nul 2>&1
  if !errorlevel! equ 0 (
    for /f "delims=" %%I in ('where mongod.exe') do (
      set "MONGOD_PATH=%%I"
      goto :found_mongod
    )
  )
  for /d %%D in ("C:\Program Files\MongoDB\Server\*") do (
    if exist "%%D\bin\mongod.exe" (
      set "MONGOD_PATH=%%D\bin\mongod.exe"
      goto :found_mongod
    )
  )
  for /d %%D in ("D:\Program Files\MongoDB\Server\*") do (
    if exist "%%D\bin\mongod.exe" (
      set "MONGOD_PATH=%%D\bin\mongod.exe"
      goto :found_mongod
    )
  )
)

:found_mongod
if "%MONGOD_PATH%"=="" (
  echo 【エラー】mongod.exe が見つかりませんでした。
  echo config.env の MONGOD_PATH に mongod.exe のフルパスを指定してください。
  pause
  exit /b 1
)

:: 2. データ保存先
if "%DATA_PATH%"=="" (
  set "DATA_PATH=%SCRIPT_DIR%\data"
)
if not exist "%DATA_PATH%" mkdir "%DATA_PATH%" 2>nul

:: 3. ログ保存先
if "%LOG_PATH%"=="" (
  set "LOG_PATH=%DATA_PATH%\mongod.log"
)

echo ======================================================
echo 🍃 MongoDB 起動 (Windows)
echo ------------------------------------------------------
echo mongod パス : %MONGOD_PATH%
echo データ保存先: %DATA_PATH%
echo ログ出力先  : %LOG_PATH%
echo 待受ポート  : %PORT% (IP: %BIND_IP%)
echo ======================================================

start "MongoDB Server (%PORT%)" "%MONGOD_PATH%" --dbpath "%DATA_PATH%" --logpath "%LOG_PATH%" --logappend --port %PORT% --bind_ip %BIND_IP%

echo ✅ MongoDB を起動しました。
echo 停止する場合は stop_mongodb.bat を実行してください。
timeout /t 3 >nul
