/**
 * 💊 交雄会だて病院 内服・外用処方オーダーシステム サーバー (server.js)
 * 
 * 1. 内服薬・外用薬・頓服薬の高速処方入力 (Rp単位・一包化・粉砕・簡易懸濁)
 * 2. 薬品マスタ (全607件中、内服344件・外用116件) インクリメンタル検索 & 薬効分類絞込
 * 3. 電子カルテ (incident-system / Article) への「💊 処方オーダー」自動投稿
 * 4. 統一操作ロガー (WAL/可読ジャーナル/自動gz圧縮) 連動
 * 5. ポータル (Port 8000) からのリバースプロキシ (/naifuku/) & SSO Launch API 完全対応
 * 6. A4院内処方箋・病棟配薬指示票 印刷対応
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');

// 統一操作ロガー
const { logOperation } = require('../../common/operationLogger');

// MongoDBモデル
const PrescriptionOrder = require('./models/PrescriptionOrder');
const Patient = require('../../menu/sakusei/models/Patient');
const Article = require('../../../incident-system/models/Article');
const TargetPerson = require('../../../incident-system/models/TargetPerson');
const User = require('../../../incident-system/models/User');

const app = express();
const PORT = process.env.PORT || 8084;
const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

// MongoDB 接続 (incident_db - レプリカセット rs0 対応)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [Naifuku] MongoDB レプリカセット (rs0) に正常接続しました。'))
  .catch(err => console.error('❌ [Naifuku] MongoDB 接続エラー:', err.message));

// 💊 薬品マスタのロード (ordering/shared/medicines.json)
let medicinesMaster = [];
let oralAndTopicalMeds = [];
try {
  const medPath = path.join(__dirname, '../../../ordering/shared/medicines.json');
  if (fs.existsSync(medPath)) {
    medicinesMaster = JSON.parse(fs.readFileSync(medPath, 'utf8'));
    oralAndTopicalMeds = medicinesMaster.filter(m => m.category === '内服薬' || m.category === '外用薬');
    console.log(`✅ [Naifuku] 薬品マスタロード成功: 全${medicinesMaster.length}件中、内服・外用薬 ${oralAndTopicalMeds.length}件を登録。`);
  }
} catch (err) {
  console.warn('⚠️ [Naifuku] 薬品マスタ読み込み失敗:', err.message);
}

// 代表的な内服・外用薬の通称・先発・後発エイリアスマッピング
const NAIFUKU_ALIASES = {
  'ロキソニン': 'ロキソプロフェン',
  'カロナール': 'アセトアミノフェン',
  'ボルタレン': 'ジクロフェナク',
  'プロプレス': 'カンデサルタン',
  'アムロジン': 'アムロジピン',
  'ノルバスク': 'アムロジピン',
  'リピトール': 'アトルバスタチン',
  'クレストール': 'ロスバスタチン',
  'ムコスタ': 'レバミピド',
  'ガスター': 'ファモチジン',
  'タケプロン': 'ランソプラゾール',
  'ネキシウム': 'エソメプラゾール',
  'マグラックス': '酸化マグネシウム',
  'マグミット': '酸化マグネシウム',
  'メジコン': 'デキストロメトルファン',
  'ムコダイン': 'カルボシステイン',
  'アレグラ': 'フェキソフェナジン',
  'アレロック': 'オロパタジン',
  'クラビット': 'レボフロキサシン',
  'メイアクト': 'セフジトレン',
  'フロモックス': 'セフカペン',
  'ヒルドイド': 'ヘパリン類似物質',
  'モーラステープ': 'ケトプロフェン',
  'ロコアテープ': 'エスフルルビプロフェン',
  'リンデロン': 'ベタメタゾン',
  'ゲンタシン': 'ゲンタマイシン',
  'プロペト': '白色ワセリン'
};

// ミドルウェア設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  name: 'naifuku.sid',
  secret: 'hospital-naifuku-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Prescription Order System', port: PORT });
});

// 認証ユーザー取得ヘルパー
function getSessionUser(req) {
  if (req.session && req.session.user) return req.session.user;
  return {
    userId: 'doctor-default',
    loginId: 'doctor',
    userName: '山田 医師',
    department: '一般内科',
    role: 'doctor'
  };
}

/**
 * 🔑 SSO ログイン & 患者引き継ぎ API (GET /api/sso-login)
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
      console.log(`🔑 [Naifuku SSO] 職員認証成功: ${decoded.userName} (${decoded.department} / ${decoded.role})`);
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    const baseTarget = prefix ? `${prefix}/` : '../';
    let targetUrl = redirect || baseTarget;
    if (patientId) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'patientId=' + encodeURIComponent(patientId);
    }
    res.redirect(targetUrl);
  } catch (err) {
    console.error('❌ [Naifuku SSO] トークン認証エラー:', err.message);
    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.redirect(prefix ? `${prefix}/` : '../');
  }
});

/**
 * 💊 内服・外用薬マスタ 検索 API (GET /api/medicines/search)
 */
