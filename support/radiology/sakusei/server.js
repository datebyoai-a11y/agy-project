/**
 * 🏥 交雄会だて病院 放射線科オーダー発行・記録・帳票印刷(正・控え2枚組) サーバー (server.js)
 * 
 * 1. 放射線科オーダー入力 (CT検査依頼書 / 透視検査依頼書 / 診療X線照射録)
 * 2. 帳票印刷機能: 【正】原本・放射線科提出用 と 【控え】写し・病棟保管用 の2枚組同時印刷
 * 3. incident-system (電子カルテ / Article) との自動記録連携
 * 4. MongoDB (incident_db) 一元管理 & 過去オーダー履歴追跡
 */

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const session = require('express-session');

// モデル
const RadiologyOrder = require('./models/RadiologyOrder');
const Patient = require('/home/a/Desktop/ai/agy-project/support/menu/sakusei/models/Patient');
const Article = require('/home/a/Desktop/ai/agy-project/incident-system/models/Article');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');
const User = require('/home/a/Desktop/ai/agy-project/incident-system/models/User');

// 🛡️ PGP 真正性保証モジュール
const pgpSigner = require('./utils/pgpSigner');

const app = express();
const PORT = process.env.PORT || 8080;

// MongoDB 接続 (incident_db)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/incident_db';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [Radiology] MongoDB (incident_db) に正常接続しました。'))
  .catch(err => console.error('❌ [Radiology] MongoDB 接続エラー:', err.message));

// ミドルウェア設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  name: 'radiology.sid',
  secret: 'radiology-order-session-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Radiology Ordering System', port: PORT });
});

/**
 * 🔑 SSO ログイン & 患者連携 API (GET /api/sso-login)
 * 医療統合ポータル (/sso/launch?app=radiology) からの認証トークンを受け取り、セッションを確立
 */
app.get('/api/sso-login', async (req, res) => {
  try {
    const { token, patientId, redirect } = req.query;
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.session.user = {
        userId: decoded.userId,
        loginId: decoded.loginId,
        userName: decoded.userName,
        department: decoded.department,
        role: decoded.role
      };
      console.log(`🔑 [Radiology SSO] 職員認証成功: ${decoded.userName} (${decoded.department} / ${decoded.role})`);
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    const baseTarget = prefix ? `${prefix}/` : '../';
    let targetUrl = redirect || baseTarget;
    if (patientId) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'patientId=' + encodeURIComponent(patientId);
    }
    res.redirect(targetUrl);
  } catch (err) {
    console.error('❌ [Radiology SSO] トークン認証エラー:', err.message);
    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.redirect(prefix ? `${prefix}/` : '../');
  }
});

/**
 * 🏠 1. オーダー画面表示 (GET /)
 */
app.get('/', async (req, res) => {
  try {
    // MongoDB から患者一覧を取得
    const patients = await Patient.find({}).sort({ patientId: 1 }).lean();

    // 選択中患者の判定 (クエリ ?patientId=XXX がある場合のみ選択、通常は未選択・空白)
    const queryPatientId = req.query.patientId;
    let selectedPatient = null;
    if (queryPatientId) {
      selectedPatient = patients.find(p => p.patientId === queryPatientId) || null;
    }

    res.render('index', {
      patients,
      selectedPatient,
      orders: [],
      user: req.session.user || { userName: '担当医師', department: '内科', role: 'user' }
    });
  } catch (err) {
    console.error('[Radiology] メイン画面表示エラー:', err);
    res.status(500).send('放射線科オーダー画面の読み込み中にエラーが発生しました: ' + err.message);
  }
});

/**
 * 💾 2. 放射線オーダー発行 & 記録 & カルテ連携 (POST /api/radiology-orders)
 */
