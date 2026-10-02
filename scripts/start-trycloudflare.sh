#!/bin/bash

LOG_FILE="/home/a/trycloudflare.log"
URL_FILE="/home/a/Desktop/現在の公開URL.txt"

# 既存のログをリセット
echo "=== Cloudflare Quick Tunnel 起動中: $(date '+%Y-%m-%d %H:%M:%S') ===" > "$LOG_FILE"
echo "トンネル接続を確立中..." > "$URL_FILE"

# cloudflared を起動 (Port 8000 医療統合ポータル)
/usr/bin/cloudflared tunnel --url http://localhost:8000 >> "$LOG_FILE" 2>&1 &
CF_PID=$!

cleanup() {
    echo "トンネルを停止中..."
    kill -TERM "$CF_PID" 2>/dev/null || true
    echo "トンネルは停止されました ($(date '+%Y-%m-%d %H:%M:%S'))" > "$URL_FILE"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# URLを監視してデスクトップのファイルに出力 ＆ メール通知
(
    for i in {1..30}; do
        URL=$(grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' "$LOG_FILE" | head -n 1 || true)
        if [ -n "$URL" ]; then
            cat << OUT > "$URL_FILE"
=============================================================
🏥 交雄会だて病院 医療統合ポータル 外部アクセスURL
=============================================================
【アクセスURL】
👉 $URL

【更新日時】
$(date '+%Y年%m月%d日 %H:%M:%S')

【ログインアカウント】
・管理者: admin / pass
・各職員: 登録済み職員ID / パスワード

※PC起動時やトンネル再接続のたびに、このファイルのURLが
  自動的に最新のアドレスに更新されます。
=============================================================
OUT
            echo "[TryCloudflare] 公開URLが確定しました: $URL"

            # 📧 メール自動通知を実行 (datebyoai@gmail.com, rentogen@koyukai-g.jp, pt.koyama@koyukai-g.jp)
            PY_SCRIPT="/home/a/Desktop/ai/agy-project/scripts/send_tunnel_url.py"
            if [ ! -f "$PY_SCRIPT" ]; then
                PY_SCRIPT="/home/a/send_tunnel_url.py"
            fi
            if [ -f "$PY_SCRIPT" ]; then
                echo "[TryCloudflare] メール通知処理を実行中 (スクリプト: $PY_SCRIPT)..." >> "$LOG_FILE"
                /usr/bin/python3 "$PY_SCRIPT" "$URL" >> "$LOG_FILE" 2>&1 &
            fi

            break
        fi
        sleep 1
    done
) &

wait "$CF_PID"
