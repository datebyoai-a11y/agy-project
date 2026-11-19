#!/bin/bash
# ==============================================================================
# 🔌 交雄会だて病院 医療統合システム 有線LAN固定 / DHCP 自動切替スクリプト
#
# 動作仕様:
#   wired : 有線LAN (enp0s31f6) を 192.168.20.221/24 (GW: 192.168.20.254 / never-default)
#           に固定し、医療統合ポータルを 192.168.20.221:80 (+ 127.0.0.1:80) で待ち受ける。
#   dhcp  : 有線LANプロファイルを DHCP (auto) に戻し、現在の DHCP IP:80 (+ 127.0.0.1:80)
#           で待ち受けるよう戻す。
#   auto  : 有線LANの物理リンク状態 (carrier) に応じて wired / dhcp を自動実行。
#   status: 現在のネットワーク・待ち受け・ファイアウォール状態を表示。
#
# 使い方:
#   sudo bash scripts/lan-mode-switch.sh [wired|dhcp|auto|status]
# ==============================================================================
set -euo pipefail

WIRED_IFACE="${WIRED_IFACE:-enp0s31f6}"
WIRED_CON_UUID="${WIRED_CON_UUID:-d43b5032-facd-33dc-93b9-0793bce07a3a}"
WIRED_IP="${WIRED_IP:-192.168.20.221}"
WIRED_PREFIX="${WIRED_PREFIX:-24}"
WIRED_GW="${WIRED_GW:-192.168.20.254}"
PORTAL_PORT="${PORT:-80}"

APP_USER="${APP_USER:-a}"
PROJECT_DIR="${PROJECT_DIR:-/home/a/src/github.com/datebyoai-a11y/agy-project}"
ENV_FILE="${PROJECT_DIR}/.lan-bind.env"
LOCK_FILE="/tmp/agy-lan-mode-switch.lock"

if [ "$(id -u)" -eq 0 ]; then
  LOG_FILE="/var/log/agy-lan-switch.log"
else
  mkdir -p "${PROJECT_DIR}/logs"
  LOG_FILE="${PROJECT_DIR}/logs/lan-switch.log"
fi

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

resolve_wired_connection() {
  if nmcli -t -f UUID con show 2>/dev/null | grep -Fxq "$WIRED_CON_UUID"; then
    echo "$WIRED_CON_UUID"
    return 0
  fi
  local found
  found=$(nmcli -t -f UUID,TYPE,DEVICE con show 2>/dev/null | awk -F: -v dev="$WIRED_IFACE" '$2=="802-3-ethernet" && ($3==dev || $3=="") {print $1; exit}')
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi
  return 1
}

get_iface_ip() {
  local iface="$1"
  ip -4 -o addr show dev "$iface" scope global 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4; exit}'
}

get_dhcp_fallback_info() {
  # Wi-Fi (wl*) を最優先、次に有線・tailscale以外のグローバルIPv4を検索
  local line iface ipaddr
  line=$(ip -4 -o addr show scope global 2>/dev/null | awk -v w="$WIRED_IFACE" '$2 != w && $2 ~ /^wl/ {sub(/\/.*/, "", $4); print $2, $4; exit}')
  if [ -z "$line" ]; then
    line=$(ip -4 -o addr show scope global 2>/dev/null | awk -v w="$WIRED_IFACE" '$2 != w && $2 !~ /^tailscale/ {sub(/\/.*/, "", $4); print $2, $4; exit}')
  fi
  if [ -n "$line" ]; then
    iface=$(echo "$line" | awk '{print $1}')
    ipaddr=$(echo "$line" | awk '{print $2}')
    echo "${iface} ${ipaddr}"
  else
    echo "lo 127.0.0.1"
  fi
}

is_bound_on() {
  local target_ip="$1"
  ss -tlnH "sport = :${PORTAL_PORT}" 2>/dev/null | awk '{print $4}' | grep -Fxq "${target_ip}:${PORTAL_PORT}"
}

write_bind_env() {
  local mode="$1"
  local iface="$2"
  local bind_host="$3"
  cat > "$ENV_FILE" <<EOF
MODE=${mode}
IFACE=${iface}
BIND_HOST=${bind_host}
PORT=${PORTAL_PORT}
UPDATED_AT=$(date '+%Y-%m-%dT%H:%M:%S%z')
EOF
  if [ "$(id -u)" -eq 0 ]; then
    chown "${APP_USER}:${APP_USER}" "$ENV_FILE" 2>/dev/null || true
  fi
}

