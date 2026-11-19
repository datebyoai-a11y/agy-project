#!/usr/bin/env node
/**
 * 🔐 交雄会だて病院 院内イントラネット用 HTTPS 証明書生成スクリプト
 *
 * 1. 院内ローカル認証局 (Root CA: certs/ca.crt, certs/ca.key) を初回のみ生成
 * 2. 現在の院内LAN IP / ホスト名を SAN に含むサーバー証明書 (certs/server.crt, certs/server.key) を発行
 *
 * 使い方:
 *   node scripts/generate-intranet-certs.js           # 必要な場合のみ生成・更新（IP変更時自動更新）
 *   node scripts/generate-intranet-certs.js --force   # サーバー証明書を強制再生成
 *   node scripts/generate-intranet-certs.js --reset-ca # Root CA ごと作り直す
 *
 * 環境変数:
 *   CERT_EXTRA_IPS   : カンマ区切りで追加するIP (例: "172.30.3.117,192.168.1.10")
 *   CERT_EXTRA_DNS   : カンマ区切りで追加するDNS名 (例: "portal.hospital.local")
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DIR = fs.existsSync(path.join(__dirname, 'support'))
  ? __dirname
  : path.resolve(__dirname, '..');
const CERT_DIR = path.join(ROOT_DIR, 'certs');

const CA_KEY_PATH = path.join(CERT_DIR, 'ca.key');
const CA_CERT_PATH = path.join(CERT_DIR, 'ca.crt');
const CA_SERIAL_PATH = path.join(CERT_DIR, 'ca.srl');
const SERVER_KEY_PATH = path.join(CERT_DIR, 'server.key');
const SERVER_CSR_PATH = path.join(CERT_DIR, 'server.csr');
const SERVER_CERT_PATH = path.join(CERT_DIR, 'server.crt');
const OPENSSL_CNF_PATH = path.join(CERT_DIR, 'server-ext.cnf');

function collectSanEntries() {
  const ipSet = new Set(['127.0.0.1']);
  const dnsSet = new Set(['localhost']);

  const hostName = os.hostname();
  if (hostName) {
    dnsSet.add(hostName);
    if (!hostName.includes('.')) {
      dnsSet.add(`${hostName}.local`);
    }
  }

  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && addr.address) {
        ipSet.add(addr.address);
      }
    }
  }

  if (process.env.CERT_EXTRA_IPS) {
    process.env.CERT_EXTRA_IPS.split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(ip => ipSet.add(ip));
  }

  if (process.env.CERT_EXTRA_DNS) {
    process.env.CERT_EXTRA_DNS.split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(dns => dnsSet.add(dns));
  }

  return {
    ips: Array.from(ipSet),
    dnsNames: Array.from(dnsSet)
  };
}

function isServerCertUpToDate(expectedIps, expectedDns) {
  if (!fs.existsSync(CA_CERT_PATH) || !fs.existsSync(SERVER_CERT_PATH) || !fs.existsSync(SERVER_KEY_PATH)) {
    return false;
  }

  try {
    // CA による署名検証
    execFileSync('openssl', ['verify', '-CAfile', CA_CERT_PATH, SERVER_CERT_PATH], { stdio: 'ignore' });

    // 残り有効期限チェック（30日以上残っているか）
    execFileSync('openssl', ['x509', '-checkend', String(30 * 24 * 60 * 60), '-noout', '-in', SERVER_CERT_PATH], {
      stdio: 'ignore'
    });

    // SAN に現在の全IP・DNSが含まれているか確認
    const text = execFileSync('openssl', ['x509', '-in', SERVER_CERT_PATH, '-noout', '-text'], {
      encoding: 'utf8'
    });

    for (const ip of expectedIps) {
      if (!text.includes(`IP Address:${ip}`)) {
        return false;
      }
    }
    for (const dns of expectedDns) {
      if (!text.includes(`DNS:${dns}`)) {
        return false;
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

function ensureCertificates(options = {}) {
  const { force = false, resetCa = false, quiet = false } = options;

  if (!fs.existsSync(CERT_DIR)) {
    fs.mkdirSync(CERT_DIR, { recursive: true, mode: 0o750 });
  }

  const { ips, dnsNames } = collectSanEntries();

  if (!force && !resetCa && isServerCertUpToDate(ips, dnsNames)) {
    if (!quiet) {
      console.log('✅ [HTTPS] 既存の院内サーバー証明書は有効かつ最新IPに対応済みです。');
    }
    return {
      caCertPath: CA_CERT_PATH,
      serverCertPath: SERVER_CERT_PATH,
      serverKeyPath: SERVER_KEY_PATH,
      ips,
      dnsNames,
      regenerated: false
    };
  }

  // 1. 院内ローカル Root CA の生成（未作成 or --reset-ca 時）
  if (resetCa || !fs.existsSync(CA_KEY_PATH) || !fs.existsSync(CA_CERT_PATH)) {
    if (!quiet) {
      console.log('🔐 [HTTPS] 院内ローカル認証局 (Root CA) を新規生成しています...');
    }
    execFileSync('openssl', ['genrsa', '-out', CA_KEY_PATH, '4096'], { stdio: 'ignore' });
    fs.chmodSync(CA_KEY_PATH, 0o600);

    execFileSync(
      'openssl',
      [
        'req', '-x509', '-new', '-nodes',
        '-key', CA_KEY_PATH,
        '-sha256',
        '-days', '3650',
        '-subj', '/C=JP/ST=Hokkaido/L=Date/O=Koyukai Date Hospital/OU=Medical IT/CN=Koyukai Date Hospital Intranet Root CA',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-out', CA_CERT_PATH
      ],
      { stdio: 'ignore' }
    );
    fs.chmodSync(CA_CERT_PATH, 0o644);
  }

  // 2. サーバー秘密鍵と CSR の生成
  if (!quiet) {
    console.log('🔐 [HTTPS] 院内サーバー証明書を発行しています...');
    console.log(`   対象 IP  : ${ips.join(', ')}`);
    console.log(`   対象 DNS : ${dnsNames.join(', ')}`);
  }

  execFileSync('openssl', ['genrsa', '-out', SERVER_KEY_PATH, '2048'], { stdio: 'ignore' });
  fs.chmodSync(SERVER_KEY_PATH, 0o600);

  const primaryIp = ips.find(ip => ip !== '127.0.0.1') || 'localhost';
  execFileSync(
    'openssl',
    [
      'req', '-new',
      '-key', SERVER_KEY_PATH,
      '-subj', `/C=JP/ST=Hokkaido/L=Date/O=Koyukai Date Hospital/OU=Medical Portal/CN=${primaryIp}`,
      '-out', SERVER_CSR_PATH
    ],
    { stdio: 'ignore' }
  );

  // 3. SAN 拡張設定ファイルを生成して Root CA で署名（有効期間 825日: 主要ブラウザ要件準拠）
  const sanLines = [
    'authorityKeyIdentifier=keyid,issuer',
    'basicConstraints=CA:FALSE',
    'keyUsage=digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    'subjectAltName=@alt_names',
    '',
    '[alt_names]',
    ...dnsNames.map((dns, idx) => `DNS.${idx + 1} = ${dns}`),
    ...ips.map((ip, idx) => `IP.${idx + 1} = ${ip}`),
    ''
  ].join('\n');

  fs.writeFileSync(OPENSSL_CNF_PATH, sanLines, 'utf8');

  execFileSync(
    'openssl',
    [
      'x509', '-req',
      '-in', SERVER_CSR_PATH,
      '-CA', CA_CERT_PATH,
      '-CAkey', CA_KEY_PATH,
      '-CAcreateserial',
      '-CAserial', CA_SERIAL_PATH,
      '-out', SERVER_CERT_PATH,
      '-days', '825',
      '-sha256',
      '-extfile', OPENSSL_CNF_PATH
    ],
    { stdio: 'ignore' }
  );
  fs.chmodSync(SERVER_CERT_PATH, 0o644);

  // 一時 CSR / 拡張ファイルをクリーンアップ
  if (fs.existsSync(SERVER_CSR_PATH)) fs.unlinkSync(SERVER_CSR_PATH);

  if (!quiet) {
    console.log('✅ [HTTPS] 院内サーバー証明書の発行が完了しました！');
    console.log(`   Root CA 証明書 (院内端末へ配布): ${CA_CERT_PATH}`);
    console.log(`   サーバー証明書                 : ${SERVER_CERT_PATH}`);
  }

  return {
    caCertPath: CA_CERT_PATH,
    serverCertPath: SERVER_CERT_PATH,
    serverKeyPath: SERVER_KEY_PATH,
    ips,
    dnsNames,
    regenerated: true
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const resetCa = args.includes('--reset-ca');
  try {
    ensureCertificates({ force, resetCa });
  } catch (err) {
    console.error('❌ [HTTPS] 証明書生成エラー:', err.message);
    process.exit(1);
  }
}

module.exports = { ensureCertificates, collectSanEntries, CERT_DIR, CA_CERT_PATH, SERVER_CERT_PATH, SERVER_KEY_PATH };
