#!/usr/bin/env bash
# ==============================================================================
# SSH ポート 50022 設定 & UFW ファイアウォール許可スクリプト
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

echo -e "${BLUE}=====================================================${NC}"
echo -e "${BLUE}🔑 SSHポートを 50022 に変更 & UFW 開放設定を開始します${NC}"
echo -e "${BLUE}=====================================================${NC}"

# 1. SSH 設定ファイルを作成 (sshd_config.d)
echo -e "\n${YELLOW}[1/4] /etc/ssh/sshd_config.d/50-port50022.conf を設定中...${NC}"
cat << 'EOF' > /etc/ssh/sshd_config.d/50-port50022.conf
# SSH Listen Port 50022 (IPv4 & IPv6)
Port 50022
EOF
chmod 644 /etc/ssh/sshd_config.d/50-port50022.conf

# 2. systemd socket 設定 (IPv4 と IPv6 の両方を明示してバインド)
echo -e "\n${YELLOW}[2/4] /etc/systemd/system/ssh.socket.d/listen.conf を設定中...${NC}"
mkdir -p /etc/systemd/system/ssh.socket.d
cat << 'EOF' > /etc/systemd/system/ssh.socket.d/listen.conf
[Socket]
ListenStream=
ListenStream=0.0.0.0:50022
ListenStream=[::]:50022
EOF

# 3. systemd 再読み込み & SSH 再起動
echo -e "\n${YELLOW}[3/4] systemd を再読み込みし、SSH サービスを再起動中...${NC}"
systemctl daemon-reload
systemctl restart ssh.socket || true
systemctl restart ssh.service || systemctl restart sshd.service

# 4. UFW ファイアウォールで 50022/tcp を開放
echo -e "\n${YELLOW}[4/4] UFW で 50022/tcp を開放中...${NC}"
ufw allow 50022/tcp comment 'SSH Port 50022'
ufw reload

echo -e "\n${GREEN}=====================================================${NC}"
echo -e "${GREEN}✅ 50022番ポートのSSH設定 & UFW開放が正常に完了しました！${NC}"
echo -e "${GREEN}=====================================================${NC}"

echo -e "\n【SSH 待機状態 (ポート 50022 - IPv4 & IPv6) 確認】"
ss -tulpn | grep 50022 || true

echo -e "\n【UFW ステータス確認】"
ufw status verbose | grep -E "50022|Status" || true

echo -e "\n【接続テスト用コマンド例】"
echo "  同一LAN内から接続 (IPv4):"
echo "    ssh -p 50022 a@192.168.0.203"
echo "  Tailscaleネットワークから接続:"
echo "    ssh -p 50022 a@100.125.124.23"
echo ""