restart_portal_server() {
  local mode="$1"
  local bind_host="$2"

  log "🔄 医療統合システムを ${bind_host}:${PORTAL_PORT} (+ 127.0.0.1:${PORTAL_PORT}) [mode=${mode}] で再起動します..."
  if [ "$(id -u)" -eq 0 ]; then
    su - "$APP_USER" -c "cd '${PROJECT_DIR}' && HOST='${bind_host}' LAN_MODE='${mode}' PORT='${PORTAL_PORT}' ./start.sh restart" >> "$LOG_FILE" 2>&1
  else
    (cd "$PROJECT_DIR" && HOST="$bind_host" LAN_MODE="$mode" PORT="$PORTAL_PORT" ./start.sh restart) >> "$LOG_FILE" 2>&1
  fi
  log "✅ サーバー再起動完了: http://${bind_host}/login (Port ${PORTAL_PORT})"
}

switch_to_wired() {
  local con_id
  con_id=$(resolve_wired_connection) || {
    log "❌ 有線LANの NetworkManager プロファイルが見つかりません (${WIRED_IFACE})。"
    exit 1
  }

  local current_method current_addrs current_never_def current_ip
  current_method=$(nmcli -g ipv4.method con show "$con_id" 2>/dev/null || echo "")
  current_addrs=$(nmcli -g ipv4.addresses con show "$con_id" 2>/dev/null || echo "")
  current_never_def=$(nmcli -g ipv4.never-default con show "$con_id" 2>/dev/null || echo "")
  current_ip=$(get_iface_ip "$WIRED_IFACE" || true)

  if [ "$current_method" != "manual" ] || [ "$current_addrs" != "${WIRED_IP}/${WIRED_PREFIX}" ] || [ "$current_never_def" != "yes" ] || [ "$current_ip" != "$WIRED_IP" ]; then
    log "🔌 有線LAN (${WIRED_IFACE}) を固定IP ${WIRED_IP}/${WIRED_PREFIX} (GW: ${WIRED_GW}, デフォルトルート無効) へ設定します..."
    nmcli con mod "$con_id" \
      connection.interface-name "$WIRED_IFACE" \
      ipv4.method manual \
      ipv4.addresses "${WIRED_IP}/${WIRED_PREFIX}" \
      ipv4.gateway "$WIRED_GW" \
      ipv4.never-default yes \
      ipv4.ignore-auto-routes yes \
      ipv4.ignore-auto-dns yes \
      ipv6.method ignore

    nmcli con up "$con_id" >> "$LOG_FILE" 2>&1 || true

    # IP 反映を最大5秒待機
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      current_ip=$(get_iface_ip "$WIRED_IFACE" || true)
      if [ "$current_ip" = "$WIRED_IP" ]; then
        break
      fi
      sleep 0.5
    done
  fi

  # 念のためゲートウェイ経由のデフォルトルートが残っていれば明示的に削除
  ip route del default via "$WIRED_GW" dev "$WIRED_IFACE" 2>/dev/null || true

  if [ "$current_ip" != "$WIRED_IP" ]; then
    log "⚠️ ${WIRED_IFACE} に ${WIRED_IP} がまだ割り当たっていません (現在: ${current_ip:-なし})。"
    exit 1
  fi

  write_bind_env "wired" "$WIRED_IFACE" "$WIRED_IP"

  if is_bound_on "$WIRED_IP" && is_bound_on "127.0.0.1"; then
    log "✅ すでに ${WIRED_IP}:${PORTAL_PORT} (+ 127.0.0.1:${PORTAL_PORT}) で待ち受け済みのため再起動をスキップします。"
  else
    restart_portal_server "wired" "$WIRED_IP"
  fi
}

