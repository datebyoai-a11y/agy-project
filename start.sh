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

PROJECT_DIR="/home/a/Desktop/ai"
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
    # ポート 3000, 4000, 5000 のプロセスを終了
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
    # MongoDB
    if pgrep -x mongod > /dev/null; then
      echo "  [DB]     MongoDB (Port 27017)        : 🟢 稼働中"
    else
      echo "  [DB]     MongoDB (Port 27017)        : 🔴 停止"
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
