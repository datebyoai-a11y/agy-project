#!/bin/bash
# ==============================================================================
# 📊 MongoDB レプリカセット (二重化) ステータス確認ツール (mongo-rs-status.sh)
# ==============================================================================

echo "================================================================"
echo "📊 MongoDB レプリカセット (rs0) 稼働ステータス"
echo "================================================================"

mongosh --port 27017 --quiet --eval '
try {
  const s = rs.status();
  print("🏷️  レプリカセット名: " + s.set);
  print("⏱️  現在時刻: " + new Date().toLocaleString("ja-JP"));
  print("----------------------------------------------------------------");
  print("🖥️  ノード一覧:");
  
  s.members.forEach(m => {
    let icon = "⚪";
    if (m.stateStr === "PRIMARY") icon = "🥇 [PRIMARY  / プライマリ]";
    else if (m.stateStr === "SECONDARY") icon = "🥈 [SECONDARY / セカンダリ]";
    else if (m.stateStr === "ARBITER") icon = "⚖️  [ARBITER   / 調停ノード]";

    const healthStr = m.health === 1 ? "🟢 正常 (UP)" : "🔴 異常 (DOWN)";
    const syncStr = m.syncSourceHost ? (" (同期元: " + m.syncSourceHost + ")") : "";
    
    print("  " + icon + " " + m.name);
    print("     状態: " + healthStr + syncStr + " / 稼働時間: " + (m.uptime || 0) + "秒");
  });

  print("----------------------------------------------------------------");
  // レプリケーション遅延の確認
  const primary = s.members.find(m => m.stateStr === "PRIMARY");
  const secondary = s.members.find(m => m.stateStr === "SECONDARY");
  if (primary && secondary && primary.optimeDate && secondary.optimeDate) {
    const lagSec = Math.abs((primary.optimeDate.getTime() - secondary.optimeDate.getTime()) / 1000);
    print("⚡ レプリケーション同期遅延 (Replication Lag): " + lagSec + " 秒");
    if (lagSec < 1) {
      print("   ➔ リアルタイム同期中 (リアルタイム完全二重化)");
    }
  }

} catch (err) {
  print("❌ レプリカセット情報の取得に失敗しました: " + err.message);
  print("   ※mongod が起動しているか確認してください。");
}
'

echo "================================================================"
