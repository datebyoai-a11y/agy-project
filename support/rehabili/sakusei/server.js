/**
 * 🤸 交雄会だて病院 リハビリテーション指示書Ver3.0 発行・印刷・カルテ連携サーバー (server.js)
 * 
 * 1. Excel「リハビリテーション指示書Ver3.0」原本に準拠したオーダー発行
 * 2. 区分（入院・外来）、急変リスク、指示（医学的必要性・頻度・場所）、
 *    理学療法(PT)、作業療法(OT)、言語聴覚療法(ST)、評価、消炎鎮痛の全項目対応
 * 3. A4原本印刷（Web画面および帳票印刷専用レイアウト）
 * 4. incident-system (電子カルテ / Article) への自動記録連携
 * 5. 医療統合ポータル (Port 8000) & オーダリングポータル (Port 4000) とのSSO・リバースプロキシ連携
 * 6. 統一操作ロガー (common/operationLogger.js) による監査証跡記録
 */

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');

// モデル
const RehabilitationOrder = require('./models/RehabilitationOrder');
const Patient = require('/home/a/Desktop/ai/agy-project/support/menu/sakusei/models/Patient');
const Article = require('/home/a/Desktop/ai/agy-project/incident-system/models/Article');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');
const User = require('/home/a/Desktop/ai/agy-project/incident-system/models/User');

// 📜 統一操作・監査ロガー
let logOperation = () => {};
try {
  const loggerModule = require('../../common/operationLogger');
  if (loggerModule && loggerModule.logOperation) {
    logOperation = loggerModule.logOperation;
  }
} catch (e) {
  console.warn('⚠️ [Rehabili] operationLogger ロード失敗:', e.message);
}

const app = express();
const PORT = process.env.PORT || 8083;
const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

// MongoDB 接続 (incident_db - レプリカセット rs0 対応)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [Rehabili] MongoDB レプリカセット (rs0) に正常接続しました。'))
  .catch(err => console.error('❌ [Rehabili] MongoDB 接続エラー:', err.message));

// ミドルウェア設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  name: 'rehabili.sid',
  secret: 'rehabili-order-session-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Rehabilitation Ordering System', port: PORT });
});

// 診断名マスター（Excel原本 Sheet2 より）
const DIAGNOSIS_MASTER = [
  '関節リウマチ',
  '脳梗塞',
  '脳梗塞後遺症',
  '変形性膝関節症（右・左）',
  '肺炎（誤嚥性肺炎）',
  '慢性閉塞性肺疾患（COPD）の急性増悪',
  '肺炎後の廃用症候群',
  '感染症後の廃用症候群'
];

// 認証ユーザー取得ヘルパー
function getSessionUser(req) {
  if (req.session && req.session.user) return req.session.user;
  return {
    userId: 'doctor-rehab',
    loginId: 'doctor',
    userName: '山田 太郎',
    department: '医師',
    role: 'doctor'
  };
}

/**
 * 🔑 SSO ログイン & 患者連携 API (GET /api/sso-login)
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
      console.log(`🔑 [Rehabili SSO] 職員認証成功: ${decoded.userName} (${decoded.department} / ${decoded.role})`);
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    const baseTarget = prefix ? `${prefix}/` : './';
    let targetUrl = redirect || baseTarget;
    if (patientId) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'patientId=' + encodeURIComponent(patientId);
    }
    res.redirect(targetUrl);
  } catch (err) {
    console.error('❌ [Rehabili SSO] トークン認証エラー:', err.message);
    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.redirect(prefix ? `${prefix}/` : './');
  }
});

/**
 * 🏠 リハビリ指示書 メイン画面 (GET /)
 */
