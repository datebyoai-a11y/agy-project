/**
 * 🤸 交雄会だて病院 リハビリテーション科 指示受け・実施モニター サーバー (server.js)
 * 
 * 1. 職種別・療法別 縦3列 (Kanban) 指示受けモニター:
 *    - 列1: 🏃‍♂️ 理学療法 (PT: ROM / 起立歩行 / 基本動作 / ADL改善)
 *    - 列2: 🖐️ 作業療法 (OT: ADL訓練 / 作業 / 座位立位 / 環境調整)
 *    - 列3: 🗣️ 言語聴覚療法 (ST) & 物理療法 (摂食嚥下 / 構音失語 / 消炎鎮痛)
 * 2. 指示受け操作:
 *    - 「📥 受付」ボタン (ordered ➔ received)
 *    - 「▶️ 実施中」ボタン (received ➔ in_progress)
 *    - 「✅ 実施済」ボタン (in_progress / received ➔ completed)
 *    - 「↩️ 戻す」ボタン (ステータス差し戻し)
 * 3. データベース & カルテ連動:
 *    - MongoDB (incident_db.rehabilitationorders)
 *    - 電子カルテ (Article) 進捗追記
 * 4. リアルタイム自動ポーリング API & ポータルSSO対応
 * 5. 統一操作ロガー (common/operationLogger.js) 連携
 */

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');

// モデル
const RehabilitationOrder = require('./models/RehabilitationOrder');
const Article = require('/home/a/Desktop/ai/agy-project/incident-system/models/Article');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');
const Patient = require('/home/a/Desktop/ai/agy-project/support/menu/sakusei/models/Patient');

// 📜 統一操作・監査ロガー
let logOperation = () => {};
let getRecentLogs = () => [];
let getRecentReadableLog = () => '';
let getLogArchivesList = () => [];

try {
  const loggerModule = require('../../common/operationLogger');
  if (loggerModule) {
    logOperation = loggerModule.logOperation || logOperation;
    getRecentLogs = loggerModule.getRecentLogs || getRecentLogs;
    getRecentReadableLog = loggerModule.getRecentReadableLog || getRecentReadableLog;
    getLogArchivesList = loggerModule.getLogArchivesList || getLogArchivesList;
  }
} catch (e) {
  console.warn('⚠️ [RehaUke] operationLogger ロード警告:', e.message);
}

const app = express();
const PORT = process.env.PORT || 8085;
const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

// MongoDB 接続 (incident_db - レプリカセット rs0 対応)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [RehaUke] MongoDB レプリカセット (rs0) に正常接続しました。'))
  .catch(err => console.error('❌ [RehaUke] MongoDB 接続エラー:', err.message));

// ミドルウェア設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  name: 'reha_uke.sid',
  secret: 'reha-uke-receiver-session-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Rehabilitation Order Receiver System', port: PORT });
});

/**
 * 🔑 SSO ログイン & 患者連携 API (GET /api/sso-login)
 * 医療統合ポータル (/sso/launch?app=reha_uke) からの認証トークンを受け取り、セッションを確立
 */
app.get('/api/sso-login', async (req, res) => {
  try {
    const { token, redirect } = req.query;
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.session.user = {
        userId: decoded.userId,
        loginId: decoded.loginId,
        userName: decoded.userName,
        department: decoded.department,
        role: decoded.role
      };
      console.log(`🔑 [RehaUke SSO] リハビリ科職員認証成功: ${decoded.userName} (${decoded.department} / ${decoded.role})`);
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    const baseTarget = prefix ? `${prefix}/` : '../';
    const targetUrl = redirect || baseTarget;
    res.redirect(targetUrl);
  } catch (err) {
    console.error('❌ [RehaUke SSO] トークン認証エラー:', err.message);
    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.redirect(prefix ? `${prefix}/` : '../');
  }
});

/**
 * 🎯 療法判定ヘルパー関数
 * PT / OT / ST & 物理療法 の該当有無を判定
 */
