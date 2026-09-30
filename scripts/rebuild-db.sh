#!/bin/bash
# ==============================================================================
# 🔄 ログからデータベースを再構築するスクリプト (rebuild-db.sh)
# 
# 使い方:
#   ./scripts/rebuild-db.sh             : 通常の復元（差分更新・追加）
#   ./scripts/rebuild-db.sh --dry-run   : シミュレーション（書き込みなし）
#   ./scripts/rebuild-db.sh --drop      : 完全ゼロクリア後にゼロベース復元
#   ./scripts/rebuild-db.sh --help      : オプション一覧
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR" || exit 1

node "$SCRIPT_DIR/rebuild-database.js" "$@"
