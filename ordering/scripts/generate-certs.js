const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const certDir = path.join(__dirname, '..', 'certs');
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

const keyPath = path.join(certDir, 'server.key');
const certPath = path.join(certDir, 'server.crt');
const cnfPath = path.join(certDir, 'openssl.cnf');

// ローカルネットワークインターフェースのIPアドレスを取得
const networkInterfaces = os.networkInterfaces();
const ipAddresses = ['127.0.0.1'];
for (const devName in networkInterfaces) {
  const iface = networkInterfaces[devName];
  for (let i = 0; i < iface.length; i++) {
    const alias = iface[i];
    if (alias.family === 'IPv4' && !alias.internal) {
      ipAddresses.push(alias.address);
    }
  }
}

// OpenSSL 設定ファイル作成（SAN: Subject Alternative Name対応）
let sanConfig = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = JP
ST = Tokyo
L = Hospital
O = Medical Ordering System
OU = IT Department
CN = localhost

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment

[alt_names]
DNS.1 = localhost
DNS.2 = *.local
DNS.3 = *.hospital.local
`;

ipAddresses.forEach((ip, idx) => {
  sanConfig += `IP.${idx + 1} = ${ip}\n`;
});

fs.writeFileSync(cnfPath, sanConfig, 'utf8');

console.log('🔐 [Cert Generator] SSL/TLS 自己署名証明書を生成しています...');
console.log(`   対象ホスト/IP: localhost, ${ipAddresses.join(', ')}`);

try {
  // OpenSSL コマンド実行
  const cmd = `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -config "${cnfPath}"`;
  execSync(cmd, { stdio: 'inherit' });

  console.log('✅ [Cert Generator] SSL証明書の生成が完了しました！');
  console.log(`   秘密鍵: ${keyPath}`);
  console.log(`   証明書: ${certPath}`);
} catch (err) {
  console.error('❌ [Cert Generator] 証明書生成エラー:', err.message);
  process.exit(1);
}
