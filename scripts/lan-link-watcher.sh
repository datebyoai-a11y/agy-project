#!/bin/bash
# ==============================================================================
# 👀 有線LAN (enp0s31f6) 物理リンク監視ウォッチャー (agy-lan-watch.service 用)
#
# `ip monitor link dev enp0s31f6` でカーネルの netlink イベントを待機 (CPU負荷 0%)。
# ケーブルの抜き差し (carrier 0 <-> 1) を検知した瞬間に lan-mode-switch.sh を実行する。
# ==============================================================================
set -u

WIRED_IFACE="${WIRED_IFACE:-enp0s31f6}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCH_SCRIPT="${SCRIPT_DIR}/lan-mode-switch.sh"

read_carrier() {
  if [ -r "/sys/class/net/${WIRED_IFACE}/carrier" ]; then
    cat "/sys/class/net/${WIRED_IFACE}/carrier" 2>/dev/null || echo "0"
  else
    echo "0"
  fi
}

# 起動時に現在の物理リンク状態に合わせて一度同期
LAST_CARRIER=$(read_carrier)
"$SWITCH_SCRIPT" auto || true

# 物理リンク状態の変化のみイベント駆動で監視
ip monitor link dev "$WIRED_IFACE" 2>/dev/null | while IFS= read -r _; do
  CUR_CARRIER=$(read_carrier)
  if [ "$CUR_CARRIER" != "$LAST_CARRIER" ]; then
    LAST_CARRIER="$CUR_CARRIER"
    if [ "$CUR_CARRIER" = "1" ]; then
      # ケーブル挿抜のチャタリング吸収のため 0.5 秒待機
      sleep 0.5
      if [ "$(read_carrier)" = "1" ]; then
        "$SWITCH_SCRIPT" wired || true
      fi
    else
      sleep 0.5
      if [ "$(read_carrier)" = "0" ]; then
        "$SWITCH_SCRIPT" dhcp || true
      fi
    fi
  fi
done
