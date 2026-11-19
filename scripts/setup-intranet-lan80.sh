#!/bin/bash
# ==============================================================================
# 🛠️ 交雄会だて病院 院内イントラネット (Port 80 + 有線LAN自動切替 + FW) 一括セットアップ
#
# 使い方 (root / sudo で 1 回実行):
#   sudo bash /home/a/src/github.com/datebyoai-a11y/agy-project/scripts/setup-intranet-lan80.sh
#
# 実施内容:
#   1. Node.js バイナリへ Port 80 バインド権限 (cap_net_bind_service) を付与
#   2. 外部公開トンネル (cloudflared / trycloudflare) を停止・自動起動無効化
#   3. UFW ファイアウォールを有線同一セグメント限定 (GW 192.168.20.254 ブロック) に設定
#   4. NetworkManager dispatcher + 物理リンク監視 (agy-lan-watch.service) を登録・起動
#   5. 現在のLAN状態に合わせてサーバーを Port 80 で起動・検証
# ==============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ このスクリプトは sudo (root 権限) で実行してください。" >&2
  echo "   例: sudo bash $0" >&2
  exit 1
fi

PROJECT_DIR="/home/a/src/github.com/datebyoai-a11y/agy-project"
SCRIPTS_DIR="${PROJECT_DIR}/scripts"
WIRED_IFACE="enp0s31f6"
WIFI_IFACE="wlp1s0"
WIRED_IP="192.168.20.221"
WIRED_SUBNET="192.168.20.0/24"
WIRED_GW="192.168.20.254"

echo "================================================================"
echo "🏥 院内イントラネット Port 80 & 有線LAN自動切替 セットアップ開始"
echo "================================================================"

# ------------------------------------------------------------------------------
# 1. Node.js へ Port 80 バインド権限 (CAP_NET_BIND_SERVICE) を付与
# ------------------------------------------------------------------------------
NODE_BIN=$(readlink -f "$(command -v node || echo /usr/local/bin/node)")
if [ ! -x "$NODE_BIN" ]; then
  echo "❌ node バイナリが見つかりません。" >&2
  exit 1
fi
echo ""
echo "🔑 [1/5] Node.js (${NODE_BIN}) へ Port 80 バインド権限を付与します..."
setcap 'cap_net_bind_service=+ep' "$NODE_BIN"
getcap "$NODE_BIN"

# ------------------------------------------------------------------------------
# 2. Cloudflare 外部公開トンネルを停止・無効化
# ------------------------------------------------------------------------------
echo ""
echo "🛑 [2/5] 外部公開トンネル (cloudflared / trycloudflare) を停止・無効化します..."
for svc in cloudflared.service trycloudflare.service; do
  if systemctl list-unit-files "$svc" --no-legend 2>/dev/null | grep -q "$svc"; then
    systemctl disable --now "$svc" 2>/dev/null || true
    echo "   ・${svc}: disabled / stopped"
  fi
done

# ------------------------------------------------------------------------------
# 3. UFW ファイアウォール設定（有線LANは同一セグメント限定・GW 192.168.20.254 遮断）
# ------------------------------------------------------------------------------
echo ""
echo "🛡️  [3/5] UFW ファイアウォールを設定します..."
if ! command -v ufw >/dev/null 2>&1; then
  echo "⚠️ ufw がインストールされていないためファイアウォール設定をスキップします。"