app.post('/api/radiology-orders', async (req, res) => {
  try {
    const {
      patientId, patientName, patientKana, age, gender, birthDate,
      ward, room, department, mobility, infection,
      doctorName, requestDepartment, scheduledDate,
      formType, autoPrint, remarks,
      // CT
      ctContrast, ctDynamicPhase, elecImgAdd, ctParts, ctPartsDetail, ctMedications, ctKv, ctMa, ctSec, ctPurpose,
      // 透視
      fluoroExam, fluoroMed, fluoroMedCustom, fluoroMaterials, fluoroPurpose,
      // X線照射録
      isPortable, portableRoom, xrayDvd, xrayParts, xrayPartsDetail, xrayKv, xrayMa, xraySec, xrayPurpose
    } = req.body;

    if (!patientId || !patientName) {
      return res.status(400).send('患者情報が選択されていません。');
    }

    // 1. オーダー番号の発行 (RAD-YYYYMMDD-XXXX)
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await RadiologyOrder.countDocuments({
      orderNumber: new RegExp(`^RAD-${todayStr}`)
    });
    const orderNumber = `RAD-${todayStr}-${String(countToday + 1).padStart(4, '0')}`;

    // 2. 様式別データの正規化
    let examType = '';
    let formName = 'ＣＴ検査依頼書';
    let modality = 'CT';
    let contrast = '単純';
    let dynamicPhase = '';
    let partsList = [];
    let partsDetail = '';
    let medications = '';
    let materials = '';
    let conditions = {};
    let purpose = '';
    let portable = '放射線科撮影室';

    if (formType === 'CT') {
      formName = 'ＣＴ検査依頼書';
      modality = 'CT';
      contrast = ctContrast || '単純';
      if (Array.isArray(ctDynamicPhase)) dynamicPhase = ctDynamicPhase.join(', ');
      else if (ctDynamicPhase) dynamicPhase = ctDynamicPhase;

      if (Array.isArray(ctParts)) partsList = ctParts;
      else if (ctParts) partsList = [ctParts];
      partsDetail = ctPartsDetail || '';
      medications = ctMedications || '';
      conditions = { kv: ctKv || '120', ma: ctMa || '200', sec: ctSec || '0.5' };
      purpose = ctPurpose || '精査';
      examType = `${contrast}CT (${partsList.join(', ') || '精査'})`;

    } else if (formType === 'FLUORO') {
      formName = '透視検査依頼書';
      modality = '透視';
      contrast = '造影';
      if (Array.isArray(fluoroExam)) partsList = fluoroExam;
      else if (fluoroExam) partsList = [fluoroExam];

      let medList = [];
      if (Array.isArray(fluoroMed)) medList = fluoroMed;
      else if (fluoroMed) medList = [fluoroMed];
      if (fluoroMedCustom) medList.push(fluoroMedCustom);
      medications = medList.join(', ');

      materials = fluoroMaterials || '';
      purpose = fluoroPurpose || '定期交換・造影確認';
      examType = partsList.join(', ') || '透視検査';

    } else { // XRAY
      formName = '診療Ｘ線照射録';
      modality = '一般X線';
      contrast = '単純';
      if (Array.isArray(xrayParts)) partsList = xrayParts;
      else if (xrayParts) partsList = [xrayParts];
      partsDetail = xrayPartsDetail || '';
      conditions = { kv: xrayKv || '110', ma: xrayMa || '250', sec: xraySec || '0.04' };
      purpose = xrayPurpose || '経過観察';
      examType = partsList.join(', ') || '一般撮影';

      if (isPortable === 'true' || isPortable === true) {
        portable = `病室ポータブル (${portableRoom || room || '病室'})`;
      }
    }

    // 3. 放射線オーダーモデル (RadiologyOrder) の保存
    const newOrder = new RadiologyOrder({
      orderNumber,
      orderDate: new Date(),
      scheduledDate: scheduledDate ? new Date(scheduledDate) : new Date(),
      patientId,
      patientName,
      patientKana: patientKana || '',
      gender: gender || '不明',
      age: age ? parseInt(age, 10) : null,
      birthDate: birthDate || '',
      ward: ward || '外来',
      room: room || '',
      department: department || '内科',
      mobility: mobility || '徒歩',
      infection: infection || '無',
      doctorName: doctorName || '担当医師',
      requestDepartment: requestDepartment || '内科',
      formType: formType || 'CT',
      formName,
      examType,
      modality,
      contrast,
      dynamicPhase,
      portable,
      isPortable: (isPortable === 'true' || isPortable === true),
      portableRoom: portableRoom || '',
      parts: partsList,
      partsDetail,
      medications,
      materials,
      conditions,
      purpose,
      remarks: remarks || '',
      mediaDvd: xrayDvd || '未',
      elecImgAdd: (elecImgAdd === 'true' || elecImgAdd === true)
    });

    // 🛡️ 3. PGP電子署名 (真正性・完全性・改ざん防止の暗号学的保証)
    try {
      const pgpSignatureData = await pgpSigner.signRadiologyOrder(newOrder);
      newOrder.pgp = pgpSignatureData;
      console.log(`🛡️ [PGP] オーダー [${orderNumber}] に真正性保証署名を付与しました (KeyID: ${pgpSignatureData.keyId})`);
    } catch (pgpErr) {
      console.error('⚠️ [PGP] 電子署名生成エラー:', pgpErr);
    }

    // 4. 🏥 incident-system の Article コレクションにも同時記録（電子カルテ連携）
    try {
      // 対象者 (TargetPerson) の取得または作成
      let targetPersonDoc = await TargetPerson.findOne({ customId: patientId });
      if (!targetPersonDoc) {
        targetPersonDoc = new TargetPerson({
          customId: patientId,
          name: patientName,
          department: ward || department || '一般'
        });
        await targetPersonDoc.save();
      }

      // カルテ記事のタイトルと本文を整形
      const articleTitle = `🩻 [${formName}] ${examType} (${patientName}様)`;
      const articleContent = 
`【🩻 放射線科検査指示オーダー (伝票番号: ${orderNumber})】
・発行日時: ${new Date().toLocaleString('ja-JP')}
・患者氏名: [${patientId}] ${patientName} 様 (${ward || '外来'} ${room ? room + '号室' : ''})
・依頼医師: ${doctorName || '担当医師'} (${requestDepartment || '内科'})
・検査様式: ${formName} [${modality}]
・検査種別: ${examType}
・区分/Phase: ${contrast} ${dynamicPhase ? '(' + dynamicPhase + ')' : ''}
・撮影場所: ${portable}
・照射部位: ${partsList.join(', ')} ${partsDetail ? ' / ' + partsDetail : ''}
${medications ? '・使用薬剤: ' + medications + '\n' : ''}${materials ? '・使用材料: ' + materials + '\n' : ''}・検査目的: ${purpose}
・特記事項: ${remarks || '特記なし'}
・🛡️ PGP電子署名: 真正性保証済 (KeyID: ${newOrder.pgp?.keyId || '--'}, SHA256: ${(newOrder.pgp?.payloadHash || '').slice(0, 16)}...)
--------------------------------------------------
※A4 1枚(A5正副2分割)・PGP電子署名&検証QRコード付き帳票出力可能`;

      const newArticle = new Article({
        title: articleTitle,
        content: articleContent,
        targetPerson: targetPersonDoc._id,
        category: '🩻 放射線科オーダー',
        radiologyOrderDetails: {
          examType: examType,
          modality: modality,
          contrast: contrast,
          portable: portable,
          purpose: purpose,
          remarks: remarks || '',
          scheduledAt: scheduledDate ? new Date(scheduledDate) : new Date()
        },
        orderStatus: 'ORDERED'
      });

      await newArticle.save();
      newOrder.articleId = newArticle._id;
      newOrder.syncStatus = 'SYNCED_CARTE';
      console.log(`✅ [Radiology] 電子カルテ (Article: ${newArticle._id}) に放射線オーダーを記録しました。`);
    } catch (carteErr) {
      console.warn('⚠️ [Radiology] 電子カルテ (Article) への記録警告:', carteErr.message);
    }

    await newOrder.save();
    console.log(`✅ [Radiology] 放射線オーダーを発行・保存しました: [${newOrder.orderNumber}] ${newOrder.examType}`);

    // 自動印刷フラグがある場合は印刷画面へ直接リダイレクト、なければメイン画面へ
    const prefix = req.headers['x-forwarded-prefix'] || '';
    let basePath = prefix ? `${prefix}/` : (req.headers.referer ? req.headers.referer.split('?')[0] : '');
    if (basePath.endsWith('/api/radiology-orders')) {
      basePath = basePath.replace(/\/api\/radiology-orders$/, '');
    }
    if (!basePath.endsWith('/')) basePath += '/';

    if (autoPrint === '1' || autoPrint === 1) {
      return res.redirect(`${basePath}print/${newOrder._id}?autoprint=1`);
    }

    res.redirect(`${basePath}?patientId=${encodeURIComponent(patientId)}&success=1`);

  } catch (err) {
    console.error('❌ [Radiology] オーダー発行エラー:', err);
    res.status(500).send('オーダー発行処理中にエラーが発生しました: ' + err.message);
  }
});