function classifyRehabTherapies(order) {
  const isPt = !!(order.pt_rom || order.pt_strength || order.pt_neuro || order.pt_balance ||
    order.pt_coordination || order.pt_basicMotion || order.pt_transfer || order.pt_gait ||
    order.pt_adl || order.pt_wheelchair || order.pt_cognition);

  const isOt = !!(order.ot_rom || order.ot_strength || order.ot_gait || order.ot_posture ||
    order.ot_meal || order.ot_dressing || order.ot_toilet || order.ot_attention ||
    order.ot_executive || order.ot_recreation || order.ot_environment);

  const isSt = !!(order.st_vf || order.st_swallowMeal || order.st_swallowPosture ||
    order.st_swallowForm || order.st_swallowInstruction || order.st_swallowRisk ||
    order.st_articulation || order.st_aphasia || order.st_suction ||
    order.sed_massage || order.sed_hotpack || order.sed_ssp || order.sed_medmer ||
    order.sed_traction || order.eval_dementia || order.eval_walk || order.eval_physical ||
    order.eval_bodyComp);

  return { isPt, isOt, isSt };
}

// サマリーテキスト生成ヘルパー
function generateSummaryItems(order) {
  const ptItems = [];
  if (order.pt_rom) ptItems.push('ROM');
  if (order.pt_strength) ptItems.push('筋力');
  if (order.pt_gait) ptItems.push('歩行');
  if (order.pt_basicMotion) ptItems.push('基本動作');
  if (order.pt_adl) ptItems.push('ADL');

  const otItems = [];
  if (order.ot_meal) otItems.push('食事動作');
  if (order.ot_dressing) otItems.push('更衣整容');
  if (order.ot_posture) otItems.push('姿勢保持');
  if (order.ot_recreation) otItems.push('作業活動');

  const stItems = [];
  if (order.st_vf) stItems.push('VF検査');
  if (order.st_swallowMeal) stItems.push('摂食嚥下');
  if (order.st_articulation) stItems.push('構音訓練');
  if (order.st_aphasia) stItems.push('失語訓練');
  if (order.sed_hotpack) stItems.push('ホットパック');
  if (order.sed_medmer) stItems.push('メドマー');
  if (order.sed_traction) stItems.push('牽引');

  return {
    pt: ptItems.join('・'),
    ot: otItems.join('・'),
    st: stItems.join('・')
  };
}

/**
 * 🏠 1. 指示受け・実施モニター 画面表示 (GET /)
 */
app.get('/', async (req, res) => {
  try {
    const currentUser = req.session.user || {
      userName: 'リハビリ科スタッフ',
      department: 'リハビリテーション科',
      role: 'therapist'
    };

    // 初期ロード用オーダー（新着順）
    const orders = await RehabilitationOrder.find({}).sort({ createdAt: -1 }).limit(100).lean();

    // 職種別に初期分類
    const grouped = {
      pt: [],
      ot: [],
      st: []
    };

    orders.forEach(order => {
      const { isPt, isOt, isSt } = classifyRehabTherapies(order);
      order.therapies = { isPt, isOt, isSt };
      order.summaryItems = generateSummaryItems(order);

      // いずれの指示にも該当しない場合のフォールバックはPTに配置
      let assigned = false;
      if (isPt) { grouped.pt.push(order); assigned = true; }
      if (isOt) { grouped.ot.push(order); assigned = true; }
      if (isSt) { grouped.st.push(order); assigned = true; }
      if (!assigned) { grouped.pt.push(order); }
    });

    res.render('index', {
      user: currentUser,
      orders,
      grouped,
      prefix: req.headers['x-forwarded-prefix'] || ''
    });
  } catch (err) {
    console.error('❌ [RehaUke] メイン画面表示エラー:', err);
    res.status(500).send('リハビリ科 指示受け画面の読み込み中にエラーが発生しました: ' + err.message);
  }
});

/**
 * 📡 2. オーダー一覧取得 API (GET /api/orders)
 * フロントエンドの自動ポーリング (3〜5秒間隔) で使用
 */
