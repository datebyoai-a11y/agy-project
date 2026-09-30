#!/bin/bash
set -e

echo "========================================================"
echo "🖥️ Linux Mint (Cinnamon) 画面共有 VNC サーバー設定スクリプト"
echo "========================================================"

# パスワードの設定
DEFAULT_PASS="admin123"
read -p "VNC接続用パスワードを入力してください (Enterキーで初期値: ${DEFAULT_PASS}): " INPUT_PASS
VNC_PASS="${INPUT_PASS:-$DEFAULT_PASS}"

echo ""
echo "[1/4] x11vnc パッケージをインストール中..."
apt-get update -qq
apt-get install -y -qq x11vnc

echo "[2/4] VNC パスワードを設定中..."
mkdir -p /etc/x11vnc
x11vnc -storepasswd "$VNC_PASS" /etc/x11vnc/passwd
chmod 600 /etc/x11vnc/passwd

echo "[3/4] systemd サービス (/etc/systemd/system/x11vnc.service) を登録中..."
cat << 'EOF' > /etc/systemd/system/x11vnc.service
[Unit]
Description=x11vnc Remote Desktop Server
After=display-manager.service network.target

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -auth guess -forever -loop -noxdamage -repeat -rfbauth /etc/x11vnc/passwd -rfbport 5900 -shared
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[4/4] サービスを有効化し、起動中..."
systemctl daemon-reload
systemctl enable --now x11vnc.service

sleep 2

echo ""
echo "========================================================"
echo "✅ VNC サーバーが正常に起動・自動常駐しました！"
echo "========================================================"
echo "【接続情報】"
echo "  ・ポート番号: 5900"
echo "  ・VNCパスワード: ${VNC_PASS}"
echo ""
echo "【接続先アドレス】"
echo "  1. 宅内LANからの接続: 192.168.0.203:5900"
echo "  2. Tailscale VPN経由（外出先・安全）: 100.125.124.23:5900"
echo "  3. SSHトンネル経由（ルーターポート開放不要・暗号化）:"
echo "     ssh -p 50022 -L 5900:localhost:5900 a@toyako.f5.si"
echo "     -> 接続後、手元のPCから localhost:5900 で接続"
echo "========================================================"
