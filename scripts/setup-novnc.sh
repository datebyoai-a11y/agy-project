#!/bin/bash
set -e

echo "========================================================"
echo "🔒 noVNC + SSHトンネル完全セキュア設定スクリプト"
echo "========================================================"

echo "[1/4] novnc および websockify をインストール中..."
apt-get update -qq
apt-get install -y -qq novnc websockify

echo "[2/4] トップページのリダイレクト設定 (vnc.html -> index.html)..."
ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html

echo "[3/4] x11vnc をローカル専用 (127.0.0.1) に制限..."
if grep -q "rfbport 5900" /etc/systemd/system/x11vnc.service && ! grep -q "\-localhost" /etc/systemd/system/x11vnc.service; then
    sed -i 's/ExecStart=\(.*\) -shared/ExecStart=\1 -shared -localhost/' /etc/systemd/system/x11vnc.service
    systemctl daemon-reload
    systemctl restart x11vnc.service
fi

echo "[4/4] noVNCをローカル限定 (127.0.0.1:6080) で systemd に登録・起動..."
cat << 'EOF' > /etc/systemd/system/novnc.service
[Unit]
Description=noVNC Web Remote Desktop (Localhost Only for SSH Tunneling)
After=x11vnc.service network.target
Wants=x11vnc.service

[Service]
Type=simple
User=root
ExecStart=/usr/bin/websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now novnc.service

sleep 2

echo ""
echo "========================================================"
echo "✅ セキュア設定が完了しました！外部ポート(6080/5900)は一切開きません。"
echo "========================================================"
echo "接続するクライアント端末（Windows / Mac / Linux等）のターミナルで"
echo "以下のSSHコマンドを実行してください："
echo ""
echo "👉 SSHトンネルコマンド:"
echo "   ssh -p 50022 -L 6080:localhost:6080 a@192.168.0.203"
echo "   (または Tailscale: ssh -p 50022 -L 6080:localhost:6080 a@100.125.124.23)"
echo ""
echo "接続後、クライアントPCのブラウザで以下を開くだけで接続できます："
echo "👉 http://localhost:6080/"
echo "========================================================"