switch_to_dhcp() {
  local con_id
  if con_id=$(resolve_wired_connection); then
    local current_method
    current_method=$(nmcli -g ipv4.method con show "$con_id" 2>/dev/null || echo "")
    if [ "$current_method" != "auto" ]; then
      log "🔓 有線LANプロファイル (${con_id}) を DHCP (auto) 設定へ戻します..."
      nmcli con mod "$con_id" \
        ipv4.method auto \
        ipv4.addresses "" \
        ipv4.gateway "" \
        ipv4.never-default no \
        ipv4.ignore-auto-routes no \
        ipv4.ignore-auto-dns no \
        ipv6.method auto
    fi
  fi

  # 有線切断直後は Wi-Fi 等のルート安定までわずかに待つ
  local fallback_info fallback_iface fallback_ip
  for _ in 1 2 3 4 5; do
    fallback_info=$(get_dhcp_fallback_info)
    fallback_iface=$(echo "$fallback_info" | awk '{print $1}')
    fallback_ip=$(echo "$fallback_info" | awk '{print $2}')
    if [ "$fallback_ip" != "127.0.0.1" ]; then
      break
    fi
    sleep 1
  done

  write_bind_env "dhcp" "$fallback_iface" "$fallback_ip"

  # 既に目的の DHCP IP で待ち受け済みかつ旧有線固定IPが残っていなければスキップ
  if is_bound_on "$fallback_ip" && ! is_bound_on "$WIRED_IP"; then
    log "✅ すでに DHCP アドレス ${fallback_ip}:${PORTAL_PORT} (${fallback_iface}) で待ち受け済みのため再起動をスキップします。"
  else
    restart_portal_server "dhcp" "$fallback_ip"
  fi
}

switch_auto() {
  local carrier="0"
  if [ -r "/sys/class/net/${WIRED_IFACE}/carrier" ]; then
    carrier=$(cat "/sys/class/net/${WIRED_IFACE}/carrier" 2>/dev/null || echo "0")
  fi
  if [ "$carrier" = "1" ]; then
    log "🔎 自動判定: ${WIRED_IFACE} のリンクを検出 (carrier=1) -> 有線固定モードへ切替"
    switch_to_wired
  else
    log "🔎 自動判定: ${WIRED_IFACE} は未接続 (carrier=${carrier}) -> DHCP モードへ切替"
    switch_to_dhcp
  fi
}

show_status() {
  local carrier="0"
  if [ -r "/sys/class/net/${WIRED_IFACE}/carrier" ]; then
    carrier=$(cat "/sys/class/net/${WIRED_IFACE}/carrier" 2>/dev/null || echo "0")
  fi
  local wired_ip con_id nm_method nm_addrs bound_addrs
  wired_ip=$(get_iface_ip "$WIRED_IFACE" || true)
  con_id=$(resolve_wired_connection || true)
  nm_method=$( [ -n "$con_id" ] && nmcli -g ipv4.method con show "$con_id" 2>/dev/null || echo "unknown" )
  nm_addrs=$( [ -n "$con_id" ] && nmcli -g ipv4.addresses con show "$con_id" 2>/dev/null || echo "" )
  bound_addrs=$(ss -tlnH "sport = :${PORTAL_PORT}" 2>/dev/null | awk '{print $4}' | tr '\n' ' ' | sed 's/ $//')

  echo "================================================================"
  echo "🔌 有線LAN / DHCP 自動切替ステータス"
  echo "----------------------------------------------------------------"
  echo "  有線インターフェース : ${WIRED_IFACE} (carrier=${carrier})"
  echo "  有線IP (現在)        : ${wired_ip:-未割当}"
  echo "  NMプロファイル設定   : ipv4.method=${nm_method} / addresses=${nm_addrs:-DHCP}"
  echo "  Port ${PORTAL_PORT} 待ち受け     : ${bound_addrs:-停止中}"
  if [ -f "$ENV_FILE" ]; then
    echo "  最終適用モード       : $(grep '^MODE=' "$ENV_FILE" | cut -d= -f2) ($(grep '^BIND_HOST=' "$ENV_FILE" | cut -d= -f2))"
  fi
  echo "================================================================"
}

ACTION="${1:-auto}"

if [ "$ACTION" = "status" ]; then
  show_status
  exit 0
fi

# 多重実行防止 (flock)
exec 9>"$LOCK_FILE"
if ! flock -w 30 9; then
  log "⚠️ 別の切替処理が実行中のためタイムアウトしました。"
  exit 1
fi

case "$ACTION" in
  wired)
    switch_to_wired
    ;;
  dhcp)
    switch_to_dhcp
    ;;
  auto)
    switch_auto
    ;;
  *)
    echo "使い方: $0 {wired|dhcp|auto|status}" >&2
    exit 1
    ;;
esac
