/**
 * オーダリング練習用システム 一括ランチャー (start.js)
 * 送信側サーバー (Port 4000) と 受信側サーバー (Port 5000) を同時に起動します。
 */
const { fork } = require('child_process');
const path = require('path');

console.log('================================================================');
console.log('🏥 オーダリングソフト練習用システム (Ordering Practice System)');
console.log('================================================================');

const USE_HTTPS = process.env.USE_HTTPS === 'true' || process.env.USE_HTTPS === '1';
const protocol = USE_HTTPS ? 'https' : 'http';

const receiverPath = path.join(__dirname, 'receiver', 'server.js');
const senderPath = path.join(__dirname, 'sender', 'server.js');

// 1. 受信側サーバー起動 (Port 5000: HTTP / Port 5443: HTTPS)
console.log(`[Launcher] 受信側サーバー (Receiver: HTTP 5000 / HTTPS 5443) を起動中...`);
const receiverProcess = fork(receiverPath, [], {
  env: { ...process.env, PORT: '5000', HTTPS_PORT: '5443', USE_HTTPS: 'true' },
  stdio: 'inherit'
});

// 2. 送信側サーバー起動 (Port 4000: HTTP / Port 4443: HTTPS)
console.log(`[Launcher] 送信側サーバー (Sender: HTTP 4000 / HTTPS 4443) を起動中...`);
const senderProcess = fork(senderPath, [], {
  env: { ...process.env, PORT: '4000', HTTPS_PORT: '4443', USE_HTTPS: 'true' },
  stdio: 'inherit'
});

function shutdown() {
  console.log('\n[Launcher] サーバーを停止しています...');
  if (receiverProcess) receiverProcess.kill();
  if (senderProcess) senderProcess.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`\n================================================================`);
console.log(`🌟 準備完了！以下のURLでアクセスできます:`);
console.log(`   【LAN内端末 (192.168.0.3等)・ブラウザ標準アクセス用 [HTTP/推奨]】`);
console.log(`   👉 送信側 (Sender)   : http://192.168.0.5:4000   (または http://localhost:4000)`);
console.log(`   👉 受信側 (Receiver) : http://192.168.0.5:5000   (または http://localhost:5000)`);
console.log(`   👉 電子カルテ        : http://192.168.0.5:3000   (または http://localhost:3000)`);
console.log(`\n   【SSL/TLS 暗号化アクセス用 [HTTPS]】`);
console.log(`   👉 送信側 (Sender)   : https://192.168.0.5:4443`);
console.log(`   👉 受信側 (Receiver) : https://192.168.0.5:5443`);
console.log(`================================================================\n`);