else
  # SSH 締出し防止のため現行 SSH ポート (50022/tcp) を確実に許可
  ufw allow 50022/tcp comment 'ssh-port-50022' >/dev/null 2>&1 || true

  # 既存の agy-* ルールのみ降順で削除（冪等性確保）
  OLD_NUMS=$(ufw status numbered 2>/dev/null | sed -n 's/^\[\s*\([0-9]\+\)\].*agy-.*/\1/p' | sort -rn || true)
  if [ -n "$OLD_NUMS" ]; then
    for num in $OLD_NUMS; do
      yes | ufw delete "$num" >/dev/null 2>&1 || true
    done
  fi

  # 有線LAN (enp0s31f6) 送信ルール (insert 1 で逆順挿入 -> 上から順に評価):
  #   1) ゲートウェイ (192.168.20.254) 宛パケットをブロック
  #   2) 同一セグメント (192.168.20.0/24) 内のみ送信許可
  #   3) セグメント外 (0.0.0.0/0) への送信をすべてブロック
  ufw insert 1 deny out on "$WIRED_IFACE" to 0.0.0.0/0 comment 'agy-wired-block-other-out' >/dev/null
  ufw insert 1 allow out on "$WIRED_IFACE" to "$WIRED_SUBNET" comment 'agy-wired-allow-lan-out' >/dev/null
  ufw insert 1 deny out on "$WIRED_IFACE" to "$WIRED_GW" comment 'agy-wired-block-gw-out' >/dev/null

  # 有線LAN (enp0s31f6) 受信ルール (insert 1 で逆順挿入 -> 上から順に評価):
  #   1) ゲートウェイ (192.168.20.254) からのパケットをブロック
  #   2) 同一セグメント内から 192.168.20.221:80 (HTTP) のみ受信許可
  #   3) 有線からのその他すべての受信をブロック
  ufw insert 1 deny in on "$WIRED_IFACE" from 0.0.0.0/0 comment 'agy-wired-block-other-in' >/dev/null
  ufw insert 1 allow in on "$WIRED_IFACE" from "$WIRED_SUBNET" to "$WIRED_IP" port 80 proto tcp comment 'agy-wired-allow-http80' >/dev/null
  ufw insert 1 deny in on "$WIRED_IFACE" from "$WIRED_GW" comment 'agy-wired-block-gw-in' >/dev/null

  # 無線LAN (wlp1s0 / DHCP モード時) の Port 80 受信許可
  ufw allow in on "$WIFI_IFACE" to 0.0.0.0/0 port 80 proto tcp comment 'agy-wifi-allow-http80' >/dev/null

  ufw --force enable >/dev/null
  ufw reload >/dev/null
  echo "✅ UFW ルール適用完了:"
  ufw status numbered
fi

# ------------------------------------------------------------------------------
# 4. NetworkManager Dispatcher & 物理リンク監視 systemd サービス登録
# ------------------------------------------------------------------------------
echo ""
echo "🔌 [4/5] 有線LAN抜き差し自動切替フックと監視サービスを登録します..."
chmod 755 "${SCRIPTS_DIR}/lan-mode-switch.sh" "${SCRIPTS_DIR}/lan-link-watcher.sh" "${SCRIPTS_DIR}/99-agy-lan-switch"

install -m 755 -o root -g root "${SCRIPTS_DIR}/99-agy-lan-switch" /etc/NetworkManager/dispatcher.d/99-agy-lan-switch
systemctl enable --now NetworkManager-dispatcher.service >/dev/null 2>&1 || true

cat > /etc/systemd/system/agy-lan-watch.service <<EOF
[Unit]
Description=Koyukai Hospital Wired LAN (192.168.20.221) / DHCP Auto Switch Watcher
After=network-online.target NetworkManager.service mongod.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash ${SCRIPTS_DIR}/lan-link-watcher.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable agy-lan-watch.service

# ------------------------------------------------------------------------------
# 5. 現在のLAN状態に合わせて初回切替 & サーバー Port 80 起動
# ------------------------------------------------------------------------------
echo ""
echo "🚀 [5/5] 現在のLAN状態に合わせて切替＆サーバー起動を実行します..."
systemctl restart agy-lan-watch.service
sleep 4

"${SCRIPTS_DIR}/lan-mode-switch.sh" status
echo ""
echo "================================================================"
echo "✅ すべてのセットアップが完了しました！"
echo "   ・有線LAN接続時 : 192.168.20.221/24 固定 (GW ${WIRED_GW} 遮断) -> http://192.168.20.221/login"
echo "   ・有線LAN切断時 : DHCP へ自動復帰 -> http://<DHCP-IP>/login"
echo "   ・ローカル操作  : http://localhost/login"
echo "   ・切替ログ確認  : tail -f /var/log/agy-lan-switch.log"
echo "================================================================"
