#!/bin/bash
# ==============================================================================
# 📦 ログ日次ローテーション＆.gz圧縮スクリプト (rotate-logs.sh)
# 
# 使い方:
#   ./scripts/rotate-logs.sh           : 前日以前のログを自動的に .gz 圧縮
#   ./scripts/rotate-logs.sh --force   : 当日分も含めて即時 .gz 圧縮
#   ./scripts/rotate-logs.sh --help    : ヘルプ表示
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR" || exit 1

node "$SCRIPT_DIR/rotate-logs.js" "$@"