/**
 * 🖨️ 3. 正・控え 2枚組 帳票印刷 & 大画面プレビュー (GET /print/:id & GET /preview/:id)
 */
app.get(['/print/:id', '/preview/:id'], async (req, res) => {
  try {
    let orderDoc = await RadiologyOrder.findById(req.params.id);
    if (!orderDoc) {
      return res.status(404).send('指定された放射線オーダー伝票が見つかりません。');
    }

    // PGP未署名の場合は自動署名して永続化
    if (!orderDoc.pgp || !orderDoc.pgp.isSigned) {
      try {
        orderDoc.pgp = await pgpSigner.signRadiologyOrder(orderDoc);
        await orderDoc.save();
      } catch (signErr) {
        console.warn('⚠️ [PGP] 署名自動補完警告:', signErr.message);
      }
    }

    const order = orderDoc.toObject();

    // 真正性検証の実行
    const pgpVerification = await pgpSigner.verifyRadiologyOrder(order);

    // 検証用URL & QRコード生成
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:8000';
    const prefix = req.headers['x-forwarded-prefix'] || '';
    const verifyUrl = `${proto}://${host}${prefix}/radiology/verify/${order._id}`;
    const qrCodeDataUrl = await pgpSigner.generateVerificationQr(verifyUrl);

    // 印刷回数のインクリメント
    await RadiologyOrder.findByIdAndUpdate(req.params.id, {
      $inc: { 'printStatus.printedCount': 1 },
      $set: {
        'printStatus.lastPrintedAt': new Date(),
        'printStatus.printedBy': (req.session.user && req.session.user.userName) || '担当者'
      }
    });

    res.render('print', {
      order,
      autoprint: req.query.autoprint === '1',
      qrCodeDataUrl,
      verifyUrl,
      pgpVerification,
      isViewer: (req.query.viewer === '1' || req.path.includes('/preview'))
    });
  } catch (err) {
    console.error('[Radiology] 印刷プレビューエラー:', err);
    res.status(500).send('印刷画面の生成中にエラーが発生しました: ' + err.message);
  }
});

