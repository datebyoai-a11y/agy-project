#!/bin/bash
# ==============================================================================
# MongoDB 起動スクリプト (Linux Mint / Ubuntu / Debian 用)
# ==============================================================================
set -e

# スクリプト自身のディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 設定ファイル (config.env) の読み込み
CONFIG_FILE="${SCRIPT_DIR}/config.env"
if [ -f "${CONFIG_FILE}" ]; then
  # コメントや余計な改行を除いて環境変数として読み込み
  set -a
  source "${CONFIG_FILE}"
  set +a
fi

# 1. mongod 実行パスの解決
if [ -z "${MONGOD_PATH}" ]; then
  if command -v mongod >/dev/null 2>&1; then
    MONGOD_PATH="$(command -v mongod)"
  elif [ -x "/usr/bin/mongod" ]; then
    MONGOD_PATH="/usr/bin/mongod"
  elif [ -x "/usr/local/bin/mongod" ]; then
    MONGOD_PATH="/usr/local/bin/mongod"
  else
    echo "【エラー】mongod コマンドが見つかりませんでした。"
    echo "config.env の MONGOD_PATH に mongod の絶対パスを指定してください。"
    exit 1
  fi
fi

if [ ! -x "${MONGOD_PATH}" ]; then
  echo "【エラー】指定された mongod が実行可能ではありません: ${MONGOD_PATH}"
  exit 1
fi

# 2. データ保存先ディレクトリ (dbPath) の解決
if [ -z "${DATA_PATH}" ]; then
  DATA_PATH="${SCRIPT_DIR}/data"
else
  # 相対パスの場合はスクリプト配置ディレクトリ基準に変換
  if [[ "${DATA_PATH}" != /* ]]; then
    DATA_PATH="${SCRIPT_DIR}/${DATA_PATH}"
  fi
fi
mkdir -p "${DATA_PATH}"

# 3. ログファイルパスの解決
if [ -z "${LOG_PATH}" ]; then
  LOG_PATH="${DATA_PATH}/mongod.log"
else
  if [[ "${LOG_PATH}" != /* ]]; then
    LOG_PATH="${SCRIPT_DIR}/${LOG_PATH}"
  fi
fi
mkdir -p "$(dirname "${LOG_PATH}")"

# 4. ポート・バインドIP
PORT="${PORT:-27017}"
BIND_IP="${BIND_IP:-127.0.0.1}"

# 5. mongodb.conf の自動生成 / 更新
CONF_FILE="${SCRIPT_DIR}/mongodb.conf"
cat <<EOF > "${CONF_FILE}"
# 自動生成された MongoDB 設定ファイル
storage:
  dbPath: ${DATA_PATH}

systemLog:
  destination: file
  logAppend: true
  path: ${LOG_PATH}

net:
  port: ${PORT}
  bindIp: ${BIND_IP}

processManagement:
  timeZoneInfo: /usr/share/zoneinfo
EOF

echo "======================================================"
echo "🍃 MongoDB 起動準備 (Linux)"
echo "------------------------------------------------------"
echo "mongod パス : ${MONGOD_PATH}"
echo "データ保存先: ${DATA_PATH}"
echo "ログ出力先  : ${LOG_PATH}"
echo "接続ポート  : ${PORT} (IP: ${BIND_IP})"
echo "設定ファイル: ${CONF_FILE}"
echo "======================================================"

# Ubuntu 24.04 / GLIBC 互換設定
export GLIBC_TUNABLES="glibc.pthread.rseq=1"

# 引数で --foreground が指定された場合はフォアグラウンド実行（systemd用）
if [ "$1" = "--foreground" ]; then
  exec "${MONGOD_PATH}" --config "${CONF_FILE}"
fi

# すでにポートが使用中か確認
if command -v lsof >/dev/null 2>&1 && lsof -i :"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️ ポート ${PORT} は既に使用されています。既に起動している可能性があります。"
  echo "状態確認: ./status_mongodb.sh または mongosh --port ${PORT}"
  exit 0
fi

# バックグラウンド起動 (fork)
"${MONGOD_PATH}" --config "${CONF_FILE}" --fork

echo "✅ MongoDB のバックグラウンド起動が完了しました。"
echo "停止コマンド: ./stop_mongodb.sh"