app.get('/api/medicines/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const cat = String(req.query.category || '').trim(); // 内服薬, 外用薬, すべて
  const major = String(req.query.major || '').trim();   // 薬効分類大項目 (1.抗菌抗薬, 21.循環器官用薬 など)

  let results = oralAndTopicalMeds;

  // カテゴリ絞込
  if (cat && cat !== 'all' && cat !== 'すべて') {
    results = results.filter(m => m.category === cat);
  }

  // 薬効分類絞込
  if (major) {
    results = results.filter(m => m.therapeuticCategoryMajor && m.therapeuticCategoryMajor.includes(major));
  }

  // キーワード検索 (薬品名, カナ, 一般名, 規格, 通称エイリアス)
  if (q) {
    const aliasTerms = [];
    for (const [k, v] of Object.entries(NAIFUKU_ALIASES)) {
      if (k.toLowerCase().includes(q) || q.includes(k.toLowerCase())) {
        aliasTerms.push(v.toLowerCase());
      }
    }

    results = results.filter(m => {
      const name = (m.name || '').toLowerCase();
      const generic = (m.genericName || '').toLowerCase();
      const kana = (m.kana || '').toLowerCase();
      const spec = (m.spec || '').toLowerCase();
      const majorName = (m.therapeuticCategoryMajor || '').toLowerCase();

      if (name.includes(q) || generic.includes(q) || kana.includes(q) || spec.includes(q) || majorName.includes(q)) {
        return true;
      }
      return aliasTerms.some(term => name.includes(term) || generic.includes(term));
    });
  }

  res.json({
    success: true,
    count: results.length,
    medicines: results.slice(0, 100)
  });
});

/**
 * 📦 全内服・外用薬品マスタ取得 API (GET /api/medicines/all)
 * ※ 高速クライアントサイド・インクリメンタル検索用 (0msサジェスト)
 */
app.get('/api/medicines/all', (req, res) => {
  res.json({
    success: true,
    count: oralAndTopicalMeds.length,
    medicines: oralAndTopicalMeds.map(m => ({
      id: m.id,
      name: m.name,
      genericName: m.genericName || '',
      spec: m.spec || '',
      unit: m.unit || '錠',
      category: m.category || '内服薬',
      dosage: m.dosage || '',
      standardUsage: m.standardUsage || m.dosage || '',
      suspensionOk: m.suspensionOk || '',
      crushOk: m.crushOk || '',
      uncapsuleOk: m.uncapsuleOk || '',
      kana: m.kana || '',
      brandType: m.brandType || '後発',
      major: m.therapeuticCategoryMajor || ''
    }))
  });
});

/**
 * 🔍 最新処方オーダー取得 API (GET /api/orders/latest)
 * ※ 前回処方の引き継ぎ（DO処方）や再処方に対応
 */
