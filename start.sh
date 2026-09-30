#!/bin/bash
# ==============================================================================
# 🏥 交雄会だて病院 医療統合システム 一括起動スクリプト (start.sh)
# 
# 使い方:
#   ./start.sh         : 通常起動 (フォアグラウンド / Ctrl+C で停止)
#   ./start.sh start   : バックグラウンド起動 (常駐モード)
#   ./start.sh stop    : すべてのシステムを停止
#   ./start.sh status  : 稼働ステータスを確認
#   ./start.sh restart : すべてのシステムを再起動
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

ACTION="${1:-foreground}"

case "$ACTION" in
  start|--daemon|-d)
    echo "================================================================"
    echo "🏥 医療統合システムをバックグラウンドで一括起動します..."
    echo "================================================================"
    
    # 既存のプロセスを停止
    "$0" stop > /dev/null 2>&1
    sleep 1

    setsid node start.js </dev/null > launcher.log 2>&1 &
    PID=$!
    echo $PID > .launcher.pid
    sleep 3

    echo "✅ バックグラウンド起動完了 (PID: $PID)"
    echo "📄 ログ確認: tail -f $PROJECT_DIR/launcher.log"
    echo ""
    "$0" status
    ;;

  stop)
    echo "🛑 すべての医療システムを停止しています..."
    if [ -f .launcher.pid ]; then
      kill "$(cat .launcher.pid)" 2>/dev/null
      rm -f .launcher.pid
    fi
    # ポート 8000, 8080, 8081, 3000, 4000, 5000 のプロセスを終了
    fuser -k 8000/tcp 2>/dev/null
    fuser -k 8080/tcp 2>/dev/null
    fuser -k 8081/tcp 2>/dev/null
    fuser -k 3000/tcp 2>/dev/null
    fuser -k 4000/tcp 2>/dev/null
    fuser -k 5000/tcp 2>/dev/null
    fuser -k 4443/tcp 2>/dev/null
    fuser -k 5443/tcp 2>/dev/null
    sleep 1
    echo "✅ すべてのシステムを停止しました。"
    ;;

  status)
    echo "================================================================"
    echo "📊 システム稼働ステータス:"
    echo "----------------------------------------------------------------"
    # MongoDB Replica Set (rs0)
    if lsof -ti :27017 > /dev/null 2>&1; then
      echo "  [DB-Pri] MongoDB Primary (Port 27017)   : 🟢 稼働中 (書き込み・マスター)"
    else
      echo "  [DB-Pri] MongoDB Primary (Port 27017)   : 🔴 停止"
    fi
    if lsof -ti :27018 > /dev/null 2>&1; then
      echo "  [DB-Sec] MongoDB Secondary (Port 27018) : 🟢 稼働中 (リアルタイム完全二重化)"
    else
      echo "  [DB-Sec] MongoDB Secondary (Port 27018) : 🔴 停止"
    fi
    if lsof -ti :27019 > /dev/null 2>&1; then
      echo "  [DB-Arb] MongoDB Arbiter (Port 27019)   : 🟢 稼働中 (自動選出・調停ノード)"
    else
      echo "  [DB-Arb] MongoDB Arbiter (Port 27019)   : 🔴 停止"
    fi

    # Integrated Portal (Port 8000)
    if lsof -ti :8000 > /dev/null 2>&1; then
      echo "  [総合]   医療統合ポータル              : 🟢 稼働中 (http://localhost:8000)"
    else
      echo "  [総合]   医療統合ポータル              : 🔴 停止"
    fi

    # Radiology Ordering (Port 8080)
    if lsof -ti :8080 > /dev/null 2>&1; then
      echo "  [放射線] 放射線科オーダー & 帳票印刷   : 🟢 稼働中 (http://localhost:8080)"
    else
      echo "  [放射線] 放射線科オーダー & 帳票印刷   : 🔴 停止"
    fi

    # Radiology Receiver (Port 8081)
    if lsof -ti :8081 > /dev/null 2>&1; then
      echo "  [放射線] 放射線科【指示受けモニター】  : 🟢 稼働中 (http://localhost:8081 / Proxy: /radi-uke/)"
    else
      echo "  [放射線] 放射線科【指示受けモニター】  : 🔴 停止"
    fi

    # Incident System (Port 3000)
    if lsof -ti :3000 > /dev/null 2>&1; then
      echo "  [1/3]    インシデント管理 / 電子カルテ  : 🟢 稼働中 (http://localhost:3000)"
    else
      echo "  [1/3]    インシデント管理 / 電子カルテ  : 🔴 停止"
    fi

    # Ordering Sender (Port 4000)
    if lsof -ti :4000 > /dev/null 2>&1; then
      echo "  [2/3]    オーダリング【送信側】       : 🟢 稼働中 (http://localhost:4000)"
    else
      echo "  [2/3]    オーダリング【送信側】       : 🔴 停止"
    fi

    # Ordering Receiver (Port 5000)
    if lsof -ti :5000 > /dev/null 2>&1; then
      echo "  [3/3]    オーダリング【受信側】       : 🟢 稼働中 (http://localhost:5000)"
    else
      echo "  [3/3]    オーダリング【受信側】       : 🔴 停止"
    fi
    echo "================================================================"
    ;;

  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;

  foreground|*)
    node start.js
    ;;
esac
