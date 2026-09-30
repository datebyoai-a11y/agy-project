/**
 * 🩻 交雄会だて病院 放射線科 指示受け・実施モニター サーバー (server.js)
 * 
 * 1. モダリティ別 縦3列 (Kanban) 指示受けモニター:
 *    - 列1: 📷 一般撮影 (X-Ray: 単純撮影 / ポータブル / 照射録)
 *    - 列2: 🌀 CT検査 (CT: 単純 / 造影 / ダイナミック)
 *    - 列3: 📺 X線透視 (Fluoro: TV透視 / 嚥下造影 / PEG交換 / 整復等)
 * 2. 指示受け操作:
 *    - 「📥 受付」ボタン (ORDERED ➔ ACCEPTED)
 *    - 「✅ 実施済」ボタン (ACCEPTED ➔ COMPLETED)
 *    - 「↩️ 戻す」ボタン (ステータス差し戻し)
 * 3. データベース & カルテ連動:
 *    - MongoDB (incident_db.radiologyorders)
 *    - 電子カルテ (Article) ステータス同期
 * 4. リアルタイム自動ポーリング API & ポータルSSO対応
 */

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');

// モデル
const RadiologyOrder = require('./models/RadiologyOrder');
const Article = require('/home/a/Desktop/ai/agy-project/incident-system/models/Article');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');
const Patient = require('/home/a/Desktop/ai/agy-project/support/menu/sakusei/models/Patient');

// 📜 統一操作・監査ロガー
const { logOperation, getRecentLogs, getRecentReadableLog, getLogArchivesList } = require('../../common/operationLogger');

const app = express();
const PORT = process.env.PORT || 8081;
const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

// MongoDB 接続 (incident_db - レプリカセット rs0 対応)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [RadiUke] MongoDB レプリカセット (rs0) に正常接続しました。'))
  .catch(err => console.error('❌ [RadiUke] MongoDB 接続エラー:', err.message));

// ミドルウェア設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  name: 'radi_uke.sid',
  secret: 'radi-uke-receiver-session-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Radiology Order Receiver System', port: PORT });
});

/**
 * 🔑 SSO ログイン & 患者連携 API (GET /api/sso-login)
 * 医療統合ポータル (/sso/launch?app=radi_uke) からの認証トークンを受け取り、セッションを確立
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
      console.log(`🔑 [RadiUke SSO] 技師・職員認証成功: ${decoded.userName} (${decoded.department} / ${decoded.role})`);
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    const baseTarget = prefix ? `${prefix}/` : '../';
    const targetUrl = redirect || baseTarget;
    res.redirect(targetUrl);
  } catch (err) {
    console.error('❌ [RadiUke SSO] トークン認証エラー:', err.message);
    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.redirect(prefix ? `${prefix}/` : '../');
  }
});

/**
 * 🎯 モダリティ判定ヘルパー関数
 * 'xray' | 'ct' | 'fluoro'
 */
function classifyModality(order) {
  const formType = (order.formType || '').toUpperCase();
  const mod = (order.modality || '').toUpperCase();
  const exam = (order.examType || '').toUpperCase();

  if (formType === 'CT' || mod.includes('CT') || exam.includes('CT')) {
    return 'ct';
  }
  if (formType === 'FLUORO' || mod.includes('透視') || mod.includes('FLUORO') || exam.includes('透視') || exam.includes('PEG') || exam.includes('VF') || exam.includes('嚥下')) {
    return 'fluoro';
  }
  return 'xray';
}

/**
 * 🏠 1. 指示受け・実施モニター 画面表示 (GET /)
 */
app.get('/', async (req, res) => {
  try {
    const currentUser = req.session.user || {
      userName: '放射線技師',
      department: '放射線科',
      role: 'technician'
    };

    // 初期ロード用の直近24時間オーダーを取得（新着順）
    const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orders = await RadiologyOrder.find({
      createdAt: { $gte: sinceDate }
    }).sort({ createdAt: -1 }).lean();

    // モダリティ別に初期分類
    const modalityGroups = {
      xray: [],
      ct: [],
      fluoro: []
    };

    orders.forEach(order => {
      const groupKey = classifyModality(order);
      modalityGroups[groupKey].push(order);
    });

    res.render('index', {
      user: currentUser,
      orders,
      modalityGroups,
      prefix: req.headers['x-forwarded-prefix'] || ''
    });
  } catch (err) {
    console.error('❌ [RadiUke] メイン画面表示エラー:', err);
    res.status(500).send('放射線科 指示受け画面の読み込み中にエラーが発生しました: ' + err.message);
  }
});

