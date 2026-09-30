/**
 * 🛡️ PGP 真正性保証・電子署名モジュール (OpenPGP.js / Ed25519)
 * 交雄会だて病院 放射線科オーダーシステム
 * 
 * 真正性(Authenticity)、完全性(Integrity)、否認防止(Non-repudiation)を暗号学的に担保
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const openpgp = require('openpgp');
const qrcode = require('qrcode');

const KEYS_DIR = path.join(__dirname, '../keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'hospital_radiology_private.asc');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'hospital_radiology_public.asc');

let cachedPrivateKeyObj = null;
let cachedPublicKeyObj = null;
let cachedArmoredPublicKey = '';
let cachedKeyId = '';
let cachedFingerprint = '';

/**
 * 🔑 1. PGP鍵ペアの初期化・取得 (未作成時は自動生成)
 */
async function initKeys() {
  if (cachedPrivateKeyObj && cachedPublicKeyObj) {
    return {
      privateKey: cachedPrivateKeyObj,
      publicKey: cachedPublicKeyObj,
      armoredPublicKey: cachedArmoredPublicKey,
      keyId: cachedKeyId,
      fingerprint: cachedFingerprint
    };
  }

  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  let privateArmored = '';
  let publicArmored = '';

  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    privateArmored = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    publicArmored = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  } else {
    console.log('🔐 [PGP] 放射線科電子署名用 Ed25519 鍵ペアを生成中...');
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519',
      userIDs: [{
        name: '交雄会 だて病院 放射線科',
        email: 'radiology-order@date-hospital.jp'
      }],
      format: 'armored'
    });

    privateArmored = privateKey;
    publicArmored = publicKey;

    fs.writeFileSync(PRIVATE_KEY_PATH, privateArmored, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY_PATH, publicArmored, { mode: 0o644 });
    console.log('✅ [PGP] 鍵ペアを永続化しました: ' + KEYS_DIR);
  }

  cachedPrivateKeyObj = await openpgp.readPrivateKey({ armoredKey: privateArmored });
  cachedPublicKeyObj = await openpgp.readKey({ armoredKey: publicArmored });
  cachedArmoredPublicKey = publicArmored;
  cachedKeyId = cachedPublicKeyObj.getKeyID().toHex().toUpperCase();
  cachedFingerprint = cachedPublicKeyObj.getFingerprint().toUpperCase();

  return {
    privateKey: cachedPrivateKeyObj,
    publicKey: cachedPublicKeyObj,
    armoredPublicKey: cachedArmoredPublicKey,
    keyId: cachedKeyId,
    fingerprint: cachedFingerprint
  };
}

/**
 * 📋 2. オーダーの正規化ペイロード生成 (決定論的JSON)
 */
function createCanonicalPayload(order) {
  const schedDateStr = order.scheduledDate ? new Date(order.scheduledDate).toISOString() : '';
  const orderDateStr = order.orderDate ? new Date(order.orderDate).toISOString() : '';

  // ソートされたキーで正規化オブジェクトを構成
  const canonicalObj = {
    birthDate: order.birthDate || '',
    conditions: {
      kv: order.conditions?.kv || '',
      ma: order.conditions?.ma || '',
      sec: order.conditions?.sec || ''
    },
    contrast: order.contrast || '',
    doctorName: order.doctorName || '',
    elecImgAdd: !!order.elecImgAdd,
    examType: order.examType || '',
    formType: order.formType || '',
    gender: order.gender || '',
    hospital: '交雄会 だて病院',
    isPortable: !!order.isPortable,
    medications: order.medications || '',
    mobility: order.mobility || '',
    orderDate: orderDateStr,
    orderNumber: order.orderNumber || '',
    parts: Array.isArray(order.parts) ? [...order.parts].sort() : [],
    partsDetail: order.partsDetail || '',
    patientId: order.patientId || '',
    patientName: order.patientName || '',
    portableRoom: order.portableRoom || '',
    purpose: order.purpose || '',
    requestDepartment: order.requestDepartment || '',
    scheduledDate: schedDateStr,
    ward: order.ward || ''
  };

  const canonicalJson = JSON.stringify(canonicalObj);
  const hash = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');

  return { canonicalJson, hash };
}

/**
 * ✍️ 3. 放射線オーダーへのPGP電子署名
 */
async function signRadiologyOrder(order) {
  const { privateKey, keyId, fingerprint } = await initKeys();
  const { canonicalJson, hash } = createCanonicalPayload(order);

  const message = await openpgp.createMessage({ text: canonicalJson });
  const detachedSignature = await openpgp.sign({
    message,
    signingKeys: privateKey,
    detached: true
  });

  const signerInfo = `交雄会だて病院 放射線科 (担当医: ${order.doctorName || '医師'}) [KeyID: ${keyId}]`;
  const signedAt = new Date();

  return {
    isSigned: true,
    signature: detachedSignature,
    payloadHash: hash,
    canonicalPayload: canonicalJson,
    keyId: keyId,
    fingerprint: fingerprint,
    signer: signerInfo,
    signedAt: signedAt,
    algorithm: 'Ed25519 (OpenPGP)',
    verifiedAt: signedAt
  };
}

/**
 * 🔍 4. PGP電子署名とオーダー内容の真正性検証
 */
async function verifyRadiologyOrder(order) {
  try {
    if (!order.pgp || !order.pgp.isSigned || !order.pgp.signature) {
      return {
        isValid: false,
        reason: 'オーダーにPGP電子署名が付与されていません。'
      };
    }

    const { publicKey } = await initKeys();
    const { canonicalJson, hash } = createCanonicalPayload(order);

    // 1. ハッシュの改ざんチェック
    const isHashMatched = (hash === order.pgp.payloadHash);

    // 2. OpenPGP 署名の検証
    const message = await openpgp.createMessage({ text: canonicalJson });
    const signatureObj = await openpgp.readSignature({ armoredSignature: order.pgp.signature });

    const verificationResult = await openpgp.verify({
      message,
      signature: signatureObj,
      verificationKeys: publicKey
    });

    const { verified, keyID } = verificationResult.signatures[0];
    await verified; // エラーがなければ署名有効

    return {
      isValid: true,
      isHashMatched,
      keyId: keyID.toHex().toUpperCase(),
      fingerprint: order.pgp.fingerprint,
      signedAt: order.pgp.signedAt,
      signer: order.pgp.signer,
      payloadHash: hash,
      verifiedAt: new Date()
    };
  } catch (err) {
    return {
      isValid: false,
      reason: 'PGP電子署名の検証に失敗しました (改ざんまたは署名不整合): ' + err.message
    };
  }
}

/**
 * 📱 5. 検証用QRコード DataURL 生成
 */
async function generateVerificationQr(verifyUrl) {
  try {
    return await qrcode.toDataURL(verifyUrl, {
      margin: 1,
      width: 110,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('QR生成エラー:', err);
    return '';
  }
}

/**
 * 📜 6. 公開鍵 (ASCII Armored) の取得
 */
async function getPublicKeyArmored() {
  const { armoredPublicKey, fingerprint, keyId } = await initKeys();
  return { armoredPublicKey, fingerprint, keyId };
}

module.exports = {
  initKeys,
  createCanonicalPayload,
  signRadiologyOrder,
  verifyRadiologyOrder,
  generateVerificationQr,
  getPublicKeyArmored
};