app.get('/', async (req, res) => {
  try {
    const user = getSessionUser(req);
    const queryPatientId = req.query.patientId || req.query.targetId || '';

    // 全患者一覧取得 (モーダル用)
    const patients = await Patient.find({}).sort({ ward: 1, roomNo: 1, patientId: 1 }).lean();

    // 対象患者の特定
    let selectedPatient = null;
    if (queryPatientId) {
      selectedPatient = patients.find(p => p.patientId === queryPatientId) || null;
    }
    if (!selectedPatient && patients.length > 0) {
      selectedPatient = patients[0];
    }

    // 該患者の過去のリハビリオーダー履歴
    let orderHistory = [];
    if (selectedPatient) {
      orderHistory = await RehabilitationOrder.find({ patientId: selectedPatient.patientId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const prefix = req.headers['x-forwarded-prefix'] || '';

    res.render('index', {
      user,
      patients,
      selectedPatient,
      orderHistory,
      diagnosisMaster: DIAGNOSIS_MASTER,
      todayStr,
      prefix,
      patientId: selectedPatient ? selectedPatient.patientId : ''
    });
  } catch (err) {
    console.error('❌ [Rehabili] メイン画面表示エラー:', err.message);
    res.status(500).send('リハビリオーダーシステムエラー: ' + err.message);
  }
});

/**
 * 💾 リハビリ指示書 保存 & カルテ連動 API (POST /api/orders)
 */
app.post('/api/orders', async (req, res) => {
  try {
    const user = getSessionUser(req);
    const b = req.body;

    if (!b.patientId || !b.patientName || !b.diagnosisName) {
      return res.status(400).json({ success: false, message: '患者ID、氏名、診断名は必須です。' });
    }

    // オーダー番号採番 (RH-YYYYMMDD-XXXX)
    const datePart = (b.orderDate || new Date().toISOString().split('T')[0]).replace(/-/g, '');
    const countToday = await RehabilitationOrder.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lte: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });
    const orderNumber = `RH-${datePart}-${String(countToday + 1).padStart(4, '0')}`;

    // 新規オーダー作成
    const newOrder = new RehabilitationOrder({
      orderNumber,
      patientId: b.patientId,
      patientName: b.patientName,
      patientGender: b.patientGender || '',
      patientAge: b.patientAge ? parseInt(b.patientAge, 10) : undefined,
      patientBirthDate: b.patientBirthDate || '',
      ward: b.ward || '',
      roomNo: b.roomNo || '',
      patientType: b.patientType || 'inpatient',
      orderDate: b.orderDate || new Date().toISOString().split('T')[0],
      admissionDate: b.admissionDate || '',
      onsetDate: b.onsetDate || '',
      doctorName: b.doctorName || user.userName,
      doctorSignature: b.doctorSignature || '山田 太郎 印',
      diagnosisName: b.diagnosisName,

      // 急変リスク
      riskCirculatory: b.riskCirculatory === 'true' || b.riskCirculatory === true,
      riskRespiratory: b.riskRespiratory === 'true' || b.riskRespiratory === true,
      oxygenFlow: b.oxygenFlow || '',
      riskMedicine: b.riskMedicine === 'true' || b.riskMedicine === true,
      riskJoint: b.riskJoint === 'true' || b.riskJoint === true,
      jointSide: b.jointSide || '',
      jointPart: b.jointPart || '',
      jointOtherText: b.jointOtherText || '',
      riskDementia: b.riskDementia === 'true' || b.riskDementia === true,
      contraindications: b.contraindications || '',

      // 指示
      necessityReason: b.necessityReason || '',
      improvementExpected: b.improvementExpected !== 'false' && b.improvementExpected !== false,
      frequencyPerWeek: b.frequencyPerWeek || '',
      durationMonths: b.durationMonths || '',
      location: b.location || 'ward',
      admissionCategory: b.admissionCategory || '',

      // PT
      pt_rom: b.pt_rom === 'true' || b.pt_rom === true,
      pt_strength: b.pt_strength === 'true' || b.pt_strength === true,
      pt_neuro: b.pt_neuro === 'true' || b.pt_neuro === true,
      pt_balance: b.pt_balance === 'true' || b.pt_balance === true,
      pt_coordination: b.pt_coordination === 'true' || b.pt_coordination === true,
      pt_basicMotion: b.pt_basicMotion === 'true' || b.pt_basicMotion === true,
      pt_transfer: b.pt_transfer === 'true' || b.pt_transfer === true,
      pt_gait: b.pt_gait === 'true' || b.pt_gait === true,
      pt_adl: b.pt_adl === 'true' || b.pt_adl === true,
      pt_adlDetail: b.pt_adlDetail || '',
      pt_wheelchair: b.pt_wheelchair === 'true' || b.pt_wheelchair === true,
      pt_cognition: b.pt_cognition === 'true' || b.pt_cognition === true,

      // OT
      ot_rom: b.ot_rom === 'true' || b.ot_rom === true,
      ot_strength: b.ot_strength === 'true' || b.ot_strength === true,
      ot_gait: b.ot_gait === 'true' || b.ot_gait === true,
      ot_posture: b.ot_posture === 'true' || b.ot_posture === true,
      ot_meal: b.ot_meal === 'true' || b.ot_meal === true,
      ot_dressing: b.ot_dressing === 'true' || b.ot_dressing === true,
      ot_toilet: b.ot_toilet === 'true' || b.ot_toilet === true,
      ot_attention: b.ot_attention === 'true' || b.ot_attention === true,
      ot_executive: b.ot_executive === 'true' || b.ot_executive === true,
      ot_recreation: b.ot_recreation === 'true' || b.ot_recreation === true,
      ot_environment: b.ot_environment === 'true' || b.ot_environment === true,

      // ST
      st_vf: b.st_vf === 'true' || b.st_vf === true,
      st_swallowMeal: b.st_swallowMeal === 'true' || b.st_swallowMeal === true,
      st_swallowPosture: b.st_swallowPosture === 'true' || b.st_swallowPosture === true,
      st_swallowForm: b.st_swallowForm === 'true' || b.st_swallowForm === true,
      st_swallowInstruction: b.st_swallowInstruction === 'true' || b.st_swallowInstruction === true,
      st_swallowRisk: b.st_swallowRisk === 'true' || b.st_swallowRisk === true,
      st_articulation: b.st_articulation === 'true' || b.st_articulation === true,
      st_aphasia: b.st_aphasia === 'true' || b.st_aphasia === true,
      st_suction: b.st_suction === 'true' || b.st_suction === true,

      // 評価
      eval_dementia: b.eval_dementia === 'true' || b.eval_dementia === true,
      eval_walk: b.eval_walk === 'true' || b.eval_walk === true,
      eval_physical: b.eval_physical === 'true' || b.eval_physical === true,
      eval_bodyComp: b.eval_bodyComp === 'true' || b.eval_bodyComp === true,

      // 消炎鎮痛
      sed_massage: b.sed_massage === 'true' || b.sed_massage === true,
      sed_hotpack: b.sed_hotpack === 'true' || b.sed_hotpack === true,
      sed_ssp: b.sed_ssp === 'true' || b.sed_ssp === true,
      sed_medmer: b.sed_medmer === 'true' || b.sed_medmer === true,
      sed_traction: b.sed_traction === 'true' || b.sed_traction === true,
      sed_cervicalWeight: b.sed_cervicalWeight || '',
      sed_lumbarWeight: b.sed_lumbarWeight || '',
      sed_partSide: b.sed_partSide || '',
      sed_partRegion: b.sed_partRegion || '',
      sed_partOther: b.sed_partOther || '',

      status: 'ordered',
      createdUser: {
        userId: user.userId,
        userName: user.userName,
        department: user.department
      }
    });

    // 🩺 電子カルテ (Article) への自動記録連携
    try {
      let targetPersonDoc = await TargetPerson.findOne({ patientId: b.patientId });
      if (!targetPersonDoc) {
        targetPersonDoc = await TargetPerson.findOne({ name: b.patientName });
      }

      let authorUserDoc = await User.findOne({ name: user.userName });
      if (!authorUserDoc) {
        authorUserDoc = await User.findOne({ department: '医師' });
      }

      // カルテ記事本文の構成
      const ptItems = [];
      if (newOrder.pt_rom) ptItems.push('関節可動域訓練(ROM)');
      if (newOrder.pt_strength) ptItems.push('筋力体力増強');
      if (newOrder.pt_neuro) ptItems.push('神経筋促通');
      if (newOrder.pt_balance) ptItems.push('平衡機能改善');
      if (newOrder.pt_coordination) ptItems.push('協調運動');
      if (newOrder.pt_basicMotion) ptItems.push('基本動作訓練');
      if (newOrder.pt_transfer) ptItems.push('移乗動作');
      if (newOrder.pt_gait) ptItems.push('歩行能力向上');
      if (newOrder.pt_adl) ptItems.push(`ADL訓練(${newOrder.pt_adlDetail || '生活全般'})`);
      if (newOrder.pt_wheelchair) ptItems.push('車いす操作');
      if (newOrder.pt_cognition) ptItems.push('認知機能訓練');

      const otItems = [];
      if (newOrder.ot_rom) otItems.push('ROM訓練');
      if (newOrder.ot_strength) otItems.push('筋力維持訓練');
      if (newOrder.ot_gait) otItems.push('歩行訓練');
      if (newOrder.ot_posture) otItems.push('座位/立位保持');
      if (newOrder.ot_meal) otItems.push('食事動作');
      if (newOrder.ot_dressing) otItems.push('更衣-整容-入浴');
      if (newOrder.ot_toilet) otItems.push('排泄動作');
      if (newOrder.ot_attention) otItems.push('注意・記憶');
      if (newOrder.ot_executive) otItems.push('遂行機能');
      if (newOrder.ot_recreation) otItems.push('レクリエーション');
      if (newOrder.ot_environment) otItems.push('生活環境調整');

      const stItems = [];
      if (newOrder.st_vf) stItems.push('嚥下造影(VF)');
      if (newOrder.st_swallowMeal) stItems.push('嚥下・食事支援');
      if (newOrder.st_swallowPosture) stItems.push('姿勢調整');
      if (newOrder.st_swallowForm) stItems.push('食形態評価');
      if (newOrder.st_swallowInstruction) stItems.push('介助指導');
      if (newOrder.st_swallowRisk) stItems.push('誤嚥リスク観察');
      if (newOrder.st_articulation) stItems.push('構音障害改善');
      if (newOrder.st_aphasia) stItems.push('失語症改善');
      if (newOrder.st_suction) stItems.push('サクション');

      const articleTitle = `🤸 リハビリテーション指示書Ver3.0: ${newOrder.diagnosisName} (${newOrder.patientName}様)`;
      const articleContent = `【リハビリテーション指示発行】
・管理番号: ${newOrder.orderNumber}
・指示日: ${newOrder.orderDate} / 区分: ${newOrder.patientType === 'inpatient' ? '入院' : '外来'}
・診断名・算定病名: ${newOrder.diagnosisName}
・主治医: ${newOrder.doctorName}
---------------------------------------------------
【医学的必要性・指示内容】
・必要性理由: ${newOrder.necessityReason || '記載なし'}
・指示頻度: 週${newOrder.frequencyPerWeek || '2〜3'}回 / ${newOrder.durationMonths || '3'}ヶ月間
・実施場所: ${newOrder.location === 'ward' ? '病棟内' : (newOrder.location === 'rehab_room' ? '病棟外リハ室' : '病棟・リハ室併用')}
${ptItems.length > 0 ? `・理学療法(PT): ${ptItems.join(', ')}\n` : ''}${otItems.length > 0 ? `・作業療法(OT): ${otItems.join(', ')}\n` : ''}${stItems.length > 0 ? `・言語聴覚療法(ST): ${stItems.join(', ')}\n` : ''}---------------------------------------------------
※リハビリテーション指示書Ver3.0原本（A4帳票）発行済`;

      const newArticle = new Article({
        title: articleTitle,
        content: articleContent,
        targetPerson: targetPersonDoc ? targetPersonDoc._id : null,
        author: authorUserDoc ? authorUserDoc._id : null,
        category: '🤸 リハビリオーダー',
        tags: ['リハビリテーション', '指示書Ver3.0', newOrder.diagnosisName],
        status: 'published'
      });
      await newArticle.save();
      newOrder.articleId = newArticle._id;
    } catch (artErr) {
      console.warn('⚠️ [Rehabili] カルテ自動記録スキップ:', artErr.message);
    }

    await newOrder.save();

    // 📜 統一操作ログ
    logOperation({
      action: 'REHABILITATION_ORDER_CREATED',
      actor: user.userName,
      details: {
        orderNumber: newOrder.orderNumber,
        patientId: newOrder.patientId,
        patientName: newOrder.patientName,
        diagnosisName: newOrder.diagnosisName
      }
    });

    console.log(`✅ [Rehabili] 指示書作成完了: ${newOrder.orderNumber} - ${newOrder.patientName}`);
    res.json({
      success: true,
      orderNumber: newOrder.orderNumber,
      orderId: newOrder._id,
      printUrl: `/rehabili/orders/${newOrder._id}/print`
    });
  } catch (err) {
    console.error('❌ [Rehabili] 指示書保存エラー:', err.message);
    res.status(500).json({ success: false, message: '保存エラー: ' + err.message });
  }
});

/**
 * 🖨️ リハビリ指示書 A4原本印刷画面 (GET /orders/:id/print)
 */
app.get('/orders/:id/print', async (req, res) => {
  try {
    const order = await RehabilitationOrder.findById(req.params.id).lean();
    if (!order) {
      return res.status(404).send('指示書が見つかりませんでした。');
    }
    res.render('print', { order });
  } catch (err) {
    console.error('❌ [Rehabili] 印刷画面エラー:', err.message);
    res.status(500).send('印刷画面エラー: ' + err.message);
  }
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n================================================================`);
  console.log(`🤸 交雄会だて病院 リハビリ指示書システム (Port ${PORT}) 稼働開始`);
  console.log(`   ・ローカル直接アクセス: http://localhost:${PORT}/`);
  console.log(`   ・リバースプロキシ経由: http://localhost:8000/rehabili/`);
  console.log(`================================================================\n`);
});