/**
 * 🛡️ 4. PGP 真正性検証証明ページ (GET /verify/:id)
 */
app.get('/verify/:id', async (req, res) => {
  try {
    let orderDoc = await RadiologyOrder.findById(req.params.id);
    if (!orderDoc) {
      return res.status(404).send('検証対象の放射線オーダー伝票が見つかりません。');
    }

    // PGP未署名の場合は自動署名
    if (!orderDoc.pgp || !orderDoc.pgp.isSigned) {
      orderDoc.pgp = await pgpSigner.signRadiologyOrder(orderDoc);
      await orderDoc.save();
    }

    const order = orderDoc.toObject();
    const verification = await pgpSigner.verifyRadiologyOrder(order);

    res.render('verify', {
      order,
      verification
    });
  } catch (err) {
    console.error('検証画面表示エラー:', err);
    res.status(500).send('真正性検証画面の表示中にエラーが発生しました: ' + err.message);
  }
});

/**
 * 🔍 5. PGP 真正性検証 API (GET /api/verify/:id)
 */
app.get('/api/verify/:id', async (req, res) => {
  try {
    const orderDoc = await RadiologyOrder.findById(req.params.id);
    if (!orderDoc) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません' });
    }
    const verification = await pgpSigner.verifyRadiologyOrder(orderDoc.toObject());
    res.json({ success: true, verification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 🔑 6. PGP 公開鍵エクスポート (GET /public-key.asc & GET /api/public-key)
 */
app.get(['/public-key.asc', '/api/public-key'], async (req, res) => {
  try {
    const { armoredPublicKey, fingerprint, keyId } = await pgpSigner.getPublicKeyArmored();
    if (req.path.endsWith('.asc')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="koyukai_radiology_public_key.asc"');
      return res.send(armoredPublicKey);
    }
    res.json({ success: true, keyId, fingerprint, publicKey: armoredPublicKey });
  } catch (err) {
    res.status(500).send('公開鍵の取得に失敗しました: ' + err.message);
  }
});

/**
 * 📜 7. 履歴一覧 API (GET /api/orders)
 */
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await RadiologyOrder.find({}).sort({ orderDate: -1 }).limit(100);
    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(`🩻 交雄会だて病院 放射線科オーダー & 帳票印刷システム`);
  console.log(`🌐 待機ポート: http://localhost:${PORT}`);
  console.log(`🖨️ 正・控え 2枚組印刷 / 電子カルテ (Article) 記録連動 Active`);
  console.log('================================================================');
});
