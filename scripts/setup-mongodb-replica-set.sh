#!/bin/bash
# ==============================================================================
# 🏥 交雄会だて病院 MongoDB レプリカセット (二重化・高可用性 HA) 構築スクリプト
# 
# 構成:
#   ・PRIMARY   : 127.0.0.1:27017 (/var/lib/mongodb)
#   ・SECONDARY : 127.0.0.1:27018 (/var/lib/mongodb-secondary)
#   ・ARBITER   : 127.0.0.1:27019 (/var/lib/mongodb-arbiter)
#   ・レプリカセット名: rs0
# ==============================================================================

set -e

PASSWORD="a"

echo "================================================================"
echo "🔄 MongoDB レプリカセット (Primary / Secondary 二重化) を構築します"
echo "================================================================"

# 1. ディレクトリの作成
echo "[1/7] Secondary および Arbiter 用データディレクトリを作成中..."
echo "$PASSWORD" | sudo -S mkdir -p /var/lib/mongodb-secondary /var/lib/mongodb-arbiter
echo "$PASSWORD" | sudo -S chown -R mongodb:mongodb /var/lib/mongodb-secondary /var/lib/mongodb-arbiter
echo "$PASSWORD" | sudo -S chmod 700 /var/lib/mongodb-secondary /var/lib/mongodb-arbiter

# 2. 設定ファイルのバックアップ & 更新 (Primary: /etc/mongod.conf)
echo "[2/7] Primary 設定 (/etc/mongod.conf) をレプリカセット対応に更新中..."
if [ ! -f /etc/mongod.conf.orig ]; then
  echo "$PASSWORD" | sudo -S cp /etc/mongod.conf /etc/mongod.conf.orig
fi

echo "$PASSWORD" | sudo -S bash -c 'cat << "EOF" > /etc/mongod.conf
# mongod.conf (PRIMARY - Port 27017)
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 1

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  bindIp: 127.0.0.1

processManagement:
  timeZoneInfo: /usr/share/zoneinfo

replication:
  replSetName: "rs0"
EOF'

# 3. Secondary 設定ファイル (/etc/mongod-secondary.conf) の作成
echo "[3/7] Secondary 設定 (/etc/mongod-secondary.conf) を作成中..."
echo "$PASSWORD" | sudo -S bash -c 'cat << "EOF" > /etc/mongod-secondary.conf
# mongod-secondary.conf (SECONDARY - Port 27018)
storage:
  dbPath: /var/lib/mongodb-secondary
  wiredTiger:
    engineConfig:
      cacheSizeGB: 1

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod-secondary.log

net:
  port: 27018
  bindIp: 127.0.0.1

processManagement:
  timeZoneInfo: /usr/share/zoneinfo

replication:
  replSetName: "rs0"
EOF'

# 4. Arbiter 設定ファイル (/etc/mongod-arbiter.conf) の作成
echo "[4/7] Arbiter 設定 (/etc/mongod-arbiter.conf) を作成中..."
echo "$PASSWORD" | sudo -S bash -c 'cat << "EOF" > /etc/mongod-arbiter.conf
# mongod-arbiter.conf (ARBITER - Port 27019)
storage:
  dbPath: /var/lib/mongodb-arbiter
  wiredTiger:
    engineConfig:
      cacheSizeGB: 0.25

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod-arbiter.log

net:
  port: 27019
  bindIp: 127.0.0.1

processManagement:
  timeZoneInfo: /usr/share/zoneinfo

replication:
  replSetName: "rs0"
EOF'

# ログディレクトリの権限確認
echo "$PASSWORD" | sudo -S touch /var/log/mongodb/mongod-secondary.log /var/log/mongodb/mongod-arbiter.log
echo "$PASSWORD" | sudo -S chown mongodb:mongodb /var/log/mongodb/mongod-secondary.log /var/log/mongodb/mongod-arbiter.log

# 5. systemd サービスユニットの作成
echo "[5/7] systemd サービス (mongod-secondary, mongod-arbiter) を登録中..."
echo "$PASSWORD" | sudo -S bash -c 'cat << "EOF" > /etc/systemd/system/mongod-secondary.service
[Unit]
Description=MongoDB Database Server (Secondary Replica Node)
Documentation=https://docs.mongodb.org/manual
After=network-online.target mongod.service
Wants=network-online.target

[Service]
User=mongodb
Group=mongodb
Environment="MONGODB_CONFIG_OVERRIDE_NOFORK=1"
Environment="GLIBC_TUNABLES=glibc.pthread.rseq=1"
ExecStart=/usr/bin/mongod --config /etc/mongod-secondary.conf
RuntimeDirectory=mongodb-secondary
LimitFSIZE=infinity
LimitCPU=infinity
LimitAS=infinity
LimitNOFILE=64000
LimitNPROC=64000
LimitMEMLOCK=infinity
TasksMax=infinity
TasksAccounting=false
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF'

echo "$PASSWORD" | sudo -S bash -c 'cat << "EOF" > /etc/systemd/system/mongod-arbiter.service
[Unit]
Description=MongoDB Database Server (Arbiter Replica Node)
Documentation=https://docs.mongodb.org/manual
After=network-online.target mongod.service
Wants=network-online.target

[Service]
User=mongodb
Group=mongodb
Environment="MONGODB_CONFIG_OVERRIDE_NOFORK=1"
Environment="GLIBC_TUNABLES=glibc.pthread.rseq=1"
ExecStart=/usr/bin/mongod --config /etc/mongod-arbiter.conf
RuntimeDirectory=mongodb-arbiter
LimitFSIZE=infinity
LimitCPU=infinity
LimitAS=infinity
LimitNOFILE=64000
LimitNPROC=64000
LimitMEMLOCK=infinity
TasksMax=infinity
TasksAccounting=false
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF'

# 6. systemd のリロードと各ノードの起動
echo "[6/7] 各 MongoDB ノード (27017, 27018, 27019) を起動中..."
echo "$PASSWORD" | sudo -S systemctl daemon-reload
echo "$PASSWORD" | sudo -S systemctl restart mongod
echo "$PASSWORD" | sudo -S systemctl enable --now mongod-secondary
echo "$PASSWORD" | sudo -S systemctl restart mongod-secondary
echo "$PASSWORD" | sudo -S systemctl enable --now mongod-arbiter
echo "$PASSWORD" | sudo -S systemctl restart mongod-arbiter

sleep 4

# 7. レプリカセット (rs0) の初期化
echo "[7/7] レプリカセット (rs0) のイニシャライズを実行中..."
mongosh --port 27017 --eval '
try {
  const status = rs.status();
  if (status.ok === 1) {
    print("ℹ️ レプリカセットは既に初期化されています。メンバーを確認します。");
  }
} catch (e) {
  print("🌱 新規レプリカセット初期化中...");
  const initResult = rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "127.0.0.1:27017", priority: 2 },
      { _id: 1, host: "127.0.0.1:27018", priority: 1 },
      { _id: 2, host: "127.0.0.1:27019", arbiterOnly: true }
    ]
  });
  printjson(initResult);
}
'

echo "⏳ レプリケーション同期の安定化を待機中 (5秒)..."
sleep 5

echo "================================================================"
echo "📊 レプリカセット稼働状態確認:"
mongosh --port 27017 --eval '
const s = rs.status();
print("レプリカセット名: " + s.set);
s.members.forEach(m => {
  print("  ノード [" + m.name + "]: 状態 = " + m.stateStr + " (ヘルス: " + m.health + ")");
});
'
echo "================================================================"
echo "🎉 MongoDB レプリカセットの二重化構築が完了しました！"
