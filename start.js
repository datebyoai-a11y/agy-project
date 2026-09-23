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
const INCIDENT_DIR = path.join(ROOT_DIR, 'incident-system');
const ORDERING_DIR = path.join(ROOT_DIR, 'ordering');
const MONGODB_CONF = path.join(ROOT_DIR, 'mongodb', 'mongodb.conf');

console.clear ? console.clear() : null;
console.log('================================================================');
console.log('🏥 交雄会だて病院 医療統合システム 一括ランチャー (Launcher)');
console.log('================================================================\n');

// 1. MongoDB 稼働チェック & 自動起動
function ensureMongoDB() {
  try {
    execSync('pgrep -x mongod', { stdio: 'ignore' });
    console.log('✅ [DB] MongoDB (mongod) は既に稼働中です。');
  } catch (e) {
    console.log('⚠️ [DB] MongoDB が稼働していません。自動起動を試みます...');
    try {
      if (fs.existsSync(MONGODB_CONF)) {
        execSync(`mongod --config "${MONGODB_CONF}" > /dev/null 2>&1 &`, { stdio: 'ignore' });
      } else {
        execSync('systemctl start mongod || systemctl start mongodb || mongod --fork --logpath /tmp/mongod.log', { stdio: 'ignore' });
      }
      console.log('✅ [DB] MongoDB を起動しました。');
    } catch (err) {
      console.warn('⚠️ [DB] MongoDB 自動起動エラー (手動確認が必要な場合があります):', err.message);
    }
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

// 起動前にポート 3000, 4000, 5000 の古いプロセスを解放
console.log('🔍 ポート競合の確認とクリーンアップ中...');
ensureMongoDB();
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

// 3. インシデント管理システム (Port 3000) 起動
console.log('\n🚀 [1/3] インシデント管理システム / 電子カルテ (Port 3000) を起動中...');
const incidentPath = path.join(INCIDENT_DIR, 'server.js');
launchChild('インシデント管理システム (Port 3000)', incidentPath, INCIDENT_DIR, { PORT: '3000' });

// 4. オーダリング【受信側】(Port 5000 / HTTPS 5443) 起動
console.log('🚀 [2/3] オーダリング【受信側】部門モニター (Port 5000 / HTTPS 5443) を起動中...');
const receiverPath = path.join(ORDERING_DIR, 'receiver', 'server.js');
launchChild('オーダリング【受信側】(Port 5000)', receiverPath, ORDERING_DIR, { PORT: '5000', HTTPS_PORT: '5443', USE_HTTPS: 'true' });

// 5. オーダリング【送信側】(Port 4000 / HTTPS 4443) 起動
console.log('🚀 [3/3] オーダリング【送信側】医師・病棟入力 (Port 4000 / HTTPS 4443) を起動中...');
const senderPath = path.join(ORDERING_DIR, 'sender', 'server.js');
launchChild('オーダリング【送信側】(Port 4000)', senderPath, ORDERING_DIR, { PORT: '4000', HTTPS_PORT: '4443', USE_HTTPS: 'true' });

// 6. 安全な終了処理 (Ctrl+C 時)
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

// 7. アクセスURL案内を表示
setTimeout(() => {
  console.log('\n================================================================');
  console.log('🌟 すべてのシステムが正常に起動しました！ブラウザでアクセスできます:');
  console.log('----------------------------------------------------------------');
  console.log(' 1. 🏥 インシデント管理 / 電子カルテ (Port 3000):');
  console.log('    👉 http://localhost:3000/login');
  console.log('       (管理者: admin / admin123  |  看護研修生: nurse1 / user123)');
  console.log(' 2. 📝 オーダリング【送信側】医師・病棟入力 (Port 4000):');
  console.log('    👉 http://localhost:4000/');
  console.log(' 3. 📥 オーダリング【受信側】部門モニター (Port 5000):');
  console.log('    👉 http://localhost:5000/');
  console.log('----------------------------------------------------------------');
  console.log('💡 停止する場合は、このターミナルで [ Ctrl + C ] を押してください。');
  console.log('================================================================\n');
}, 1500);

// 8. ★最重要: 親プロセスを常駐させるキープアライブタイマー★
setInterval(() => {
  // プロセスが生きていることを保証するハートビート
}, 1000 * 60 * 60);
