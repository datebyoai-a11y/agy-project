/**
 * 🏥 交雄会だて病院 医療統合システム 一括ランチャー (start.js)
 *
 * 院内イントラネット HTTP 構成 (Port 80):
 * - 有線LAN (enp0s31f6) 接続時: 192.168.20.221:80 (+ 127.0.0.1:80) で待ち受け
 * - 有線LAN 切断時 (DHCP)     : 現在の DHCP IP:80 (+ 127.0.0.1:80) で待ち受け
 * - 各サブシステム (Port 3000 / 4000 / 8080〜8085) はローカル限定 (127.0.0.1) に隔離し、
 *   ポータルのリバースプロキシ経由でのみアクセス可能にする
 */
const { fork, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// scripts ディレクトリ内に配置された場合と、プロジェクトルートに配置された場合の両方に対応
const ROOT_DIR = fs.existsSync(path.join(__dirname, 'support'))
  ? __dirname
  : path.resolve(__dirname, '..');

const PORTAL_DIR = path.join(ROOT_DIR, 'support', 'menu', 'sakusei');
const RAD_ORDER_DIR = path.join(ROOT_DIR, 'support', 'radiology', 'sakusei');
const RAD_UKE_DIR = path.join(ROOT_DIR, 'support', 'radi-uke', 'sakusei');
const INJECTION_DIR = path.join(ROOT_DIR, 'support', 'injection', 'sakusei');
const REHABILI_DIR = path.join(ROOT_DIR, 'support', 'rehabili', 'sakusei');
const REHA_UKE_DIR = path.join(ROOT_DIR, 'support', 'reha-uke', 'sakusei');
const NAIFUKU_DIR = path.join(ROOT_DIR, 'support', 'naifuku', 'sakusei');
const INCIDENT_DIR = path.join(ROOT_DIR, 'incident-system');
const ORDERING_DIR = path.join(ROOT_DIR, 'support', 'ordering', 'sakusei');

const WIRED_IFACE = process.env.WIRED_IFACE || 'enp0s31f6';
const HTTP_PORT = process.env.PORT || '80';
const HTTPS_PORT = process.env.HTTPS_PORT || '8443';
const ENABLE_HTTPS = process.env.ENABLE_HTTPS === '1';

function getInterfaceIPv4(ifaceName) {
  const interfaces = os.networkInterfaces();
  const addrs = interfaces[ifaceName];
  if (!addrs) return null;
  for (const addr of addrs) {
    if (addr.family === 'IPv4' && !addr.internal && addr.address) {
      return addr.address;
    }
  }
  return null;
}

function getAllActiveIPv4Set() {
  const set = new Set(['127.0.0.1', '0.0.0.0']);
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && addr.address) {
        set.add(addr.address);
      }
    }
  }
  return set;
}

function loadLanBindEnv() {
  const envFile = path.join(ROOT_DIR, '.lan-bind.env');
  const result = {};
  if (!fs.existsSync(envFile)) return result;
  try {
    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) {
        result[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
  } catch (_) {}
  return result;
}

function resolveNetworkBinding() {
  const activeIps = getAllActiveIPv4Set();
  const saved = loadLanBindEnv();

  // 1. 有線LANインターフェースがIPv4を持っていれば有線固定モード最優先
  const wiredIp = getInterfaceIPv4(WIRED_IFACE);
  if (wiredIp) {
    return { mode: 'wired', bindHost: wiredIp, iface: WIRED_IFACE };
  }

  // 2. 明示指定 (環境変数 or .lan-bind.env) があり、そのIPが現在有効なら使用
  const requestedHost = process.env.HOST || saved.BIND_HOST;
  if (requestedHost && activeIps.has(requestedHost) && requestedHost !== '127.0.0.1') {
    return { mode: process.env.LAN_MODE || saved.MODE || 'dhcp', bindHost: requestedHost, iface: saved.IFACE || 'auto' };
  }

  // 3. DHCP (Wi-Fi等の非有線インターフェース) を自動検出
  const candidates = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs || name === WIRED_IFACE) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && addr.address) {
        candidates.push({ iface: name, address: addr.address });
      }
    }
  }
  candidates.sort((a, b) => {
    const score = (n) => (/^wl/.test(n) ? 0 : /^(en|eth)/.test(n) ? 1 : /^tailscale/.test(n) ? 3 : 2);
    return score(a.iface) - score(b.iface);
  });

  if (candidates.length > 0) {
    return { mode: 'dhcp', bindHost: candidates[0].address, iface: candidates[0].iface };
  }

  return { mode: 'dhcp', bindHost: '127.0.0.1', iface: 'lo' };
}

function formatOrigin(proto, host, port) {
  const isDefault = (proto === 'http' && Number(port) === 80) || (proto === 'https' && Number(port) === 443);
  return isDefault ? `${proto}://${host}` : `${proto}://${host}:${port}`;
}

