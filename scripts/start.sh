#!/bin/bash
# ==============================================================================
# 🏥 交雄会だて病院 医療統合システム 一括起動スクリプト (start.sh)
#    院内イントラネット HTTP モード (Port 80)
#    - 有線LAN (enp0s31f6) 接続時: 192.168.20.221:80 (+ 127.0.0.1:80)
#    - 有線LAN 切断時 (DHCP)     : DHCP取得IP:80 (+ 127.0.0.1:80)
#    - 各部門サブシステム        : 127.0.0.1 ローカル隔離
#
# 使い方:
#   ./start.sh         : 通常起動 (フォアグラウンド / Ctrl+C で停止)
#   ./start.sh start   : バックグラウンド起動 (常駐モード)
#   ./start.sh stop    : すべてのシステムを停止
#   ./start.sh status  : 稼働ステータスを確認
#   ./start.sh restart : すべてのシステムを再起動
# ==============================================================================

# スクリプト自身のディレクトリを実体パス（シンボリックリンク解決後）で取得
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

# プロジェクトルートの特定（scripts/ にある場合は1つ上、プロジェクト直下にある場合はカレント）
if [ -d "$SCRIPT_DIR/../support" ]; then
  PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  PROJECT_DIR="$SCRIPT_DIR"
fi

cd "$PROJECT_DIR" || exit 1

WIRED_IFACE="${WIRED_IFACE:-enp0s31f6}"
PORTAL_PORT="${PORT:-80}"

# 現在の接続モードと院内LAN IPを取得 (有線 enp0s31f6 最優先 → 無線/他IF DHCP)
WIRED_IP=$(ip -4 -o addr show dev "$WIRED_IFACE" scope global 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4; exit}')
if [ -n "$WIRED_IP" ]; then
  LAN_MODE_LABEL="有線LAN固定 (${WIRED_IFACE})"
  LAN_IP="$WIRED_IP"
else
  LAN_MODE_LABEL="DHCP (有線未接続)"
  LAN_IP=$(ip -4 -o addr show scope global 2>/dev/null | awk -v w="$WIRED_IFACE" '$2 != w && $2 ~ /^wl/ {sub(/\/.*/, "", $4); print $4; exit}')
  if [ -z "$LAN_IP" ]; then
    LAN_IP=$(ip -4 -o addr show scope global 2>/dev/null | awk -v w="$WIRED_IFACE" '$2 != w && $2 !~ /^tailscale/ {sub(/\/.*/, "", $4); print $4; exit}')
  fi
  LAN_IP="${LAN_IP:-127.0.0.1}"
fi

if [ "$PORTAL_PORT" = "80" ]; then
  PORTAL_URL="http://${LAN_IP}/login"
else
  PORTAL_URL="http://${LAN_IP}:${PORTAL_PORT}/login"
fi

ACTION="${1:-foreground}"

