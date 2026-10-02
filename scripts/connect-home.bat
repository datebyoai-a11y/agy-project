@echo off
chcp 65001 > nul
title 自宅サーバー (Dynabook) 安全接続ツール

echo ========================================================
echo 🔒 自宅サーバー (Dynabook) 外部接続ツール (Windows版)
echo ========================================================
echo 接続方法を選択してください：
echo   [1] 外出先から接続 (Tailscale経由・推奨)
echo   [2] 外出先から接続 (DDNSドメイン toyako.f5.si 経由)
echo   [3] 自宅内LANから接続 (192.168.0.203)
echo --------------------------------------------------------
set /p CHOICE="選択 [1-3] (デフォルト: 1): "
if "%CHOICE%"=="" set CHOICE=1

if "%CHOICE%"=="1" (
    set TARGET=100.125.124.23
    set ROUTE=Tailscale VPN
) else if "%CHOICE%"=="2" (
    set TARGET=toyako.f5.si
    set ROUTE=DDNSドメイン (toyako.f5.si)
) else if "%CHOICE%"=="3" (
    set TARGET=192.168.0.203
    set ROUTE=宅内LAN
) else (
    echo 無効な選択です。
    pause
    exit /b 1
)

echo.
echo 🚀 [%ROUTE%] へ安全なSSHトンネルを確立しています...
echo.

start "" "http://localhost:6080/"

echo ========================================================
echo 🎉 トンネル接続中... 
echo 👉 🖥️ リモートデスクトップ: http://localhost:6080/
echo 👉 🏥 医療ポータル:        http://localhost:8000/
echo ========================================================
echo ※ この黒い画面を閉じると接続が切断されます。
echo ========================================================
echo.

ssh -p 50022 -L 6080:localhost:6080 -L 8000:localhost:8000 -L 5900:localhost:5900 a@%TARGET%

pause