function updateDesktopIntranetGuide(binding, baseUrl, localUrl) {
  const desktopFile = path.join(os.homedir(), 'Desktop', '現在の公開URL.txt');
  if (!fs.existsSync(path.dirname(desktopFile))) return;
  const nowStr = new Date().toLocaleString('ja-JP', { hour12: false });
  const modeLabel = binding.mode === 'wired'
    ? `有線LAN固定 (${binding.iface}: ${binding.bindHost}/24・同一セグメント閉域)`
    : `DHCP (${binding.iface}: ${binding.bindHost})`;

  const content = [
    '=============================================================',
    '🏥 交雄会だて病院 医療統合ポータル 院内イントラネット接続URL',
    '=============================================================',
    '【接続モード】',
    `🏢 ${modeLabel}`,
    '   (外部公開トンネル不使用 / Port 80)',
    '',
    '【院内アクセスURL】',
    `👉 ${baseUrl}/login`,
    `   (サーバー自身から開く場合: ${localUrl}/login)`,
    '',
    '【待ち受けアドレス】',
    `   ${binding.bindHost}:${ENABLE_HTTPS ? HTTPS_PORT : HTTP_PORT} (+ 127.0.0.1:${ENABLE_HTTPS ? HTTPS_PORT : HTTP_PORT})`,
    '',
    '【更新日時】',
    nowStr,
    '',
    '【ログインアカウント】',
    '・管理者: admin / pass',
    '・各職員: 登録済み職員ID / パスワード',
    '=============================================================',
    ''
  ].join('\n');
  try {
    fs.writeFileSync(desktopFile, content, 'utf8');
  } catch (e) {
    console.warn('⚠️ デスクトップ接続案内ファイルの更新に失敗:', e.message);
  }
}

console.clear ? console.clear() : null;
console.log('================================================================');
console.log(`🏥 交雄会だて病院 医療統合システム 一括ランチャー (院内 Port ${HTTP_PORT})`);
console.log('================================================================\n');

// 1. MongoDB レプリカセット (Primary / Secondary / Arbiter) 稼働チェック & 自動起動
const REPLICA_SET_URI = 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';