app.get('/api/orders', async (req, res) => {
  try {
    const { status, therapy, search, dateRange } = req.query;

    const query = {};
    if (dateRange === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfDay };
    } else if (dateRange === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: weekAgo };
    }

    // キャッシュ無効化ヘッダー
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // 1. 全体集計
    const allRecentOrders = await RehabilitationOrder.find(query).sort({ createdAt: -1 }).lean();

    let counts = {
      total: allRecentOrders.length,
      ordered: 0,
      received: 0,
      in_progress: 0,
      completed: 0,
      risk: 0,
      pt: { total: 0, ordered: 0, received: 0, in_progress: 0, completed: 0 },
      ot: { total: 0, ordered: 0, received: 0, in_progress: 0, completed: 0 },
      st: { total: 0, ordered: 0, received: 0, in_progress: 0, completed: 0 }
    };

    allRecentOrders.forEach(order => {
      const st = order.status || 'ordered';
      if (st === 'ordered') counts.ordered++;
      else if (st === 'received') counts.received++;
      else if (st === 'in_progress') counts.in_progress++;
      else if (st === 'completed') counts.completed++;

      if (order.riskCirculatory || order.riskRespiratory || order.riskMedicine || order.riskJoint || order.riskDementia || order.contraindications) {
        counts.risk++;
      }

      const { isPt, isOt, isSt } = classifyRehabTherapies(order);
      if (isPt) {
        counts.pt.total++;
        if (st === 'ordered') counts.pt.ordered++;
        else if (st === 'received') counts.pt.received++;
        else if (st === 'in_progress') counts.pt.in_progress++;
        else if (st === 'completed') counts.pt.completed++;
      }
      if (isOt) {
        counts.ot.total++;
        if (st === 'ordered') counts.ot.ordered++;
        else if (st === 'received') counts.ot.received++;
        else if (st === 'in_progress') counts.ot.in_progress++;
        else if (st === 'completed') counts.ot.completed++;
      }
      if (isSt) {
        counts.st.total++;
        if (st === 'ordered') counts.st.ordered++;
        else if (st === 'received') counts.st.received++;
        else if (st === 'in_progress') counts.st.in_progress++;
        else if (st === 'completed') counts.st.completed++;
      }
    });

    // 2. 絞り込み条件の適用
    const filterQuery = { ...query };
    if (status && status !== 'ALL') {
      if (status === 'ACTIVE') {
        filterQuery.status = { $in: ['ordered', 'received', 'in_progress'] };
      } else {
        filterQuery.status = status;
      }
    }

    if (search) {
      const s = search.trim();
      filterQuery.$or = [
        { patientName: { $regex: s, $options: 'i' } },
        { patientId: { $regex: s, $options: 'i' } },
        { diagnosisName: { $regex: s, $options: 'i' } },
        { doctorName: { $regex: s, $options: 'i' } },
        { orderNumber: { $regex: s, $options: 'i' } },
        { ward: { $regex: s, $options: 'i' } }
      ];
    }

    const orders = await RehabilitationOrder.find(filterQuery).sort({ createdAt: -1 }).lean();

    // 3列に仕分け
    const grouped = {
      pt: [],
      ot: [],
      st: []
    };

    orders.forEach(order => {
      const { isPt, isOt, isSt } = classifyRehabTherapies(order);
      order.therapies = { isPt, isOt, isSt };
      order.summaryItems = generateSummaryItems(order);

      let assigned = false;
      if (isPt) { grouped.pt.push(order); assigned = true; }
      if (isOt) { grouped.ot.push(order); assigned = true; }
      if (isSt) { grouped.st.push(order); assigned = true; }
      if (!assigned) { grouped.pt.push(order); }
    });

    res.json({
      success: true,
      counts,
      grouped,
      orders
    });
  } catch (err) {
    console.error('❌ [RehaUke API] オーダー一覧取得エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 📥 3. 「受付」API (POST /api/orders/:id/accept)
 * ステータス: ordered ➔ received
 */
app.post('/api/orders/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;
    const staffName = req.body.operatorName || req.session.user?.userName || 'リハビリ科スタッフ';
    const todayStr = new Date().toISOString().split('T')[0];

    const order = await RehabilitationOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません' });
    }

    order.status = 'received';
    order.rehabAcceptDate = todayStr;
    order.rehabStaffName = staffName;
    order.acceptedAt = new Date();
    order.acceptedBy = staffName;
    order.updatedAt = new Date();
    await order.save();

    console.log(`📥 [RehaUke] 指示書受付完了: [${order.orderNumber}] ${order.patientName} (${order.diagnosisName}) 担当: ${staffName}`);

    // 📜 統一操作ログ
    await logOperation({
      system: 'reha-uke',
      opType: 'ORDER_ACCEPT',
      action: 'UPDATE',
      collection: 'rehabilitationorders',
      documentId: String(order._id),
      operator: {
        name: staffName,
        role: 'therapist',
        department: 'リハビリテーション科',
        ip: req.ip
      },
      summary: `【リハビリ指示受け・受付】[${order.orderNumber}] ${order.patientName} (${order.diagnosisName}) 担当: ${staffName}`,
      details: {
        伝票番号: order.orderNumber,
        患者氏名: order.patientName,
        診断名: order.diagnosisName,
        受付者: staffName,
        受付月日: todayStr,
        状態変化: 'ordered ➔ received'
      },
      snapshot: order
    });

    // 🏥 電子カルテ (Article) 進捗追記
    if (order.articleId) {
      try {
        const article = await Article.findById(order.articleId);
        if (article) {
          const timeStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          article.content += `\n\n【リハビリ科 受付済】${todayStr} ${timeStr} 担当: ${staffName}`;
          await article.save();
          console.log(`✅ [RehaUke] 電子カルテ (Article: ${order.articleId}) に受付情報を追記しました。`);
        }
      } catch (cErr) {
        console.warn('⚠️ [RehaUke] カルテ更新警告:', cErr.message);
      }
    }

    res.json({
      success: true,
      message: `指示書 [${order.orderNumber}] を受付しました。`,
      order
    });
  } catch (err) {
    console.error('❌ [RehaUke] 受付処理エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ▶️ 4. 「実施中」API (POST /api/orders/:id/in-progress)
 * ステータス: received ➔ in_progress
 */
app.post('/api/orders/:id/in-progress', async (req, res) => {
  try {
    const { id } = req.params;
    const staffName = req.body.operatorName || req.session.user?.userName || 'リハビリ科スタッフ';

    const order = await RehabilitationOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません' });
    }

    order.status = 'in_progress';
    order.updatedAt = new Date();
    await order.save();

    console.log(`▶️ [RehaUke] 訓練開始・実施中: [${order.orderNumber}] ${order.patientName} 担当: ${staffName}`);

    res.json({
      success: true,
      message: `指示書 [${order.orderNumber}] の訓練を開始しました。`,
      order
    });
  } catch (err) {
    console.error('❌ [RehaUke] 実施中変更エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ✅ 5. 「実施済」API (POST /api/orders/:id/complete)
 * ステータス: received / in_progress ➔ completed
 */
app.post('/api/orders/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const staffName = req.body.operatorName || req.session.user?.userName || 'リハビリ科スタッフ';
    const notes = req.body.notes || '';

    const order = await RehabilitationOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません' });
    }

    order.status = 'completed';
    order.completedAt = new Date();
    order.completedBy = staffName;
    if (notes) {
      order.rehabNotes = notes;
    }
    if (!order.acceptedAt) {
      order.acceptedAt = new Date();
      order.acceptedBy = staffName;
      order.rehabAcceptDate = new Date().toISOString().split('T')[0];
      order.rehabStaffName = staffName;
    }
    order.updatedAt = new Date();
    await order.save();

    console.log(`✅ [RehaUke] リハビリ実施完了: [${order.orderNumber}] ${order.patientName} 担当: ${staffName}`);

    // 📜 統一操作ログ
    await logOperation({
      system: 'reha-uke',
      opType: 'ORDER_COMPLETE',
      action: 'UPDATE',
      collection: 'rehabilitationorders',
      documentId: String(order._id),
      operator: {
        name: staffName,
        role: 'therapist',
        department: 'リハビリテーション科',
        ip: req.ip
      },
      summary: `【リハビリ訓練実施完了】[${order.orderNumber}] ${order.patientName} (${order.diagnosisName}) 担当: ${staffName}`,
      details: {
        伝票番号: order.orderNumber,
        患者氏名: order.patientName,
        診断名: order.diagnosisName,
        実施者: staffName,
        実施日時: order.completedAt,
        訓練メモ: notes || 'なし',
        状態変化: '➔ completed'
      },
      snapshot: order
    });

    // 🏥 電子カルテ (Article) 実施記録追記
    if (order.articleId) {
      try {
        const article = await Article.findById(order.articleId);
        if (article) {
          const timeStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          article.content += `\n\n【リハビリ実施済】${timeStr} 担当: ${staffName}${notes ? '\nメモ: ' + notes : ''}`;
          await article.save();
          console.log(`✅ [RehaUke] 電子カルテ (Article: ${order.articleId}) に実施完了記録を追記しました。`);
        }
      } catch (cErr) {
        console.warn('⚠️ [RehaUke] カルテ更新警告:', cErr.message);
      }
    }

    res.json({
      success: true,
      message: `指示書 [${order.orderNumber}] の実施を記録しました。`,
      order
    });
  } catch (err) {
    console.error('❌ [RehaUke] 実施完了処理エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ↩️ 6. 「戻す」API (POST /api/orders/:id/revert)
 * ステータスを前段階へ差し戻し
 */
app.post('/api/orders/:id/revert', async (req, res) => {
  try {
    const { id } = req.params;
    const staffName = req.body.operatorName || req.session.user?.userName || 'リハビリ科スタッフ';

    const order = await RehabilitationOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません' });
    }

    const prevStatus = order.status;
    let nextStatus = 'ordered';

    if (prevStatus === 'completed') {
      nextStatus = 'received';
      order.completedAt = null;
      order.completedBy = '';
    } else if (prevStatus === 'in_progress') {
      nextStatus = 'received';
    } else if (prevStatus === 'received') {
      nextStatus = 'ordered';
      order.acceptedAt = null;
      order.acceptedBy = '';
      order.rehabAcceptDate = '';
      order.rehabStaffName = '';
    }

    order.status = nextStatus;
    order.updatedAt = new Date();
    await order.save();

    console.log(`↩️ [RehaUke] ステータス差し戻し: [${order.orderNumber}] ${prevStatus} ➔ ${nextStatus}`);

    // 📜 統一操作ログ
    await logOperation({
      system: 'reha-uke',
      opType: 'ORDER_REVERT',
      action: 'UPDATE',
      collection: 'rehabilitationorders',
      documentId: String(order._id),
      operator: { name: staffName, department: 'リハビリテーション科', ip: req.ip },
      summary: `【ステータス差し戻し】[${order.orderNumber}] ${order.patientName} (${prevStatus} ➔ ${nextStatus})`,
      details: { 伝票番号: order.orderNumber, 患者氏名: order.patientName, 変更前: prevStatus, 変更後: nextStatus },
      snapshot: order
    });

    res.json({
      success: true,
      message: `ステータスを ${prevStatus} から ${nextStatus} に戻しました。`,
      order
    });
  } catch (err) {
    console.error('❌ [RehaUke] 差し戻し処理エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 🖨️ 7. リハビリ指示書原本印刷プレビュー画面 (GET /preview/:id)
 */
app.get('/preview/:id', async (req, res) => {
  try {
    const order = await RehabilitationOrder.findById(req.params.id).lean();
    if (!order) {
      return res.status(404).send('指示書が見つかりません');
    }
    // rehabili の print.ejs を描画
    const printViewPath = path.join(__dirname, '..', '..', 'rehabili', 'sakusei', 'views', 'print.ejs');
    res.render(printViewPath, { order });
  } catch (err) {
    console.error('❌ [RehaUke] プレビューエラー:', err);
    res.status(500).send('プレビュー表示エラー: ' + err.message);
  }
});

/**
 * 📜 8. 操作ログ API
 */
app.get('/api/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const format = req.query.format || 'readable';

    if (format === 'json') {
      const logs = await getRecentLogs(limit);
      return res.json({ success: true, logs });
    }

    const readableText = await getRecentReadableLog(limit);
    res.type('text/plain; charset=utf-8').send(readableText);
  } catch (err) {
    res.status(500).send('ログ取得エラー: ' + err.message);
  }
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n================================================================`);
  console.log(`🤸 交雄会だて病院 リハビリ指示受けモニター (Port ${PORT}) 稼働開始`);
  console.log(`   ・ローカル直接アクセス: http://localhost:${PORT}/`);
  console.log(`   ・リバースプロキシ経由: http://localhost:8000/reha-uke/`);
  console.log(`================================================================\n`);
});
