#!/bin/bash
# ==============================================================================
# 🏠 自宅サーバー（Dynabook）外部接続ワンクリック・スクリプト
# 
# 【機能】
# 1. 外部の手元PCからSSHトンネル（暗号化）を自動確立 (Port 50022)
# 2. リモートデスクトップ (6080) & 医療ポータル (8000) を安全に転送
# 3. ブラウザで noVNC を自動起動
# 4. Ctrl+C で安全にトンネルを切断・終了
# ==============================================================================

# 設定パラメータ
SSH_PORT="50022"
SSH_USER="a"
DDNS_HOST="toyako.f5.si"
TAILSCALE_HOST="100.125.124.23"
LAN_HOST="192.168.0.203"

# サーバー本体上で実行された場合の案内
if [ "$(hostname)" = "a-dynabook-B55-H" ]; then
    echo "========================================================"
    echo "💡 ここは接続先の自宅サーバー本体（Dynabook）です！"
    echo "========================================================"
    echo "このスクリプトは【外出先の手元PC（ノートPC等）】側で実行するものです。"
    echo ""
    echo "本体上ではすでに各サービス（6080 / 8000 / 5900）が稼働しているため、"
    echo "SSHトンネルを張る必要はなく、直接ブラウザでご利用いただけます："
    echo ""
    echo "👉 🖥️ noVNC リモートデスクトップ : http://localhost:6080/"
    echo "👉 🏥 医療ポータル（カルテ・管理）: http://localhost:8000/"
    echo "--------------------------------------------------------"
    echo "【手元の別PC（外出用ノートPC）にこのスクリプトを持っていく方法】"
    echo "  (手元PCのターミナルで実行)"
    echo "  scp -P 50022 a@100.125.124.23:~/connect-home.sh ."
    echo "========================================================"
    read -p "この本体でブラウザを開きますか？ [Y/n]: " OPEN_LOCAL
    OPEN_LOCAL=${OPEN_LOCAL:-Y}
    if [[ "$OPEN_LOCAL" =~ ^[Yy]$ ]]; then
        xdg-open "http://localhost:6080/" >/dev/null 2>&1 &
    fi
    exit 0
fi

echo "========================================================"
echo "🔒 自宅サーバー (Dynabook) 安全接続ツール"
echo "========================================================"
echo "接続方法を選択してください："
echo "  [1] 外出先から接続（Tailscale経由・推奨・ルーター設定不要）"
echo "  [2] 外出先から接続（DDNSドメイン toyako.f5.si 経由）"
echo "  [3] 自宅内LANから接続 (192.168.0.203)"
echo "--------------------------------------------------------"
read -p "選択 [1-3] (デフォルト: 1): " CHOICE
CHOICE=${CHOICE:-1}

case "$CHOICE" in
  1)
    TARGET_HOST="$TAILSCALE_HOST"
    ROUTE_NAME="Tailscale VPN"
    ;;
  2)
    TARGET_HOST="$DDNS_HOST"
    ROUTE_NAME="DDNSドメイン ($DDNS_HOST)"
    ;;
  3)
    TARGET_HOST="$LAN_HOST"
    ROUTE_NAME="宅内LAN"
    ;;
  *)
    echo "❌ 無効な選択です。終了します。"
    exit 1
    ;;
esac

echo ""
echo "🚀 [$ROUTE_NAME] へ安全な暗号化SSHトンネルを確立しています..."
echo "   対象: $SSH_USER@$TARGET_HOST : $SSH_PORT"
echo ""

# SSHトンネルをバックグラウンドで開始
# -L 6080:localhost:6080  -> noVNC リモートデスクトップ
# -L 8000:localhost:8000  -> 医療ポータル・カルテ・管理画面
# -L 5900:localhost:5900  -> ネイティブVNCクライアント用
ssh -p "$SSH_PORT" \
    -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -L 6080:localhost:6080 \
    -L 8000:localhost:8000 \
    -L 5900:localhost:5900 \
    "$SSH_USER@$TARGET_HOST" &

SSH_PID=$!

# 終了時（Ctrl+C 等）にSSHプロセスを確実に停止するクリーンアップ関数
cleanup() {
    echo ""
    echo "🛑 SSHトンネルを切断中..."
    kill $SSH_PID 2>/dev/null
    wait $SSH_PID 2>/dev/null
    echo "✅ 安全に切断しました。お疲れ様でした。"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# トンネル確立待機
sleep 2

# SSHプロセスが正常に生きているか確認
if ! kill -0 $SSH_PID 2>/dev/null; then
    echo "❌ SSH接続に失敗しました。"
    echo "   ・接続先IP/ドメインが正しいか"
    echo "   ・SSH公開鍵認証が設定されているか"
    echo "   ・ルーターのポート転送(50022)またはTailscaleが有効か確認してください。"
    exit 1
fi

echo "========================================================"
echo "🎉 接続完了！ 以下のURLで手元から安全に操作できます："
echo "========================================================"
echo "👉 🖥️ リモートデスクトップ (noVNC):"
echo "   http://localhost:6080/"
echo ""
echo "👉 🏥 医療ポータル（カルテ・患者管理・オーダー）:"
echo "   http://localhost:8000/"
echo "========================================================"
echo "※ このウィンドウを開いたまま作業してください。"
echo "※ 終了するときは [Ctrl + C] を押してください。"
echo "========================================================"

# ブラウザを自動で開く（Mac / Linux / Windows WSL対応）
URL="http://localhost:6080/"
if command -v xdg-open > /dev/null; then
    xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open > /dev/null; then
    open "$URL" >/dev/null 2>&1 &
elif command -v cmd.exe > /dev/null; then
    cmd.exe /c start "$URL" >/dev/null 2>&1 &
fi

# SSHプロセスの監視（フォアグラウンド待機）
wait $SSH_PID
