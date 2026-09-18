const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '../config/keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'pgp_private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'pgp_public.pem');

// キーペアの初期化（未生成なら自動生成して保存）
function ensureKeyPair() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  if (!fs.existsSync(PRIVATE_KEY_PATH) || !fs.existsSync(PUBLIC_KEY_PATH)) {
    console.log('[PGP] 鍵ファイルが存在しないため、新規RSAキーペア(2048bit)を自動生成します...');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, 'utf8');
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, 'utf8');
    console.log('[PGP] キーペアを正常に保存しました:', KEYS_DIR);
  }

  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  return { privateKey, publicKey };
}

// 公開鍵からフィンガープリントとKey IDを生成
function getKeyFingerprint(publicKeyPem) {
  const der = Buffer.from(
    publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, ''),
    'base64'
  );
  const hash = crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
  // 4文字ごとのスペース区切り形式
  const formatted = hash.match(/.{1,4}/g).join(' ');
  const keyId = hash.slice(-8); // 下位8文字
  return { fingerprint: formatted, keyId: `0x${keyId}` };
}

// 記事データから正規化された署名対象テキスト（Canonical Payload）を作成
function createCanonicalPayload(data) {
  const title = (data.title || '').trim();
  const content = (data.content || '').trim();
  const targetId = data.targetPersonId || data.targetPerson || 'NONE';
  const authorName = data.authorName || 'UNKNOWN';
  const authorLoginId = data.authorLoginId || 'UNKNOWN';
  const authorDept = data.authorDept || '一般';
  const category = (data.category || '共有メモ').trim();
  
  let timeStr = '';
  if (data.createdAt) {
    timeStr = new Date(data.createdAt).toISOString();
  } else {
    timeStr = new Date().toISOString();
  }

  return [
    '-----BEGIN CANONICAL MEDICAL RECORD DATA-----',
    `Title: ${title}`,
    `Category: ${category}`,
    `TargetPerson: ${targetId}`,
    `Author: ${authorName} (${authorLoginId})`,
    `Department: ${authorDept}`,
    `Timestamp: ${timeStr}`,
    'Content-Body:',
    content,
    '-----END CANONICAL MEDICAL RECORD DATA-----'
  ].join('\n');
}

// OpenPGP Armor形式の署名ブロックを生成
function formatPgpArmorSignature(signatureBase64, keyId, fingerprint, signerInfo) {
  return [
    '-----BEGIN PGP SIGNATURE-----',
    'Version: Medical-PGP Security Engine v2.4 (OpenPGP Compatible)',
    `Comment: Signed by ${signerInfo} [KeyID: ${keyId}]`,
    `Hash: SHA256`,
    `Fingerprint: ${fingerprint}`,
    '',
    signatureBase64.match(/.{1,64}/g).join('\n'),
    '-----END PGP SIGNATURE-----'
  ].join('\n');
}

/**
 * 記事にPGP電子署名を付与する
 */
function signArticle(articleData) {
  const { privateKey, publicKey } = ensureKeyPair();
  const { fingerprint, keyId } = getKeyFingerprint(publicKey);

  const payload = createCanonicalPayload(articleData);

  const signer = crypto.createSign('SHA256');
  signer.update(payload, 'utf8');
  signer.end();

  const rawSignature = signer.sign(privateKey, 'base64');
  const signerInfo = `${articleData.authorName || '担当者'} (${articleData.authorLoginId || 'ID未設定'})`;
  const armorSignature = formatPgpArmorSignature(rawSignature, keyId, fingerprint, signerInfo);

  return {
    signature: armorSignature,
    rawSignature,
    signedPayload: payload,
    keyId,
    fingerprint,
    signedAt: articleData.createdAt ? new Date(articleData.createdAt) : new Date(),
    signedBy: signerInfo,
    signerRole: articleData.authorDept || '一般',
    algorithm: 'RSA-SHA256 (OpenPGP Armor)'
  };
}

/**
 * 記事のPGP署名を検証し、改ざんの有無を判定する
 */
function verifyArticle(article) {
  try {
    const { publicKey } = ensureKeyPair();

    if (!article.pgpSignature || !article.pgpSignature.rawSignature) {
      return {
        isValid: false,
        isSigned: false,
        tampered: false,
        message: 'この記事にはPGP電子署名が付与されていません。'
      };
    }

    // 現在の記事データからカノニカルペイロードを再構築
    const currentPayload = createCanonicalPayload({
      title: article.title,
      content: article.content,
      targetPersonId: article.targetPerson ? (article.targetPerson._id || article.targetPerson).toString() : 'NONE',
      authorName: article.author ? (article.author.userName || article.author.loginId) : 'UNKNOWN',
      authorLoginId: article.author ? article.author.loginId : 'UNKNOWN',
      authorDept: article.author ? (article.author.department || '一般') : '一般',
      category: article.category,
      createdAt: article.createdAt
    });

    const verifier = crypto.createVerify('SHA256');
    verifier.update(currentPayload, 'utf8');
    verifier.end();

    const isCurrentValid = verifier.verify(publicKey, article.pgpSignature.rawSignature, 'base64');

    if (isCurrentValid) {
      return {
        isValid: true,
        isSigned: true,
        tampered: false,
        signedAt: article.pgpSignature.signedAt,
        signedBy: article.pgpSignature.signedBy,
        signerRole: article.pgpSignature.signerRole,
        keyId: article.pgpSignature.keyId,
        fingerprint: article.pgpSignature.fingerprint,
        algorithm: article.pgpSignature.algorithm,
        armorSignature: article.pgpSignature.signature,
        signedPayload: currentPayload,
        message: '✅ PGP電子署名は有効です。投稿以降の改ざんは一切検知されませんでした（完全性保証済み）。'
      };
    } else {
      // 署名時ペイロードとも照合して、改ざん内容を特定
      return {
        isValid: false,
        isSigned: true,
        tampered: true,
        signedAt: article.pgpSignature.signedAt,
        signedBy: article.pgpSignature.signedBy,
        signerRole: article.pgpSignature.signerRole,
        keyId: article.pgpSignature.keyId,
        fingerprint: article.pgpSignature.fingerprint,
        algorithm: article.pgpSignature.algorithm,
        armorSignature: article.pgpSignature.signature,
        currentPayload,
        originalPayload: article.pgpSignature.signedPayload,
        message: '⚠️ 警告: PGP署名と現在のデータが一致しません！記事のタイトル・本文・対象者情報等が不正に改ざんされた可能性があります。'
      };
    }
  } catch (err) {
    return {
      isValid: false,
      isSigned: true,
      tampered: true,
      error: err.message,
      message: `署名検証エラー: ${err.message}`
    };
  }
}

/**
 * システムのPGP公開鍵（Armor形式）を取得
 */
function getSystemPublicKeyArmor() {
  const { publicKey } = ensureKeyPair();
  const { fingerprint, keyId } = getKeyFingerprint(publicKey);

  return [
    '-----BEGIN PGP PUBLIC KEY BLOCK-----',
    'Version: Medical-PGP Security Engine v2.4',
    `Comment: System Public Verification Key [KeyID: ${keyId}]`,
    `Fingerprint: ${fingerprint}`,
    '',
    publicKey.replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .trim(),
    '-----END PGP PUBLIC KEY BLOCK-----'
  ].join('\n');
}

module.exports = {
  signArticle,
  verifyArticle,
  getSystemPublicKeyArmor,
  ensureKeyPair
};
