#!/bin/bash
# ==============================================================================
# MongoDB 一括インポート/復元スクリプト (Linux Mint / Ubuntu 用)
# ==============================================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
if [ -f "${CONFIG_FILE}" ]; then
  set -a
  source "${CONFIG_FILE}"
  set +a
fi

PORT="${PORT:-27017}"
BIND_IP="${BIND_IP:-127.0.0.1}"
DUMP_DIR="${SCRIPT_DIR}/dump"

if [ ! -d "${DUMP_DIR}" ]; then
  echo "【エラー】復元用ダンプフォルダが見つかりません: ${DUMP_DIR}"
  exit 1
fi

echo "=== MongoDB 復元開始 (ダンプ元: ${DUMP_DIR}) ==="
mongorestore --host "${BIND_IP}" --port "${PORT}" "${DUMP_DIR}"
echo "=== MongoDB 復元完了 ==="
