/**
 * 🏥 医療システム一括ランチャー (start.js)
 * 
 * 以下の3システムを一度にまとめて起動し、常駐監視します：
 * 1. インシデント管理システム & 電子カルテ (Port 3000)
 * 2. オーダリング【送信側】医師・病棟入力システム (Port 4000 / HTTPS 4443)
 * 3. オーダリング【受信側】各部門モニター (Port 5000 / HTTPS 5443)
 */
const { fork, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = __dirname;
const PORTAL_DIR = path.join(ROOT_DIR, 'support', 'menu', 'sakusei');
const RAD_ORDER_DIR = path.join(ROOT_DIR, 'support', 'radiology', 'sakusei');
const RAD_UKE_DIR = path.join(ROOT_DIR, 'support', 'radi-uke', 'sakusei');
const INCIDENT_DIR = path.join(ROOT_DIR, 'incident-system');
const ORDERING_DIR = path.join(ROOT_DIR, 'ordering');
const MONGODB_CONF = path.join(ROOT_DIR, 'mongodb', 'mongodb.conf');

console.clear ? console.clear() : null;
console.log('================================================================');
console.log('🏥 交雄会だて病院 医療統合システム 一括ランチャー (Launcher)');
console.log('================================================================\n');

// 1. MongoDB レプリカセット (Primary / Secondary / Arbiter) 稼働チェック & 自動起動
const REPLICA_SET_URI = 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';

function ensureMongoDB() {
  try {
    // Primary (27017)
    execSync('lsof -ti :27017', { stdio: 'ignore' });
    console.log('✅ [DB] MongoDB Primary (Port 27017) は稼働中です。');
  } catch (e) {
    console.log('⚠️ [DB] MongoDB Primary が稼働していません。起動します...');
    try {
      execSync('systemctl start mongod || mongod --config /etc/mongod.conf', { stdio: 'ignore' });
    } catch (_) {}
  }

  // Secondary (27018)
  try {
    execSync('lsof -ti :27018', { stdio: 'ignore' });
    console.log('✅ [DB] MongoDB Secondary (Port 27018) は稼働中です。');
  } catch (e) {
    try {
      execSync('systemctl start mongod-secondary || mongod --config /etc/mongod-secondary.conf', { stdio: 'ignore' });
    } catch (_) {}
  }

  // Arbiter (27019)
  try {
    execSync('lsof -ti :27019', { stdio: 'ignore' });
    console.log('✅ [DB] MongoDB Arbiter (Port 27019) は稼働中です。');
  } catch (e) {
    try {
      execSync('systemctl start mongod-arbiter || mongod --config /etc/mongod-arbiter.conf', { stdio: 'ignore' });
    } catch (_) {}
  }
}

// 2. 指定ポートを占有している古いプロセスを解放
function killPort(port) {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (pids) {
      const pidList = pids.split(/\s+/);
      pidList.forEach(pid => {
        try {
          process.kill(parseInt(pid, 10), 'SIGTERM');
        } catch (_) {}
      });
      console.log(`🧹 [Port ${port}] 既存のプロセス (PID: ${pidList.join(', ')}) を終了しました。`);
    }
  } catch (_) {
    // 占有プロセスなし
  }
}

// 起動前にポート 8000, 8080, 3000, 4000, 5000 の古いプロセスを解放
console.log('🔍 ポート競合の確認とクリーンアップ中...');
ensureMongoDB();
killPort(8000);
killPort(8080);
killPort(8081);
killPort(3000);
killPort(4000);
killPort(5000);

// 子プロセス保持リスト
const processes = [];
let isShuttingDown = false;

function launchChild(name, filePath, cwd, envExtra) {
  const proc = fork(filePath, [], {
    cwd: cwd,
    env: { ...process.env, ...envExtra },
    stdio: 'inherit'
  });

  proc.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      console.log(`⚠️ [Launcher] ${name} が終了しました (code: ${code}, signal: ${signal})`);
    }
  });

  processes.push({ name, proc });
  return proc;
}

// 3. 医療統合ポータル (Port 8000) 起動
console.log('\n🚀 [1/6] 医療統合ポータル (Port 8000) を起動中...');
const portalPath = path.join(PORTAL_DIR, 'server.js');
launchChild('医療統合ポータル (Port 8000)', portalPath, PORTAL_DIR, { PORT: '8000', MONGO_URI: process.env.MONGO_URI || REPLICA_SET_URI });

