#!/bin/bash
# ==============================================================================
# MongoDB 停止スクリプト (Linux Mint / Ubuntu / Debian 用)
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

echo "🍃 MongoDB (ポート: ${PORT}) を停止しています..."

# 1. mongosh による安全なシャットダウン
if command -v mongosh >/dev/null 2>&1; then
  # shutdownServerを実行（切断により終了コードが非ゼロになる場合があるため無視して事後確認）
  mongosh --port "${PORT}" --host "${BIND_IP}" admin --eval "db.shutdownServer()" >/dev/null 2>&1 || true
  sleep 1
  if ! mongosh --port "${PORT}" --host "${BIND_IP}" --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
    echo "✅ MongoDB を正常に停止しました。"
    exit 0
  fi
fi

# 2. mongosh がない場合、または応答しない場合: プロセス検索で安全停止
PID=$(pgrep -f "mongod.*${SCRIPT_DIR}" || true)
if [ -n "${PID}" ]; then
  kill "${PID}" 2>/dev/null || true
  sleep 1
  if kill -0 "${PID}" 2>/dev/null; then
    sleep 2
    kill -9 "${PID}" 2>/dev/null || true
  fi
  echo "✅ PID: ${PID} の MongoDB プロセスを停止しました。"
  exit 0
fi

echo "⚠️ 停止対象の MongoDB プロセスが見つかりませんでした（既に停止している可能性があります）。"