/**
 * 📡 2. オーダー一覧取得 API (GET /api/orders)
 * フロントエンドの自動ポーリング (3〜5秒間隔) で使用
 */
app.get('/api/orders', async (req, res) => {
  try {
    const { status, modality, search, dateRange } = req.query;
    
    // デフォルトは本日〜直近48時間のオーダー
    const query = {};
    if (dateRange === 'all') {
      // 制限なし
    } else if (dateRange === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfDay };
    } else {
      // デフォルト: 過去48時間
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      query.createdAt = { $gte: twoDaysAgo };
    }

    // キャッシュ無効化ヘッダーを付与 (最新状態を即時反映)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // 1. 全体集計用オーダー（直近の全ステータス）を取得
    const allRecentOrders = await RadiologyOrder.find(query).sort({ createdAt: -1 }).lean();

    let counts = {
      total: allRecentOrders.length,
      ordered: 0,
      accepted: 0,
      completed: 0,
      portable: 0,
      xray: { total: 0, ordered: 0, accepted: 0, completed: 0 },
      ct: { total: 0, ordered: 0, accepted: 0, completed: 0 },
      fluoro: { total: 0, ordered: 0, accepted: 0, completed: 0 }
    };

    allRecentOrders.forEach(order => {
      const key = classifyModality(order);
      const st = order.orderStatus || 'ORDERED';
      if (st === 'ORDERED') {
        counts.ordered++;
        counts[key].ordered++;
      } else if (st === 'ACCEPTED' || st === 'RECEIVED') {
        counts.accepted++;
        counts[key].accepted++;
      } else if (st === 'COMPLETED') {
        counts.completed++;
        counts[key].completed++;
      }

      counts[key].total++;
      if (order.isPortable || order.portable?.includes('ポータブル')) {
        counts.portable++;
      }
    });

    // 2. 表示用フィルター条件の適用
    const filterQuery = { ...query };
    if (status && status !== 'ALL') {
      if (status === 'ACTIVE') {
        filterQuery.orderStatus = { $in: ['ORDERED', 'ACCEPTED', 'RECEIVED'] };
      } else {
        filterQuery.orderStatus = status;
      }
    }

    if (search) {
      const s = search.trim();
      filterQuery.$or = [
        { patientName: { $regex: s, $options: 'i' } },
        { patientId: { $regex: s, $options: 'i' } },
        { examType: { $regex: s, $options: 'i' } },
        { partsDetail: { $regex: s, $options: 'i' } },
        { orderNumber: { $regex: s, $options: 'i' } },
        { ward: { $regex: s, $options: 'i' } }
      ];
    }

    const orders = await RadiologyOrder.find(filterQuery).sort({ createdAt: -1 }).lean();

    // 縦3列に仕分け
    const grouped = {
      xray: [],
      ct: [],
      fluoro: []
    };

    orders.forEach(order => {
      const key = classifyModality(order);
      grouped[key].push(order);
    });

    res.json({
      success: true,
      counts,
      grouped,
      orders
    });
  } catch (err) {
    console.error('❌ [RadiUke API] オーダー一覧取得エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 📥 3. 「受付」ボタン押下 API (POST /api/orders/:id/accept)
 * ステータス: ORDERED ➔ ACCEPTED
 */
app.post('/api/orders/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;
    const staffName = req.body.operatorName || req.session.user?.userName || '放射線技師';

    const order = await RadiologyOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません' });
    }

    order.orderStatus = 'ACCEPTED';
    order.acceptedAt = new Date();
    order.acceptedBy = staffName;
    order.updatedAt = new Date();
    await order.save();

    console.log(`📥 [RadiUke] オーダー受付完了: [${order.orderNumber}] ${order.patientName} (${order.examType}) 担当: ${staffName}`);

    // 📜 統一操作ログの記録 (可読ログ & DB再構築用)
    await logOperation({
      system: 'radi-uke',
      opType: 'ORDER_ACCEPT',
      action: 'UPDATE',
      collection: 'radiologyorders',
      documentId: String(order._id),
      operator: {
        name: staffName,
        role: 'radiology_technician',
        department: '放射線科',
        ip: req.ip
      },
      summary: `【検査指示受け・受付】[${order.orderNumber}] ${order.patientName} (${order.examType}) 担当技師: ${staffName}`,
      details: {
        伝票番号: order.orderNumber,
        患者氏名: order.patientName,
        検査種別: order.examType,
        担当技師: staffName,
        受付日時: order.acceptedAt,
        状態変化: 'ORDERED ➔ ACCEPTED'
      },
      snapshot: order
    });

    // 🏥 電子カルテ (Article) 側のステータスも連動
    if (order.articleId) {
      try {
        const article = await Article.findById(order.articleId);
        if (article) {
          article.orderStatus = 'ACCEPTED';
          const timeStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          article.content += `\n\n【放射線科 受付済】${timeStr} 担当技師: ${staffName}`;
          await article.save();
          console.log(`✅ [RadiUke] 電子カルテ (Article: ${order.articleId}) のステータスを受付済(ACCEPTED)に更新しました。`);

          // 📜 電子カルテ更新ログ
          await logOperation({
            system: 'radi-uke',
            opType: 'CARTE_UPDATE',
            action: 'UPDATE',
            collection: 'articles',
            documentId: String(article._id),
            operator: { name: staffName, department: '放射線科', ip: req.ip },
            summary: `【電子カルテ連動】放射線オーダー受付に伴うカルテ追記 (記事ID: ${article._id})`,
            details: { 伝票番号: order.orderNumber, 患者氏名: order.patientName },
            snapshot: article
          });
        }
      } catch (cErr) {
        console.warn('⚠️ [RadiUke] カルテステータス更新警告:', cErr.message);
      }
    }

    res.json({
      success: true,
      message: `オーダー [${order.orderNumber}] を受付しました。`,
      order
    });
  } catch (err) {
    console.error('❌ [RadiUke] 受付処理エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ✅ 4. 「実施済」ボタン押下 API (POST /api/orders/:id/complete)
 * ステータス: ACCEPTED / ORDERED ➔ COMPLETED
 */
app.post('/api/orders/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const staffName = req.body.operatorName || req.session.user?.userName || '放射線技師';
    const technicianNotes = req.body.technicianNotes || '';

    const order = await RadiologyOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません' });
    }

    order.orderStatus = 'COMPLETED';
    order.completedAt = new Date();
    order.completedBy = staffName;
    if (technicianNotes) {
      order.technicianNotes = technicianNotes;
    }
    if (!order.acceptedAt) {
      order.acceptedAt = new Date();
      order.acceptedBy = staffName;
    }
    order.updatedAt = new Date();
    await order.save();

    console.log(`✅ [RadiUke] 検査実施済: [${order.orderNumber}] ${order.patientName} (${order.examType}) 実施技師: ${staffName}`);

    // 📜 統一操作ログの記録 (可読ログ & DB再構築用)
    await logOperation({
      system: 'radi-uke',
      opType: 'ORDER_COMPLETE',
      action: 'UPDATE',
      collection: 'radiologyorders',
      documentId: String(order._id),
      operator: {
        name: staffName,
        role: 'radiology_technician',
        department: '放射線科',
        ip: req.ip
      },
      summary: `【検査実施完了】[${order.orderNumber}] ${order.patientName} (${order.examType}) 実施技師: ${staffName}`,
      details: {
        伝票番号: order.orderNumber,
        患者氏名: order.patientName,
        検査種別: order.examType,
        実施技師: staffName,
        実施日時: order.completedAt,
        特記事項: technicianNotes || '特になし',
        状態変化: 'ACCEPTED ➔ COMPLETED'
      },
      snapshot: order
    });

    // 🏥 電子カルテ (Article) 側のステータスも実施済に連動
    if (order.articleId) {
      try {
        const article = await Article.findById(order.articleId);
        if (article) {
          article.orderStatus = 'COMPLETED';
          const timeStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          article.content += `\n\n【放射線科 検査実施済】${timeStr} 実施技師: ${staffName}${technicianNotes ? ' (特記: ' + technicianNotes + ')' : ''}`;
          await article.save();
          console.log(`✅ [RadiUke] 電子カルテ (Article: ${order.articleId}) のステータスを実施済(COMPLETED)に更新しました。`);

          // 📜 電子カルテ更新ログ
          await logOperation({
            system: 'radi-uke',
            opType: 'CARTE_UPDATE',
            action: 'UPDATE',
            collection: 'articles',
            documentId: String(article._id),
            operator: { name: staffName, department: '放射線科', ip: req.ip },
            summary: `【電子カルテ連動】検査実施済に伴うカルテ追記 (記事ID: ${article._id})`,
            details: { 伝票番号: order.orderNumber, 患者氏名: order.patientName, 特記事項: technicianNotes || 'なし' },
            snapshot: article
          });
        }
      } catch (cErr) {
        console.warn('⚠️ [RadiUke] カルテステータス更新警告:', cErr.message);
      }
    }

    res.json({
      success: true,
      message: `オーダー [${order.orderNumber}] を実施済として記録しました。`,
      order
    });
  } catch (err) {
    console.error('❌ [RadiUke] 実施済処理エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ↩️ 5. ステータス巻き戻し API (POST /api/orders/:id/revert)
 * 誤操作時に COMPLETED ➔ ACCEPTED、ACCEPTED ➔ ORDERED に戻す
 */
app.post('/api/orders/:id/revert', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await RadiologyOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'オーダーが見つかりません' });
    }

    const prevStatus = order.orderStatus;
    let nextStatus = 'ORDERED';
    if (prevStatus === 'COMPLETED') {
      nextStatus = 'ACCEPTED';
      order.completedAt = null;
    } else {
      nextStatus = 'ORDERED';
      order.acceptedAt = null;
    }
    order.orderStatus = nextStatus;
    order.updatedAt = new Date();
    await order.save();

    console.log(`↩️ [RadiUke] ステータス差し戻し: [${order.orderNumber}] ${prevStatus} ➔ ${nextStatus}`);

    // 📜 統一操作ログの記録 (可読ログ & DB再構築用)
    await logOperation({
      system: 'radi-uke',
      opType: 'ORDER_REVERT',
      action: 'UPDATE',
      collection: 'radiologyorders',
      documentId: String(order._id),
      operator: {
        name: req.session.user?.userName || '放射線技師',
        role: 'radiology_technician',
        department: '放射線科',
        ip: req.ip
      },
      summary: `【ステータス差し戻し】[${order.orderNumber}] ${order.patientName} (${prevStatus} ➔ ${nextStatus})`,
      details: {
        伝票番号: order.orderNumber,
        患者氏名: order.patientName,
        変更前: prevStatus,
        変更後: nextStatus
      },
      snapshot: order
    });

    // 電子カルテ側も更新
    if (order.articleId) {
      try {
        const article = await Article.findByIdAndUpdate(order.articleId, { orderStatus: nextStatus }, { new: true });
        if (article) {
          await logOperation({
            system: 'radi-uke',
            opType: 'CARTE_UPDATE',
            action: 'UPDATE',
            collection: 'articles',
            documentId: String(article._id),
            operator: { name: req.session.user?.userName || '放射線技師', department: '放射線科', ip: req.ip },
            summary: `【電子カルテ連動】ステータス差し戻し同期 (${nextStatus})`,
            details: { 伝票番号: order.orderNumber },
            snapshot: article
          });
        }
      } catch (_) {}
    }

    res.json({
      success: true,
      message: `ステータスを [${nextStatus}] に戻しました。`,
      order
    });
  } catch (err) {
    console.error('❌ [RadiUke] 差し戻し処理エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 📝 6. 技師コメント・特記事項保存 API (POST /api/orders/:id/note)
 */
app.post('/api/orders/:id/note', async (req, res) => {
  try {
    const { id } = req.params;
    const { technicianNotes } = req.body;
    const order = await RadiologyOrder.findByIdAndUpdate(id, { technicianNotes, updatedAt: new Date() }, { new: true });

    if (order) {
      // 📜 統一操作ログの記録
      await logOperation({
        system: 'radi-uke',
        opType: 'ORDER_NOTE',
        action: 'UPDATE',
        collection: 'radiologyorders',
        documentId: String(order._id),
        operator: {
          name: req.session.user?.userName || '放射線技師',
          role: 'radiology_technician',
          department: '放射線科',
          ip: req.ip
        },
        summary: `【技師特記メモ更新】[${order.orderNumber}] ${order.patientName}: ${technicianNotes}`,
        details: {
          伝票番号: order.orderNumber,
          患者氏名: order.patientName,
          技師メモ: technicianNotes
        },
        snapshot: order
      });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 📜 7. 統一操作ログ・監査ログ閲覧 API (GET /api/operations/log)
 */
app.get('/api/operations/log', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const logs = getRecentLogs(limit);
  res.json({ success: true, count: logs.length, logs });
});

/**
 * 📖 8. 人間可読テキストログ閲覧 API (GET /api/operations/readable-log)
 */
app.get('/api/operations/readable-log', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 200;
  const text = getRecentReadableLog(limit);
  res.type('text/plain; charset=utf-8').send(text);
});

/**
 * 🔄 9. ログからのデータベース再構築 API (POST /api/operations/rebuild)
 */
app.post('/api/operations/rebuild', async (req, res) => {
  const { spawn } = require('child_process');
  const dryRun = req.body.dryRun === true;
  const drop = req.body.drop === true;

  const scriptArgs = [path.resolve(__dirname, '../../../scripts/rebuild-database.js')];
  if (dryRun) scriptArgs.push('--dry-run');
  if (drop) scriptArgs.push('--drop');

  const child = spawn(process.execPath, scriptArgs);
  let output = '';

  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });

  child.on('close', code => {
    res.json({
      success: code === 0,
      exitCode: code,
      dryRun,
      drop,
      output
    });
  });
});

/**
 * 📦 10. ログアーカイブ (.gz / 日別) 一覧取得 API (GET /api/operations/archives)
 */
app.get('/api/operations/archives', (req, res) => {
  const archives = getLogArchivesList();
  res.json({ success: true, count: archives.length, archives });
});

/**
 * 🗜️ 11. 手動ログローテーション実行 API (POST /api/operations/rotate)
 */
app.post('/api/operations/rotate', (req, res) => {
  const { spawn } = require('child_process');
  const force = req.body.force === true;

  const scriptArgs = [path.resolve(__dirname, '../../../scripts/rotate-logs.js')];
  if (force) scriptArgs.push('--force');

  const child = spawn(process.execPath, scriptArgs);
  let output = '';

  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });

  child.on('close', code => {
    res.json({
      success: code === 0,
      exitCode: code,
      output
    });
  });
});

/**
 * 📖 12. アーカイブファイルの内容閲覧 API (GET /api/operations/archives/:filename)
 */
app.get('/api/operations/archives/:filename', (req, res) => {
  const zlib = require('zlib');
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(path.resolve(__dirname, '../../logs/operations'), safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('アーカイブファイルが見つかりません');
  }

  if (safeFilename.endsWith('.gz')) {
    res.type('text/plain; charset=utf-8');
    const readStream = fs.createReadStream(filePath);
    const gunzip = zlib.createGunzip();
    readStream.pipe(gunzip).pipe(res);
  } else {
    res.sendFile(filePath);
  }
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(`🩻 交雄会だて病院 放射線科 指示受け・実施モニターシステム`);
  console.log(`🌐 待機ポート: http://localhost:${PORT}`);
  console.log(`📊 モダリティ別 縦3列 (一般X線 / CT / 透視) Kanban 受付・実施管理`);
  console.log('================================================================');
});