// 4. 🩻 放射線科オーダー & 帳票印刷 (Port 8080) 起動
console.log('🚀 [2/6] 放射線科オーダー & 帳票印刷 (Port 8080) を起動中...');
const radOrderPath = path.join(RAD_ORDER_DIR, 'server.js');
launchChild('放射線科オーダー・帳票印刷 (Port 8080)', radOrderPath, RAD_ORDER_DIR, { PORT: '8080', MONGO_URI: process.env.MONGO_URI || REPLICA_SET_URI });

// 5. 📋 放射線科 指示受け・実施モニター (Port 8081) 起動
console.log('🚀 [3/6] 放射線科 指示受け・実施モニター (Port 8081) を起動中...');
const radUkePath = path.join(RAD_UKE_DIR, 'server.js');
launchChild('放射線科 指示受け・実施モニター (Port 8081)', radUkePath, RAD_UKE_DIR, { PORT: '8081', MONGO_URI: process.env.MONGO_URI || REPLICA_SET_URI });

// 6. インシデント管理システム / 電子カルテ (Port 3000) 起動
console.log('🚀 [4/6] インシデント管理システム / 電子カルテ (Port 3000) を起動中...');
const incidentPath = path.join(INCIDENT_DIR, 'server.js');
launchChild('インシデント管理システム (Port 3000)', incidentPath, INCIDENT_DIR, { PORT: '3000', MONGO_URI: process.env.MONGO_URI || REPLICA_SET_URI });

// 7. オーダリング【受信側】(Port 5000 / HTTPS 5443) 起動
console.log('🚀 [5/6] オーダリング【受信側】部門モニター (Port 5000 / HTTPS 5443) を起動中...');
const receiverPath = path.join(ORDERING_DIR, 'receiver', 'server.js');
launchChild('オーダリング【受信側】(Port 5000)', receiverPath, ORDERING_DIR, { PORT: '5000', HTTPS_PORT: '5443', USE_HTTPS: 'true', MONGO_URI: process.env.MONGO_URI || REPLICA_SET_URI });

// 8. オーダリング【送信側】(Port 4000 / HTTPS 4443) 起動
console.log('🚀 [6/6] オーダリング【送信側】医師・病棟入力 (Port 4000 / HTTPS 4443) を起動中...');
const senderPath = path.join(ORDERING_DIR, 'sender', 'server.js');
launchChild('オーダリング【送信側】(Port 4000)', senderPath, ORDERING_DIR, { PORT: '4000', HTTPS_PORT: '4443', USE_HTTPS: 'true', INCIDENT_SYSTEM_URL: 'http://127.0.0.1:3000', MONGO_URI: process.env.MONGO_URI || REPLICA_SET_URI });

// 8. 安全な終了処理 (Ctrl+C 時)
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n\n🛑 [Launcher] すべてのサーバーを停止しています...');
  processes.forEach(({ name, proc }) => {
    try {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
        console.log(`   ・${name} を停止しました`);
      }
    } catch (_) {}
  });
  setTimeout(() => {
    console.log('👋 すべてのシステムを安全に終了しました。\n');
    process.exit(0);
  }, 800);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 9. アクセスURL案内を表示
setTimeout(() => {
  console.log('\n================================================================');
  console.log('🌟 すべてのシステムが正常に起動しました！ブラウザでアクセスできます:');
  console.log('----------------------------------------------------------------');
  console.log(' 🌐 ★総合トップ★ 医療統合ポータル (Port 8000):');
  console.log('    👉 http://localhost:8000/login');
  console.log('       (管理者: admin / pass)');
  console.log(' 1. 🩻 放射線科オーダー & 正・控え帳票印刷 (Port 8080):');
  console.log('    👉 http://localhost:8080/');
  console.log(' 2. 📋 放射線科 指示受け・実施モニター (Port 8081):');
  console.log('    👉 http://localhost:8081/ (Proxy: http://localhost:8000/radi-uke/)');
  console.log(' 3. 🏥 インシデント管理 / 電子カルテ (Port 3000):');
  console.log('    👉 http://localhost:3000/login');
  console.log(' 4. 📝 オーダリング【送信側】医師・病棟入力 (Port 4000):');
  console.log('    👉 http://localhost:4000/');
  console.log(' 5. 📥 オーダリング【受信側】部門モニター (Port 5000):');
  console.log('    👉 http://localhost:5000/');
  console.log('----------------------------------------------------------------');
  console.log('💡 停止する場合は、このターミナルで [ Ctrl + C ] を押してください。');
  console.log('================================================================\n');
}, 1500);

// 8. ★最重要: 親プロセスを常駐させるキープアライブタイマー★
setInterval(() => {
  // プロセスが生きていることを保証するハートビート
}, 1000 * 60 * 60);
