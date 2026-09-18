#!/bin/bash
# ==============================================================================
# MongoDB 一括エクスポート/バックアップスクリプト (Linux Mint / Ubuntu 用)
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

echo "=== MongoDB エクスポート開始 (ポート: ${PORT}) ==="
mkdir -p "${DUMP_DIR}"
mongodump --host "${BIND_IP}" --port "${PORT}" --out "${DUMP_DIR}"
echo "=== MongoDB エクスポート完了: ${DUMP_DIR} ==="
