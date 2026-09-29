#!/usr/bin/env bash
# ==============================================================================
# ClamAV (アンチウイルス) 自動インストール & 初期設定スクリプト
# 対象: Linux Mint / Ubuntu (noble)
# ==============================================================================
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}エラー: このスクリプトは sudo (root権限) で実行してください。${NC}"
  echo "実行例: sudo bash $0"
  exit 1
fi

echo -e "${BLUE}=====================================================${NC}"
echo -e "${BLUE}🛡️  ClamAV インストール & 初期セットアップを開始します${NC}"
echo -e "${BLUE}=====================================================${NC}"

# 1. パッケージ更新 & インストール
echo -e "\n${YELLOW}[1/4] APT パッケージ情報を更新中...${NC}"
apt-get update

echo -e "\n${YELLOW}[2/4] ClamAV および ClamAV Daemon をインストール中...${NC}"
DEBIAN_FRONTEND=noninteractive apt-get install -y clamav clamav-daemon

# 2. 定義ファイルの最新化
echo -e "\n${YELLOW}[3/4] ウイルス定義データベース (freshclam) の初期更新中...${NC}"
# freshclam サービスが動いているとロックされるため一時停止
systemctl stop clamav-freshclam 2>/dev/null || true

echo "freshclam を実行して最新のウイルスシグネチャをダウンロードします (数分かかる場合があります)..."
freshclam || true

systemctl start clamav-freshclam
systemctl enable clamav-freshclam

# 3. ClamAV Daemon サービスの有効化 & 起動
echo -e "\n${YELLOW}[4/4] ClamAV Daemon サービスを起動中...${NC}"
systemctl enable clamav-daemon
systemctl restart clamav-daemon

echo -e "\n${GREEN}=====================================================${NC}"
echo -e "${GREEN}✅ ClamAV のインストールと初期設定が正常に完了しました！${NC}"
echo -e "${GREEN}=====================================================${NC}"

echo -e "\n【バージョン確認】"
clamscan -V || true
freshclam -V || true

echo -e "\n【サービス稼働ステータス】"
systemctl is-active clamav-daemon && echo "clamav-daemon: 稼働中 (active)" || echo "clamav-daemon: 停止中"
systemctl is-active clamav-freshclam && echo "clamav-freshclam: 稼働中 (active)" || echo "clamav-freshclam: 停止中"

echo -e "\n【便利な使い方】"
echo "  1. 特定ディレクトリのスキャン (例: プロジェクト):"
echo "     clamscan -r -i /home/a/Desktop/ai/agy-project"
echo "  2. 感染ファイルのみ表示してホーム全体をスキャン:"
echo "     clamscan -r -i /home/a"
echo "  3. ウイルス定義ファイルの即時更新:"
echo "     sudo freshclam"
echo ""