function ensureMongoDB() {
  try {
    execSync('nc -z 127.0.0.1 27017', { stdio: 'ignore' });
    console.log('✅ [DB] MongoDB Primary (Port 27017) は稼働中です。');
  } catch (e) {
    console.log('⚠️ [DB] MongoDB Primary が稼働していません。起動します...');
    try {
      execSync('systemctl start mongod 2>/dev/null || true', { stdio: 'ignore' });
    } catch (_) {}
  }

  try {
    execSync('nc -z 127.0.0.1 27018', { stdio: 'ignore' });
    console.log('✅ [DB] MongoDB Secondary (Port 27018) は稼働中です。');
  } catch (e) {
    try {
      execSync('systemctl start mongod-secondary 2>/dev/null || true', { stdio: 'ignore' });
    } catch (_) {}
  }

  try {
    execSync('nc -z 127.0.0.1 27019', { stdio: 'ignore' });
    console.log('✅ [DB] MongoDB Arbiter (Port 27019) は稼働中です。');
  } catch (e) {
    try {
      execSync('systemctl start mongod-arbiter 2>/dev/null || true', { stdio: 'ignore' });
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

if (ENABLE_HTTPS) {
  const { ensureCertificates } = require(path.join(ROOT_DIR, 'scripts', 'generate-intranet-certs'));
  ensureCertificates();
}

const binding = resolveNetworkBinding();
console.log(`🌐 [Network] 接続モード: ${binding.mode} / バインドIP: ${binding.bindHost} (IF: ${binding.iface}) + 127.0.0.1`);

// 起動前に各ポートの古いプロセスを解放
console.log('🔍 ポート競合の確認とクリーンアップ中...');
ensureMongoDB();
[80, 8443, 8000, 8080, 8081, 8082, 8083, 8084, 8085, 3000, 4000, 5000].forEach(killPort);

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

const commonMongo = process.env.MONGO_URI || REPLICA_SET_URI;

// 3. 医療統合ポータル (指定IP + 127.0.0.1 / Port 80) 起動
console.log(`\n🚀 [1/9] 医療統合ポータル (${binding.bindHost}:${HTTP_PORT} + 127.0.0.1:${HTTP_PORT}) を起動中...`);
launchChild('医療統合ポータル', path.join(PORTAL_DIR, 'server.js'), PORTAL_DIR, {
  HOST: binding.bindHost,
  ALSO_BIND_LOCALHOST: '1',
  LAN_MODE: binding.mode,
  PORT: HTTP_PORT,
  HTTPS_PORT: HTTPS_PORT,
  ENABLE_HTTPS: ENABLE_HTTPS ? '1' : '0',
  MONGO_URI: commonMongo
});

// 4〜11. 各サブシステムはローカル限定 (127.0.0.1) で起動し、ポータル経由のみに隔離
console.log('🚀 [2/9] 放射線科オーダー & 帳票印刷 (127.0.0.1:8080) を起動中...');
launchChild('放射線科オーダー・帳票印刷 (127.0.0.1:8080)', path.join(RAD_ORDER_DIR, 'server.js'), RAD_ORDER_DIR, {
  HOST: '127.0.0.1',
  PORT: '8080',
  MONGO_URI: commonMongo
});

console.log('🚀 [3/9] 放射線科 指示受け・実施モニター (127.0.0.1:8081) を起動中...');
launchChild('放射線科 指示受け・実施モニター (127.0.0.1:8081)', path.join(RAD_UKE_DIR, 'server.js'), RAD_UKE_DIR, {
  HOST: '127.0.0.1',
  PORT: '8081',
  MONGO_URI: commonMongo
});

console.log('🚀 [4/9] 注射・点滴オーダー (127.0.0.1:8082) を起動中...');
launchChild('注射・点滴オーダー (127.0.0.1:8082)', path.join(INJECTION_DIR, 'server.js'), INJECTION_DIR, {
  HOST: '127.0.0.1',
  PORT: '8082',
  MONGO_URI: commonMongo
});

console.log('🚀 [5/9] リハビリテーション指示オーダー (127.0.0.1:8083) を起動中...');
launchChild('リハビリテーション指示オーダー (127.0.0.1:8083)', path.join(REHABILI_DIR, 'server.js'), REHABILI_DIR, {
  HOST: '127.0.0.1',
  PORT: '8083',
  MONGO_URI: commonMongo
});

console.log('🚀 [6/9] 内服・外用処方オーダー (127.0.0.1:8084) を起動中...');
launchChild('内服・外用処方オーダー (127.0.0.1:8084)', path.join(NAIFUKU_DIR, 'server.js'), NAIFUKU_DIR, {
  HOST: '127.0.0.1',
  PORT: '8084',
  MONGO_URI: commonMongo
});

console.log('🚀 [7/9] リハビリテーション科 指示受け・実施モニター (127.0.0.1:8085) を起動中...');
launchChild('リハビリ指示受けモニター (127.0.0.1:8085)', path.join(REHA_UKE_DIR, 'server.js'), REHA_UKE_DIR, {
  HOST: '127.0.0.1',
  PORT: '8085',
  MONGO_URI: commonMongo
});

console.log('🚀 [8/9] インシデント管理システム / 電子カルテ (127.0.0.1:3000) を起動中...');
launchChild('インシデント管理システム (127.0.0.1:3000)', path.join(INCIDENT_DIR, 'server.js'), INCIDENT_DIR, {
  HOST: '127.0.0.1',
  PORT: '3000',
  MONGO_URI: commonMongo
});

console.log('🚀 [9/9] 統合オーダリング総合ポータル (127.0.0.1:4000) を起動中...');
launchChild('統合オーダリング総合ポータル (127.0.0.1:4000)', path.join(ORDERING_DIR, 'server.js'), ORDERING_DIR, {
  HOST: '127.0.0.1',
  PORT: '4000',
  MONGO_URI: commonMongo
});

// 安全な終了処理 (Ctrl+C 時)
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

// アクセスURL案内を表示 & デスクトップ案内ファイル更新
setTimeout(() => {
  const proto = ENABLE_HTTPS ? 'https' : 'http';
  const activePort = ENABLE_HTTPS ? HTTPS_PORT : HTTP_PORT;
  const baseUrl = formatOrigin(proto, binding.bindHost, activePort);
  const localUrl = formatOrigin(proto, 'localhost', activePort);
  updateDesktopIntranetGuide(binding, baseUrl, localUrl);

  console.log('\n================================================================');
  console.log(`🌟 すべてのシステムが院内イントラネット (${binding.mode.toUpperCase()} / Port ${activePort}) で起動しました！`);
  console.log('----------------------------------------------------------------');
  console.log(` 🌐 ★院内総合トップ★ 医療統合ポータル:`);
  console.log(`    👉 ${baseUrl}/login`);
  console.log(`       (ローカル: ${localUrl}/login)`);
  console.log('       (管理者: admin / pass)');
  console.log('');
  console.log(' 🛡️  各サブシステムは 127.0.0.1 に隔離済み（ポータル経由でアクセス）:');
  console.log(`    1. 🩻 放射線科オーダー       : ${baseUrl}/radiology/`);
  console.log(`    2. 📋 放射線科 指示受け      : ${baseUrl}/radi-uke/`);
  console.log(`    3. 💉 注射・点滴オーダー     : ${baseUrl}/injection/`);
  console.log(`    4. 🤸 リハビリ指示オーダー   : ${baseUrl}/rehabili/`);
  console.log(`    5. 🤸 リハビリ 指示受け      : ${baseUrl}/reha-uke/`);
  console.log(`    6. 💊 内服・外用処方オーダー : ${baseUrl}/naifuku/`);
  console.log(`    7. 🏥 インシデント / カルテ  : ${baseUrl}/articles`);
  console.log(`    8. 📝 統合オーダリング       : ${baseUrl}/ordering/`);
  console.log('----------------------------------------------------------------');
  console.log('💡 停止する場合は、このターミナルで [ Ctrl + C ] を押してください。');
  console.log('================================================================\n');
}, 1500);

// 親プロセスを常駐させるキープアライブタイマー
setInterval(() => {}, 1000 * 60 * 60);
