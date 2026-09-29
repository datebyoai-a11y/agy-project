#!/usr/bin/env bash
# ==============================================================================
# SSH パスワードログイン禁止（公開鍵認証必須化）スクリプト
# 対象: Linux Mint 22 / Ubuntu 24.04 (Noble)
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

TARGET_USER="${SUDO_USER:-a}"
USER_HOME=$(eval echo "~$TARGET_USER")
AUTH_KEYS="$USER_HOME/.ssh/authorized_keys"

echo -e "${BLUE}=====================================================${NC}"
echo -e "${BLUE}🔒 SSH パスワードログインの禁止（公開鍵認証限定）設定${NC}"
echo -e "${BLUE}=====================================================${NC}"

# 公開鍵登録の確認
if [ ! -s "$AUTH_KEYS" ]; then
  echo -e "\n${YELLOW}⚠️  警告: $AUTH_KEYS に公開鍵がまだ登録されていません！${NC}"
  echo "このままパスワード認証を切ると、外部からSSHログインできなくなる恐れがあります。"
  echo "接続元PCから以下のコマンド等で公開鍵を登録済みかご確認ください："
  echo "  ssh-copy-id -p 50022 $TARGET_USER@<このホストのIP>"
  echo ""
fi

# 1. パスワード認証無効化設定を作成
echo -e "${YELLOW}[1/3] /etc/ssh/sshd_config.d/60-disable-password.conf を作成中...${NC}"
cat << 'EOF' > /etc/ssh/sshd_config.d/60-disable-password.conf
# SSH パスワード認証の禁止
PasswordAuthentication no
KbdInteractiveAuthentication no

# 公開鍵認証の有効化
PubkeyAuthentication yes
EOF
chmod 644 /etc/ssh/sshd_config.d/60-disable-password.conf

# 2. 設定の構文チェック
echo -e "${YELLOW}[2/3] sshd 構文チェックを実行中...${NC}"
sshd -t

# 3. SSH サービス再起動
echo -e "${YELLOW}[3/3] SSH サービスを再起動中...${NC}"
systemctl daemon-reload
systemctl restart ssh.service || systemctl restart sshd.service

echo -e "\n${GREEN}=====================================================${NC}"
echo -e "${GREEN}✅ SSH パスワードログインの禁止設定が完了しました！${NC}"
echo -e "${GREEN}=====================================================${NC}"

echo -e "\n【適用された設定】"
echo "  • PasswordAuthentication: no (パスワード認証拒否)"
echo "  • KbdInteractiveAuthentication: no (キーボード対話式認証拒否)"
echo "  • PubkeyAuthentication: yes (公開鍵認証のみ許可)"
echo ""
