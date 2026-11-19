/**
 * 💉 交雄会だて病院 注射・点滴オーダー発行・指示箋・ボトルラベル印刷・カルテ連携 サーバー (server.js)
 * 
 * 1. 注射・点滴オーダー入力 (輸液・混注薬剤・速度・経路・指示)
 * 2. incident-system (電子カルテ / Article.ivOrderDetails) との双方向自動記録連携
 * 3. 医療統合ポータル (menu / Port 8000) との SSO & リバースプロキシ連携
 * 4. 注射指示箋 & 輸液ボトル・シリンジ貼付用ラベル印刷
 * 5. 統一操作ロガー (common/operationLogger.js) による監査証跡と復元性保証
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');

// 💊 薬品マスタのロード (ordering/shared/medicines.json)
let medicinesMaster = [];
try {
  const medPath = path.join(__dirname, '../../../ordering/shared/medicines.json');
  if (fs.existsSync(medPath)) {
    medicinesMaster = JSON.parse(fs.readFileSync(medPath, 'utf8'));
    console.log(`✅ [Injection] 薬品マスタ ${medicinesMaster.length} 件をロードしました。`);
  }
} catch (err) {
  console.warn('⚠️ [Injection] 薬品マスタ読み込み失敗:', err.message);
}

// モデル
const InjectionOrder = require('./models/InjectionOrder');
const Patient = require('/home/a/src/github.com/datebyoai-a11y/agy-project/support/menu/sakusei/models/Patient');
const Article = require('/home/a/src/github.com/datebyoai-a11y/agy-project/incident-system/models/Article');
const TargetPerson = require('/home/a/src/github.com/datebyoai-a11y/agy-project/incident-system/models/TargetPerson');
const User = require('/home/a/src/github.com/datebyoai-a11y/agy-project/incident-system/models/User');

// 📜 統一操作・監査ロガー
const { logOperation } = require('../../common/operationLogger');

const app = express();
const PORT = process.env.PORT || 8082;
const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

// MongoDB 接続 (incident_db - レプリカセット rs0 対応)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [Injection] MongoDB レプリカセット (rs0) に正常接続しました。'))
  .catch(err => console.error('❌ [Injection] MongoDB 接続エラー:', err.message));

// ミドルウェア設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  name: 'injection.sid',
  secret: 'injection-order-session-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Injection & IV Ordering System', port: PORT });
});

/**
 * 🔑 SSO ログイン & 患者連携 API (GET /api/sso-login)
 * 医療統合ポータル (/sso/launch?app=injection) からの認証トークンを受け取り、セッションを確立
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
      console.log(`🔑 [Injection SSO] 職員認証成功: ${decoded.userName} (${decoded.department} / ${decoded.role})`);
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    const baseTarget = prefix ? `${prefix}/` : '../';
    let targetUrl = redirect || baseTarget;
    if (patientId) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'patientId=' + encodeURIComponent(patientId);
    }
    res.redirect(targetUrl);
  } catch (err) {
    console.error('❌ [Injection SSO] トークン認証エラー:', err.message);
    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.redirect(prefix ? `${prefix}/` : '../');
  }
});

// 認証チェックヘルパー
function getSessionUser(req) {
  if (req.session && req.session.user) return req.session.user;
  // デフォルト医師アカウント（未認証・開発時のフォールバック）
  return {
    userId: 'doctor-default',
    loginId: 'doctor',
    userName: '山田 医師',
    department: '内科',
    role: 'doctor'
  };
}

/**
 * 🏠 注射・点滴オーダー メイン画面 (GET /)
 */
