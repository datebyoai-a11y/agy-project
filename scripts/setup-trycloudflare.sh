#!/bin/bash
set -e

echo "========================================================"
echo "🚀 Cloudflare Quick Tunnel 自動常駐サービス 設定スクリプト"
echo "========================================================"

# 実行権限の付与
chmod +x /home/a/scripts/start-trycloudflare.sh

echo "[1/3] systemd サービスユニット (/etc/systemd/system/trycloudflare.service) を作成中..."
cat << 'EOF' > /etc/systemd/system/trycloudflare.service
[Unit]
Description=Cloudflare Quick Tunnel (TryCloudflare)
After=network.target

[Service]
Type=simple
User=a
WorkingDirectory=/home/a
ExecStart=/bin/bash /home/a/scripts/start-trycloudflare.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[2/3] systemd デーモンをリロードし、自動起動を有効化中..."
systemctl daemon-reload
systemctl enable --now trycloudflare.service

echo "[3/3] トンネル接続とURL発行を待機中..."
sleep 5

echo ""
echo "========================================================"
if [ -f "/home/a/Desktop/現在の公開URL.txt" ]; then
    cat "/home/a/Desktop/現在の公開URL.txt"
else
    echo "⚠️ URL取得中のため、数秒後にデスクトップの「現在の公開URL.txt」をご確認ください。"
fi
echo "========================================================"
echo "✅ 設定が完了しました！PC起動時も自動的に常駐します。"
echo ""
echo "💡 今後の便利なコマンド:"
echo "  ・状態確認: sudo systemctl status trycloudflare"
echo "  ・一時停止: sudo systemctl stop trycloudflare"
echo "  ・再起動:   sudo systemctl restart trycloudflare"
echo "  ・自動起動解除: sudo systemctl disable --now trycloudflare"