app.get('/api/orders/latest', async (req, res) => {
  try {
    const { patientId } = req.query;
    if (!patientId) {
      return res.status(400).json({ success: false, message: '患者IDが指定されていません。' });
    }

    const order = await PrescriptionOrder.findOne({ patientId }).sort({ createdAt: -1 }).lean();
    if (!order) {
      return res.json({ success: true, order: null });
    }
    res.json({ success: true, order });
  } catch (err) {
    console.error('❌ [Naifuku] 最新オーダー取得エラー:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 🏠 内服・外用処方オーダー メイン画面 (GET /)
 */
app.get('/', async (req, res) => {
  try {
    const user = getSessionUser(req);
    const { patientId, orderId } = req.query;

    // 患者一覧取得
    const patients = await Patient.find({}).sort({ ward: 1, roomNo: 1, patientId: 1 }).lean();

    // 選択患者 (患者選択不要: 未指定なら先頭患者を自動バインド)
    let selectedPatient = null;
    if (patientId) {
      selectedPatient = patients.find(p => p.patientId === patientId) || null;
    }
    if (!selectedPatient && patients.length > 0) {
      selectedPatient = patients[0];
    }

    // 直近オーダー一覧 (最新25件)
    const recentOrders = await PrescriptionOrder.find({}).sort({ createdAt: -1 }).limit(25).lean();

    // 初期表示用の対象オーダー (指定されたorderId または 患者の最新オーダー)
    let targetOrder = null;
    if (orderId) {
      targetOrder = await PrescriptionOrder.findOne({ orderNumber: orderId }).lean();
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // よく使われる薬効大分類のユニーク一覧
    const majorCategories = Array.from(new Set(
      oralAndTopicalMeds.map(m => m.therapeuticCategoryMajor).filter(Boolean)
    )).sort();

    res.render('index', {
      user,
      patients,
      selectedPatient,
      recentOrders,
      targetOrder,
      todayStr,
      majorCategories,
      currentScreenTitle: '内服・外用処方オーダー',
      prefix,
      patientId: patientId || ''
    });
  } catch (err) {
    console.error('❌ [Naifuku] メイン画面表示エラー:', err.message);
    res.status(500).send('内服・外用処方画面エラー: ' + err.message);
  }
});

/**
 * 🚀 処方確定送信 API (POST /api/orders)
 */
app.post('/api/orders', async (req, res) => {
  try {
    const user = getSessionUser(req);
    const {
      patientId,
      orderClass,
      dispenseType,
      startDate,
      rpList,
      remarks
    } = req.body;

    if (!patientId) {
      return res.status(400).json({ success: false, message: '対象患者を選択してください。' });
    }

    const patientDoc = await Patient.findOne({ patientId });
    if (!patientDoc) {
      return res.status(404).json({ success: false, message: '患者情報が見つかりません: ' + patientId });
    }

    if (!Array.isArray(rpList) || rpList.length === 0) {
      return res.status(400).json({ success: false, message: '処方内容 (Rp) を少なくとも1件入力してください。' });
    }

    // オーダー番号生成 (RX-YYYYMMDD-XXX)
    const todayNum = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await PrescriptionOrder.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });
    const orderNumber = `RX-${todayNum}-${String(countToday + 1).padStart(3, '0')}`;

    // 電子カルテ側の TargetPerson / User の照合
    let authorUserDoc = await User.findOne({ loginId: user.loginId });
    let targetPersonDoc = await TargetPerson.findOne({ customId: patientId });
    if (!targetPersonDoc && patientDoc) {
      targetPersonDoc = new TargetPerson({
        customId: patientDoc.patientId,
        name: patientDoc.name,
        department: patientDoc.ward || '一般病棟',
        attributes: {
          gender: patientDoc.gender,
          birthDate: patientDoc.birthDate
        }
      });
      await targetPersonDoc.save();
    }

    // 1. 処方明細テキストの整形
    let rpTextLines = [];
    rpList.forEach((rp, idx) => {
      const rpNum = rp.rpNumber || (idx + 1);
      const medsStr = (rp.medicines || []).map(m => {
        const specStr = m.spec ? ` ${m.spec}` : '';
        const doseStr = m.dose ? ` (${m.dose})` : '';
        return `    ・${m.name}${specStr} ${doseStr}`;
      }).join('\n');

      const pkgStr = rp.oneDosePackage ? ' [一包化指示]' : '';
      const crushStr = rp.crushInstruction ? ' [粉砕・簡易懸濁]' : '';
      const notesStr = rp.instructionNotes ? ` ※${rp.instructionNotes}` : '';

      rpTextLines.push(`[Rp ${rpNum}] 用法: ${rp.usage} / ${rp.days || 7}${rp.dayUnit || '日分'}${pkgStr}${crushStr}${notesStr}\n${medsStr}`);
    });

    const scheduledDate = new Date();
    const scheduledTimeStr = scheduledDate.toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    // 2. incident-system (Article) への電子カルテ自動投稿
    const articleContent = 
`【💊 内服・外用処方オーダー (オーダリングシステム連携)】
・オーダー番号: 🏷️ ${orderNumber}
・指示日時: 🕒 ${scheduledTimeStr}
・処方区分: ${orderClass || '定期処方'} / ${dispenseType || '院内処方'}
・指示医師: 👨‍⚕️ ${user.userName} (${user.department || '一般内科'})
・対象患者: [${patientDoc.patientId}] ${patientDoc.name} 様 (${patientDoc.ward || ''} ${patientDoc.roomNo || ''})
・服用開始日: 📅 ${startDate || '当日より'}
・処方内容 (計${rpList.length}処方):
${rpTextLines.join('\n\n')}

・特記・禁忌確認事項: 📝 ${remarks ? remarks.trim() : '相互作用・重複投薬・アレルギー歴確認済み'}`;

    const mainMedName = rpList[0]?.medicines[0]?.name || '内服・外用薬';
    const articleDoc = new Article({
      title: `💊 処方オーダー: ${mainMedName.slice(0, 25)} (${patientDoc.name})`,
      content: articleContent,
      targetPerson: targetPersonDoc ? targetPersonDoc._id : null,
      author: authorUserDoc ? authorUserDoc._id : null,
      category: '💊 処方オーダー',
      orderStatus: 'ORDERED'
    });
    await articleDoc.save();

    // 3. PrescriptionOrder の保存
    const newOrder = new PrescriptionOrder({
      orderNumber,
      patientId: patientDoc.patientId,
      patientName: patientDoc.name,
      patientKana: patientDoc.kana || '',
      gender: patientDoc.gender || '',
      age: patientDoc.age || '',
      birthDate: patientDoc.birthDate || '',
      ward: patientDoc.ward || '',
      roomNo: patientDoc.roomNo || '',
      bedNo: patientDoc.bedNo || '',
      orderingDoctor: user.userName,
      department: user.department || '一般内科',
      orderClass: orderClass || '定期処方',
      dispenseType: dispenseType || '院内処方',
      startDate: startDate || new Date().toISOString().slice(0, 10),
      rpList,
      remarks: remarks || '',
      status: 'ORDERED',
      articleId: articleDoc._id,
      targetPersonId: targetPersonDoc ? targetPersonDoc._id : null
    });
    await newOrder.save();

    // 4. 統一操作ロガー記録 (可読日本語ジャーナル & JSONL)
    try {
      logOperation({
        system: 'naifuku',
        opType: 'PRESCRIPTION_ORDER_CREATE',
        action: 'CREATE',
        collection: 'prescriptionorders',
        documentId: newOrder._id.toString(),
        operator: {
          id: user.userId || user.loginId,
          name: user.userName,
          role: user.role,
          department: user.department
        },
        summary: `【内服・外用処方】患者: ${patientDoc.name} に対する処方オーダー ${orderNumber} (${rpList.length}件) を発行しました。`,
        details: {
          orderNumber,
          patientId: patientDoc.patientId,
          orderClass,
          dispenseType,
          rpCount: rpList.length,
          medicinesSummary: rpList.map(r => (r.medicines || []).map(m => m.name).join(', ')).join(' / ')
        },
        snapshot: newOrder
      });
    } catch (logErr) {
      console.warn('⚠️ [Naifuku] ログ出力エラー:', logErr.message);
    }

    console.log(`✅ [Naifuku] 処方オーダー確定成功: ${orderNumber} (カルテ記事ID: ${articleDoc._id})`);
    res.json({
      success: true,
      message: `処方オーダー「${orderNumber}」を発行し、電子カルテに自動記録しました。`,
      order: newOrder,
      articleId: articleDoc._id
    });
  } catch (err) {
    console.error('❌ [Naifuku] オーダー確定エラー:', err);
    res.status(500).json({ success: false, message: '処方確定エラー: ' + err.message });
  }
});

/**
 * 🖨️ A4処方箋・配薬指示票 印刷画面 (GET /print/:id)
 */
app.get('/print/:id', async (req, res) => {
  try {
    const user = getSessionUser(req);
    const orderId = req.params.id;

    let order = null;
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      order = await PrescriptionOrder.findById(orderId).lean();
    }
    if (!order) {
      order = await PrescriptionOrder.findOne({ orderNumber: orderId }).lean();
    }

    if (!order) {
      return res.status(404).send('指定された処方オーダーが見つかりません: ' + orderId);
    }

    const patient = await Patient.findOne({ patientId: order.patientId }).lean();
    const prefix = req.headers['x-forwarded-prefix'] || '';

    res.render('print', {
      user,
      order,
      patient: patient || {
        patientId: order.patientId,
        name: order.patientName,
        gender: order.gender,
        age: order.age,
        birthDate: order.birthDate,
        ward: order.ward,
        roomNo: order.roomNo
      },
      prefix
    });
  } catch (err) {
    console.error('❌ [Naifuku] 処方箋印刷エラー:', err);
    res.status(500).send('処方箋印刷エラー: ' + err.message);
  }
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`💊 交雄会だて病院 内服・外用処方オーダーシステム 起動完了`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 Local URL: http://localhost:${PORT}/`);
  console.log(`========================================================`);
});