app.get('/', async (req, res) => {
  try {
    const user = getSessionUser(req);
    const { patientId, startDate, orderId } = req.query;

    // 患者マスタ一覧取得
    const patients = await Patient.find({}).sort({ ward: 1, roomNo: 1, patientId: 1 }).lean();
    
    // 最近のオーダー一覧取得 (直近30件)
    const recentOrders = await InjectionOrder.find({}).sort({ createdAt: -1 }).limit(30).lean();

    // 選択中の患者取得
    let selectedPatient = null;
    if (patientId) {
      selectedPatient = patients.find(p => p.patientId === patientId) || null;
    }

    // 既存オーダーの特定 (指定されたorderId、または対象患者の最新オーダー)
    let targetOrder = null;
    if (orderId) {
      targetOrder = await InjectionOrder.findOne({ orderNumber: orderId }).lean();
    } else if (selectedPatient) {
      targetOrder = await InjectionOrder.findOne({ patientId: selectedPatient.patientId }).sort({ createdAt: -1 }).lean();
    }

    const now = new Date();
    const curDay = now.getDate();
    const defaultStartDay = curDay >= 16 ? 16 : 1;
    const defaultStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(defaultStartDay).padStart(2, '0')}`;
    const initialStartDate = startDate || defaultStartStr;
    const prefix = req.headers['x-forwarded-prefix'] || '';

    // 注射剤中心の初期候補リスト (最大100件)
    const injectionMeds = medicinesMaster
      .filter(m => m.category === '注射剤' || (m.name && (m.name.includes('注') || m.name.includes('輸液'))))
      .slice(0, 100);

    res.render('index', {
      user,
      patients,
      recentOrders,
      selectedPatient,
      targetOrder,
      initialStartDate,
      injectionMeds,
      currentScreenTitle: '注射指示箋 (原本様式)',
      prefix,
      patientId: patientId || ''
    });
  } catch (err) {
    console.error('❌ [Injection] メイン画面表示エラー:', err.message);
    res.status(500).send('システムエラーが発生しました: ' + err.message);
  }
});

// 代表的な注射薬の先発・後発・通称エイリアスマッピング (医師・看護師の利便性向上)
const INJECTION_ALIASES = {
  'プリンペラン': 'メトクロプラミド',
  'ロセフィン': 'セフトリアキソン',
  '生食': '生理食塩',
  '生理食塩水': '生理食塩液',
  'ユナシン': 'スルバシリン',
  'ビタミンc': 'アスコルビン酸',
  'ビタミンb': 'ビーフリード',
  'メロペン': 'メロペネム',
  'バンコ': 'バンコマイシン',
  'ゾビラックス': 'アシクロビル',
  'カロナール': 'アセリオ',
  'ボスミン': 'アドレナリン',
  'ノルアド': 'ノルアドレナリン',
  'ラシックス': 'フロセミド',
  'セルシン': 'ジアゼパム',
  'ホリゾン': 'ジアゼパム',
  'アタラックス': 'ヒドロキシジン',
  'ガスター': 'ファモチジン',
  'メイロン': '炭酸水素ナトリウム',
  'ブスコパン': 'ブチルスコポラミン',
  'マグネゾール': '硫酸マグネシウム'
};

/**
 * 💉 注射薬マスタ 検索 API (GET /api/medicines/search)
 * 注射指示箋専用のため、常時「注射剤」のみに完全限定して検索・抽出 (内服薬・外用薬は完全除外)
 */
app.get('/api/medicines/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const subcat = String(req.query.subcategory || '').trim().toLowerCase();

  // 注射薬のみを厳格に抽出 (全147件の注射剤・輸液)
  let results = medicinesMaster.filter(m => m.category === '注射剤' || (m.name && (m.name.includes('注') || m.name.includes('輸液'))));

  if (subcat) {
    results = results.filter(m => {
      const name = (m.name || '').toLowerCase();
      const generic = (m.genericName || '').toLowerCase();
      return name.includes(subcat) || generic.includes(subcat);
    });
  }

  if (q) {
    // 通称・先発品名エイリアスの解決
    const aliasTerms = [];
    for (const [aliasKey, aliasTarget] of Object.entries(INJECTION_ALIASES)) {
      if (q.includes(aliasKey.toLowerCase()) || aliasKey.toLowerCase().includes(q)) {
        aliasTerms.push(aliasTarget.toLowerCase());
      }
    }

    results = results.filter(m => {
      const name = (m.name || '').toLowerCase();
      const generic = (m.genericName || '').toLowerCase();
      const kana = (m.kana || '').toLowerCase();
      const spec = (m.spec || '').toLowerCase();

      const directMatch = name.includes(q) || generic.includes(q) || kana.includes(q) || spec.includes(q);
      if (directMatch) return true;

      // エイリアス一致
      return aliasTerms.some(term => name.includes(term) || generic.includes(term));
    });
  }
  res.json({ success: true, count: results.length, medicines: results.slice(0, 100) });
});

/**
 * 📦 クイック薬剤プリセット定義 API (GET /api/presets)
 */
app.get('/api/presets', (req, res) => {
  const presets = [
    {
      category: '基本維持輸液',
      name: 'ソルデム3A 500mL (1日2本 80mL/h)',
      mainMedicine: 'ソルデム3A輸液 500mL',
      dose: '1本 (500mL)',
      rate: '80 mL/h (約6時間)',
      route: '点滴静注 (DIV)',
      mixed: [],
      remarks: '末梢静脈路より滴下。刺入部の発赤・腫脹に注意。'
    },
    {
      category: '電解質・末梢栄養',
      name: 'ビーフリード輸液 500mL (ビタミンB1配合)',
      mainMedicine: 'ビーフリード輸液 500mL',
      dose: '1本 (500mL)',
      rate: '100 mL/h (約5時間)',
      route: '点滴静注 (DIV)',
      mixed: [],
      remarks: '遮光カバー推奨。血糖値・静脈炎に留意。'
    },
    {
      category: '抗生剤・抗菌薬',
      name: 'ロセフィン静注用1g + 生食100mL (30分点滴)',
      mainMedicine: '生理食塩液 100mL',
      dose: '1本 (100mL)',
      rate: '30分で全量滴下',
      route: '点滴静注 (DIV)',
      mixed: [{ medicineName: 'ロセフィン静注用1g', dose: '1バイアル', timing: 'ボトル全量混注' }],
      remarks: '点滴開始直後のアナフィラキシー、皮疹等に注意。'
    },
    {
      category: '抗生剤・抗菌薬',
      name: 'ユナシン-S静注用1.5g + 生食100mL (1日2回)',
      mainMedicine: '生理食塩液 100mL',
      dose: '1本 (100mL)',
      rate: '40分で滴下',
      route: '点滴静注 (DIV)',
      mixed: [{ medicineName: 'ユナシン-S静注用1.5g', dose: '1バイアル', timing: 'ボトル混注' }],
      remarks: 'ペニシリン系アレルギーの有無を事前再確認。'
    },
    {
      category: '制吐・消化器症状',
      name: 'プリンペラン1A + 生食50mL (悪心・嘔吐時)',
      mainMedicine: '生理食塩液 50mL',
      dose: '1本 (50mL)',
      rate: '20〜30分で緩徐に滴下',
      route: '点滴静注 (DIV)',
      mixed: [{ medicineName: 'プリンペラン注射液10mg (1A)', dose: '1アンプル', timing: '混注' }],
      remarks: '錐体外路症状（振戦・落ち着きのなさ）発現に注意。'
    },
    {
      category: '救急・静注 (One Shot)',
      name: 'ガスター注射液20mg (静注 One Shot)',
      mainMedicine: 'ガスター注射液20mg',
      dose: '1アンプル (20mg)',
      rate: '2分以上かけて緩徐に静注',
      route: '静脈注射 (IV)',
      mixed: [],
      remarks: '急速静注を避け、患者の血圧・気分不快を確認しながら投与。'
    }
  ];
  res.json({ success: true, presets });
});

/**
 * 🔍 患者の確定済み注射指示箋 取得 API (GET /api/orders/latest?patientId=...&startDate=...)
 */
app.get('/api/orders/latest', async (req, res) => {
  try {
    const { patientId, startDate } = req.query;
    if (!patientId) {
      return res.status(400).json({ success: false, message: 'patientId is required' });
    }

    // 指定された開始日 (startDate) が一致する指示箋を優先検索
    if (startDate) {
      const orderSameStart = await InjectionOrder.findOne({ 
        patientId, 
        'sheetData.startDate': startDate 
      }).sort({ createdAt: -1 }).lean();
      if (orderSameStart) {
        return res.json({ success: true, order: orderSameStart });
      }
    }

    // なければ対象患者の最新オーダー
    const latestOrder = await InjectionOrder.findOne({ patientId }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, order: latestOrder || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 📝 注射・点滴オーダー発行 & 既存指示箋への追記確定 API (POST /api/orders)
 * 既存指示箋がある場合は確定段をロックしたまま追記分のみ電子カルテへ自動記録
 */
app.post('/api/orders', async (req, res) => {
  try {
    const user = getSessionUser(req);
    let {
      patientId,
      orderType,
      mainMedicine,
      dose,
      mixedMedicines,
      rate,
      scheduledAt,
      remarks,
      sheetData,
      existingOrderId
    } = req.body;

    // 原本様式 (sheetData) からの情報自動補完
    let sheetRows = [];
    if (sheetData && sheetData.rows && Array.isArray(sheetData.rows)) {
      sheetRows = sheetData.rows.filter(r => r && r.rx && r.rx.trim());
    }

    // ルート名の正規化ヘルパー
    const normalizeOrderType = (rt) => {
      if (!rt) return '点滴静注 (DIV)';
      const s = String(rt).trim().toUpperCase();
      if (s.includes('DIV')) return '点滴静注 (DIV)';
      if (s === 'IV' || s.includes('静脈') || s.includes('静注')) return '静脈注射 (IV)';
      if (s === 'IM' || s.includes('筋注') || s.includes('筋肉')) return '筋肉注射 (IM)';
      if (s === 'IS' || s === 'SC' || s.includes('皮下')) return '皮下注射 (SC)';
      if (s.includes('IVH') || s.includes('中心静脈')) return '中心静脈点滴 (IVH)';
      return rt;
    };

    if (!patientId) {
      return res.status(400).json({ success: false, message: '対象患者を選択してください。' });
    }

    // 患者情報取得
    const patientDoc = await Patient.findOne({ patientId });
    if (!patientDoc) {
      return res.status(404).json({ success: false, message: '患者情報が見つかりません: ' + patientId });
    }

    // 既存オーダーが存在する場合の「追記・追加」判定
    let existingOrder = null;
    if (existingOrderId) {
      if (mongoose.Types.ObjectId.isValid(existingOrderId)) {
        existingOrder = await InjectionOrder.findOne({
          $or: [{ _id: existingOrderId }, { orderNumber: existingOrderId }]
        });
      } else {
        existingOrder = await InjectionOrder.findOne({ orderNumber: existingOrderId });
      }
    }

    const scheduleDate = scheduledAt ? new Date(scheduledAt) : new Date();
    const scheduledTimeStr = scheduleDate.toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    // ログインUserの取得（incident-system側）
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

    // ----------------------------------------------------
    // 【ケースA: 既存指示箋への「追記」更新】
    // ----------------------------------------------------
    if (existingOrder) {
      const oldRowNumbers = new Set((existingOrder.sheetData?.rows || []).map(r => r.rowNumber));
      const newlyAppendedRows = sheetRows.filter(r => !oldRowNumbers.has(r.rowNumber));

      if (newlyAppendedRows.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: '確定済みの指示箋に対して追記された新しい処方がありません。空いている段（行）に処方を追記してください。' 
        });
      }

      const appendedRowsText = newlyAppendedRows.map(r => `  ・[処方${r.rowNumber}] ${r.rx} (${r.route || 'DIV'})`).join('\n');
      const appendArticleContent = 
`【💉 注射指示箋 追記オーダー (既存指示箋へ追記)】
・指示箋番号: 🏷️ ${existingOrder.orderNumber}
・追記指示日時: 🕒 ${scheduledTimeStr}
・指示医師: 👨‍⚕️ ${user.userName} (${user.department || '内科'})
・患者: [${patientDoc.patientId}] ${patientDoc.name} 様 (${patientDoc.ward || ''} ${patientDoc.roomNo || ''})
・今回新しく追記された処方 (計${newlyAppendedRows.length}件):
${appendedRowsText}

※確定済みの既存処方 (計${oldRowNumbers.size}件) は指示箋原本上でロックされ継続中です。`;

      const appendArticleDoc = new Article({
        title: `💉 注射指示箋【追記】: ${newlyAppendedRows[0].rx.slice(0, 30)} (${patientDoc.name})`,
        content: appendArticleContent,
        targetPerson: targetPersonDoc ? targetPersonDoc._id : null,
        author: authorUserDoc ? authorUserDoc._id : null,
        category: '💉 点滴オーダー',
        ivOrderDetails: {
          medicine: newlyAppendedRows.map(r => r.rx).join(' + '),
          dose: '指示箋記載',
          rate: rate || existingOrder.rate || '指示通り',
          route: newlyAppendedRows[0].route || '点滴静注 (DIV)',
          remarks: `既存指示箋 ${existingOrder.orderNumber} への追記`,
          scheduledAt: scheduleDate
        },
        orderStatus: 'ORDERED'
      });
      await appendArticleDoc.save();

      // 既存オーダーの sheetData を安全にマージ更新（確定済みの行データを完全保持）
      const mergedRowsMap = new Map();
      (existingOrder.sheetData?.rows || []).forEach(r => {
        mergedRowsMap.set(r.rowNumber, r);
      });
      newlyAppendedRows.forEach(r => {
        mergedRowsMap.set(r.rowNumber, r);
      });
      const mergedRows = Array.from(mergedRowsMap.values()).sort((a, b) => a.rowNumber - b.rowNumber);

      existingOrder.sheetData = {
        ...(existingOrder.sheetData || {}),
        ...(sheetData || {}),
        rows: mergedRows
      };
      existingOrder.markModified('sheetData');
      existingOrder.updatedAt = new Date();
      await existingOrder.save();

      // 操作ログ記録
      try {
        logOperation({
          system: 'injection',
          opType: 'INJECTION_ORDER_APPEND',
          action: 'UPDATE',
          collection: 'injectionorders',
          documentId: existingOrder._id.toString(),
          operator: {
            id: user.userId || user.loginId,
            name: user.userName,
            role: user.role,
            department: user.department
          },
          summary: `【注射指示箋 追記】患者: ${patientDoc.name} の指示箋 ${existingOrder.orderNumber} へ ${newlyAppendedRows.length} 件の処方を追記。`,
          details: {
            orderNumber: existingOrder.orderNumber,
            appendedRowsCount: newlyAppendedRows.length,
            appendedList: newlyAppendedRows.map(r => r.rx)
          },
          snapshot: existingOrder
        });
      } catch (logErr) {
        console.warn('⚠️ ログ出力警告:', logErr.message);
      }

      console.log(`✅ [Injection] 既存オーダー追記成功: ${existingOrder.orderNumber} (+${newlyAppendedRows.length}件)`);
      return res.json({
        success: true,
        message: `注射指示箋「${existingOrder.orderNumber}」へ${newlyAppendedRows.length}件の処方を追記確定し、電子カルテに記録しました。`,
        order: existingOrder,
        isAppend: true,
        articleId: appendArticleDoc._id
      });
    }

    // ----------------------------------------------------
    // 【ケースB: 新規指示箋オーダーの発行】
    // ----------------------------------------------------
    if (!mainMedicine && sheetRows.length > 0) {
      mainMedicine = sheetRows[0].rx.trim();
      dose = sheetRows[0].dose || '指示通り';
      orderType = normalizeOrderType(sheetRows[0].route || orderType);
      
      if (sheetRows.length > 1 && (!mixedMedicines || mixedMedicines.length === 0)) {
        mixedMedicines = sheetRows.slice(1).map(r => ({
          medicineName: r.rx.trim(),
          dose: r.dose || '1回量',
          timing: normalizeOrderType(r.route) || '混注'
        }));
      }
    } else {
      orderType = normalizeOrderType(orderType);
    }

    if (!mainMedicine) {
      mainMedicine = '注射・点滴指示 (原本様式記載)';
    }

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await InjectionOrder.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });
    const orderNumber = `INJ-${todayStr}-${String(countToday + 1).padStart(3, '0')}`;

    // 混注薬のパース
    let parsedMixed = [];
    if (Array.isArray(mixedMedicines)) {
      parsedMixed = mixedMedicines.filter(m => m && m.medicineName && m.medicineName.trim());
    } else if (typeof mixedMedicines === 'string' && mixedMedicines.trim()) {
      try {
        parsedMixed = JSON.parse(mixedMedicines);
      } catch (_) {
        parsedMixed = [{ medicineName: mixedMedicines.trim(), dose: '', timing: '混注' }];
      }
    }

    // 1. incident-system (Article) への電子カルテ自動投稿
    let articleDoc = null;
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

    // 電子カルテ記事本文の整形
    let mixedText = 'なし';
    if (parsedMixed.length > 0) {
      mixedText = parsedMixed.map(m => `・${m.medicineName} (${m.dose || '規定量'}) [${m.timing || '混注'}]`).join('\n');
    }

    let allRowsText = '';
    if (sheetRows.length > 0) {
      allRowsText = '\n【指示箋 処方一覧 (全' + sheetRows.length + '行)】\n' +
        sheetRows.map((r, idx) => `  [処方${idx+1}] ${r.rx} (${r.route || 'DIV'})`).join('\n');
    }



    const articleContent = 
`【💉 注射指示箋オーダー (原本様式連動)】
・オーダー番号: 🏷️ ${orderNumber}
・指示日時: 🕒 ${scheduledTimeStr}
・指示医師: 👨‍⚕️ ${user.userName} (${user.department || '内科'})
・患者: [${patientDoc.patientId}] ${patientDoc.name} 様 (${patientDoc.ward || ''} ${patientDoc.roomNo || ''})
・投与経路: ${orderType || '点滴静注 (DIV)'}
・主処方: 💊 ${mainMedicine} (${dose || '1本'})
・混注・追加指示:
${mixedText}${allRowsText}
・投与速度・時間: ⏱️ ${rate || '指示通り'}
・指示・特記事項: 📝 ${remarks ? remarks.trim() : '特記事項なし'}`;

    articleDoc = new Article({
      title: `💉 注射指示箋: ${mainMedicine.slice(0, 30)} (${patientDoc.name})`,
      content: articleContent,
      targetPerson: targetPersonDoc ? targetPersonDoc._id : null,
      author: authorUserDoc ? authorUserDoc._id : null,
      category: '💉 点滴オーダー',
      ivOrderDetails: {
        medicine: mainMedicine + (parsedMixed.length > 0 ? ` + 混注(${parsedMixed.map(m=>m.medicineName).join(',')})` : ''),
        dose: dose || '1本',
        rate: rate || '指示通り',
        route: orderType || '点滴静注 (DIV)',
        remarks: remarks || '',
        scheduledAt: scheduleDate
      },
      orderStatus: 'ORDERED'
    });
    await articleDoc.save();

    // 2. InjectionOrder の保存
    const newOrder = new InjectionOrder({
      orderNumber,
      patientId: patientDoc.patientId,
      patientName: patientDoc.name,
      patientKana: patientDoc.kana,
      gender: patientDoc.gender,
      age: patientDoc.age,
      birthDate: patientDoc.birthDate,
      ward: patientDoc.ward,
      roomNo: patientDoc.roomNo,
      bedNo: patientDoc.bedNo,
      orderingDoctor: user.userName,
      department: user.department,
      orderType: orderType || '点滴静注 (DIV)',
      mainMedicine,
      dose: dose || '1本',
      mixedMedicines: parsedMixed,
      rate: rate || '60 mL/h',
      scheduledAt: scheduleDate,
      remarks: remarks || '',
      status: 'ORDERED',
      sheetData: sheetData || null,
      articleId: articleDoc._id,
      targetPersonId: targetPersonDoc ? targetPersonDoc._id : null
    });
    await newOrder.save();

    // 3. 📜 統一操作ロガー記録 (可読日本語ジャーナル & 復元用JSONL)
    try {
      logOperation({
        system: 'injection',
        opType: 'INJECTION_ORDER_CREATE',
        action: 'CREATE',
        collection: 'injectionorders',
        documentId: newOrder._id.toString(),
        operator: {
          id: user.userId || user.loginId,
          name: user.userName,
          role: user.role,
          department: user.department
        },
        summary: `【注射オーダー発行】患者: ${patientDoc.name} (${patientDoc.patientId}) へ「${mainMedicine}」の注射・点滴指示を発行。(オーダーNo: ${orderNumber}, 速度: ${rate})`,
        details: {
          orderNumber,
          orderType,
          mainMedicine,
          dose,
          mixedCount: parsedMixed.length,
          rate,
          scheduledAt: scheduleDate.toISOString(),
          remarks
        },
        snapshot: newOrder
      });
    } catch (logErr) {
      console.warn('⚠️ ログ出力警告:', logErr.message);
    }

    console.log(`✅ [Injection] オーダー作成成功: ${orderNumber} - ${patientDoc.name} (${mainMedicine})`);
    res.json({
      success: true,
      message: `注射オーダー「${orderNumber}」を発行し、カルテに自動記録しました。`,
      order: newOrder,
      articleId: articleDoc._id
    });
  } catch (err) {
    console.error('❌ [Injection] オーダー作成エラー:', err.message);
    res.status(500).json({ success: false, message: 'オーダー作成エラー: ' + err.message });
  }
});

/**
 * 🔄 ステータス更新 API (POST /api/orders/:id/status)
 * PREPARED (調剤済) / EXECUTING (投与開始) / COMPLETED (実施済) / REVERT
 */
app.post('/api/orders/:id/status', async (req, res) => {
  try {
    const user = getSessionUser(req);
    const { id } = req.params;
    const { status, note } = req.body;

    const order = await InjectionOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません。' });
    }

    const prevStatus = order.status;
    order.status = status;

    if (status === 'PREPARED') {
      order.preparedBy = user.userName;
      order.preparedAt = new Date();
    } else if (status === 'COMPLETED' || status === 'EXECUTING') {
      order.executedBy = user.userName;
      order.executedAt = new Date();
      if (note) order.executionNote = note;
    } else if (status === 'ORDERED') {
      // 差し戻し
      order.preparedBy = null;
      order.preparedAt = null;
      order.executedBy = null;
      order.executedAt = null;
    }

    await order.save();

    // 電子カルテ側のステータスも同期更新
    if (order.articleId) {
      try {
        await Article.findByIdAndUpdate(order.articleId, {
          orderStatus: status,
          orderExecution: {
            status: status,
            actor: user.userName,
            note: note || '',
            completedAt: new Date()
          }
        });
      } catch (artErr) {
        console.warn('⚠️ カルテステータス更新警告:', artErr.message);
      }
    }

    // 📜 統一操作ログ
    try {
      logOperation({
        system: 'injection',
        opType: 'INJECTION_STATUS_CHANGE',
        action: 'UPDATE',
        collection: 'injectionorders',
        documentId: order._id.toString(),
        operator: {
          id: user.userId || user.loginId,
          name: user.userName,
          role: user.role,
          department: user.department
        },
        summary: `【注射ステータス変更】オーダー ${order.orderNumber} (${order.patientName}) の状態を [${prevStatus}] ➔ [${status}] に更新。(担当: ${user.userName})`,
        details: {
          orderNumber: order.orderNumber,
          prevStatus,
          newStatus: status,
          note
        },
        snapshot: order
      });
    } catch (_) {}

    res.json({ success: true, message: `ステータスを ${status} に更新しました。`, order });
  } catch (err) {
    console.error('❌ [Injection] ステータス更新エラー:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 🖨️ 注射指示票 ＆ 輸液ボトル貼付ラベル 印刷画面 (GET /print/:id)
 */
app.get('/print/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await InjectionOrder.findById(id).lean();
    if (!order) {
      return res.status(404).send('指定された注射オーダーが見つかりません。');
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.render('print', {
      order,
      prefix
    });
  } catch (err) {
    console.error('❌ [Injection] 伝票印刷エラー:', err.message);
    res.status(500).send('伝票印刷エラー: ' + err.message);
  }
});

// サーバー起動（デフォルトはローカル限定 127.0.0.1 / ポータルHTTPSプロキシ経由）
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`========================================================`);
  console.log(`💉 交雄会だて病院 注射・点滴オーダーシステム 起動完了`);
  console.log(`📡 Bind: ${HOST}:${PORT} (ローカル隔離)`);
  console.log(`========================================================`);
});
