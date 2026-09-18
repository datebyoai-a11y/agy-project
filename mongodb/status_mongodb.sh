#!/bin/bash
# ==============================================================================
# MongoDB ステータス確認スクリプト (Linux Mint / Ubuntu / Debian 用)
# ==============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
if [ -f "${CONFIG_FILE}" ]; then
  set -a
  source "${CONFIG_FILE}"
  set +a
fi

PORT="${PORT:-27017}"
BIND_IP="${BIND_IP:-127.0.0.1}"

echo "======================================================"
echo "🍃 MongoDB 稼働状態確認 (ポート: ${PORT})"
echo "======================================================"

if command -v mongosh >/dev/null 2>&1; then
  if mongosh --port "${PORT}" --host "${BIND_IP}" --eval "db.adminCommand('ping')" --quiet 2>/dev/null | grep -q 'ok: 1'; then
    echo "✅ MongoDB は正常稼働中です (Ping 応答 OK)"
    mongosh --port "${PORT}" --host "${BIND_IP}" --eval "db.adminCommand('listDatabases')" --quiet 2>/dev/null
    exit 0
  fi
fi

if pgrep -f "mongod" >/dev/null 2>&1; then
  echo "⚠️ mongod プロセスは存在しますが、ポート ${PORT} で応答が確認できません。"
  ps aux | grep "[m]ongod"
else
  echo "⏹️ MongoDB は停止しています。"
fi