case "$ACTION" in
  start|--daemon|-d)
    echo "================================================================"
    echo "🏥 医療統合システムを院内イントラネット (Port ${PORTAL_PORT}) で起動します..."
    echo "   モード: ${LAN_MODE_LABEL} / IP: ${LAN_IP}"
    echo "================================================================"

    # 既存のプロセスを停止
    "$0" stop > /dev/null 2>&1
    sleep 1

    setsid node "$SCRIPT_DIR/start.js" </dev/null > "$PROJECT_DIR/launcher.log" 2>&1 &
    PID=$!
    echo $PID > "$PROJECT_DIR/.launcher.pid"
    sleep 3

    echo "✅ バックグラウンド起動完了 (PID: $PID)"
    echo "🌐 院内アクセスURL: ${PORTAL_URL}"
    echo "📄 ログ確認: tail -f $PROJECT_DIR/launcher.log"
    echo ""
    "$0" status
    ;;

  stop)
    echo "🛑 すべての医療システムを停止しています..."
    if [ -f "$PROJECT_DIR/.launcher.pid" ]; then
      kill "$(cat "$PROJECT_DIR/.launcher.pid")" 2>/dev/null
      rm -f "$PROJECT_DIR/.launcher.pid"
    fi
    # 全関連ポートのプロセスを終了
    for P in 80 8443 8000 8080 8081 8082 8083 8084 8085 3000 4000 5000 4443 5443; do
      fuser -k "${P}/tcp" 2>/dev/null
    done
    sleep 1
    echo "✅ すべてのシステムを停止しました。"
    ;;

  status)
    echo "================================================================"
    echo "📊 システム稼働ステータス (院内イントラネット Port ${PORTAL_PORT}):"
    echo "   接続モード    : ${LAN_MODE_LABEL}"
    echo "   サーバーLAN IP: ${LAN_IP}"
    echo "----------------------------------------------------------------"
    # MongoDB Replica Set (rs0)
    if lsof -ti :27017 > /dev/null 2>&1; then
      echo "  [DB-Pri] MongoDB Primary (127.0.0.1:27017)   : 🟢 稼働中 (書き込み・マスター)"
    else
      echo "  [DB-Pri] MongoDB Primary (127.0.0.1:27017)   : 🔴 停止"
    fi
    if lsof -ti :27018 > /dev/null 2>&1; then
      echo "  [DB-Sec] MongoDB Secondary (127.0.0.1:27018) : 🟢 稼働中 (リアルタイム完全二重化)"
    else
      echo "  [DB-Sec] MongoDB Secondary (127.0.0.1:27018) : 🔴 停止"
    fi
    if lsof -ti :27019 > /dev/null 2>&1; then
      echo "  [DB-Arb] MongoDB Arbiter (127.0.0.1:27019)   : 🟢 稼働中 (自動選出・調停ノード)"
    else
      echo "  [DB-Arb] MongoDB Arbiter (127.0.0.1:27019)   : 🔴 停止"
    fi

    # Integrated Portal (Port 80)
    BOUND_ADDRS=$(ss -tlnH "sport = :${PORTAL_PORT}" 2>/dev/null | awk '{print $4}' | tr '\n' ' ' | sed 's/ $//')
    if [ -n "$BOUND_ADDRS" ]; then
      echo "  [総合]   医療統合ポータル (Port ${PORTAL_PORT})          : 🟢 稼働中 (${PORTAL_URL})"
      echo "           待ち受けバインド                    : ${BOUND_ADDRS}"
    else
      echo "  [総合]   医療統合ポータル (Port ${PORTAL_PORT})          : 🔴 停止"
    fi

    # Local-only Backend Subsystems
    if lsof -ti :8080 > /dev/null 2>&1; then
      echo "  [放射線] 放射線科オーダー (127.0.0.1:8080)   : 🟢 稼働中 (Proxy: /radiology/)"
    else
      echo "  [放射線] 放射線科オーダー (127.0.0.1:8080)   : 🔴 停止"
    fi

    if lsof -ti :8081 > /dev/null 2>&1; then
      echo "  [放射線] 放射線科 指示受け (127.0.0.1:8081)  : 🟢 稼働中 (Proxy: /radi-uke/)"
    else
      echo "  [放射線] 放射線科 指示受け (127.0.0.1:8081)  : 🔴 停止"
    fi

    if lsof -ti :8082 > /dev/null 2>&1; then
      echo "  [注射]   注射・点滴オーダー (127.0.0.1:8082) : 🟢 稼働中 (Proxy: /injection/)"
    else
      echo "  [注射]   注射・点滴オーダー (127.0.0.1:8082) : 🔴 停止"
    fi

    if lsof -ti :8083 > /dev/null 2>&1; then
      echo "  [リハ]   リハビリ指示書 (127.0.0.1:8083)     : 🟢 稼働中 (Proxy: /rehabili/)"
    else
      echo "  [リハ]   リハビリ指示書 (127.0.0.1:8083)     : 🔴 停止"
    fi

    if lsof -ti :8085 > /dev/null 2>&1; then
      echo "  [リハ]   リハビリ指示受け (127.0.0.1:8085)   : 🟢 稼働中 (Proxy: /reha-uke/)"
    else
      echo "  [リハ]   リハビリ指示受け (127.0.0.1:8085)   : 🔴 停止"
    fi

    if lsof -ti :8084 > /dev/null 2>&1; then
      echo "  [内服]   内服・外用処方 (127.0.0.1:8084)     : 🟢 稼働中 (Proxy: /naifuku/)"
    else
      echo "  [内服]   内服・外用処方 (127.0.0.1:8084)     : 🔴 停止"
    fi

    if lsof -ti :3000 > /dev/null 2>&1; then
      echo "  [カルテ] インシデント/電子カルテ (:3000)     : 🟢 稼働中 (127.0.0.1隔離 / Proxy: /articles)"
    else
      echo "  [カルテ] インシデント/電子カルテ (:3000)     : 🔴 停止"
    fi

    if lsof -ti :4000 > /dev/null 2>&1; then
      echo "  [統合]   オーダリング総合ポータル (:4000)    : 🟢 稼働中 (127.0.0.1隔離 / Proxy: /ordering/)"
    else
      echo "  [統合]   オーダリング総合ポータル (:4000)    : 🔴 停止"
    fi
    echo "  [部門]   オーダリング受信側 (Port 5000)      : 🔒 閉鎖（各科指示受けモニターへ統合）"
    echo "================================================================"
    ;;

  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;

  foreground|*)
    node "$SCRIPT_DIR/start.js"
    ;;
esac
