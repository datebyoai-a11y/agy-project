const http = require('http');
const https = require('https');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { OrderTypes, OrderStatus, OrderPriority, SamplePatients, generateOrderId } = require('../shared/orderSchema');
const medicineMaster = require('../shared/medicineMaster');

const app = express();
const PORT = process.env.PORT || 4000;
const DB_FILE = path.join(__dirname, 'sent_orders_db.json');

// SSL証明書の確認とプロトコル決定
const USE_HTTPS = process.env.USE_HTTPS === 'true' || process.env.USE_HTTPS === '1';
const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_FILE = path.join(CERT_DIR, 'server.key');
const CERT_FILE = path.join(CERT_DIR, 'server.crt');
const isHttps = USE_HTTPS && fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE);
const protocol = isHttps ? 'https' : 'http';

// 自己署名証明書（オレオレ証明書）での fetch エラー（UNABLE_TO_VERIFY_LEAF_SIGNATURE 等）を回避
if (isHttps || process.env.ALLOW_SELF_SIGNED === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🌐 別ホスト・外部端末からの通信を許可するCORS設定 & ブラウザキャッシュ無効化
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// SSE (Server-Sent Events) 接続中クライアント一覧
let sseClients = [];

function broadcastSse(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(payload);
    } catch (e) {
      // 接続切れ
    }
  });
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 送信履歴の保存・読み込み
function loadSentOrders() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[Sender] DB読み込みエラー:', e.message);
  }
  return [];
}

function saveSentOrders(orders) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2), 'utf8');
  } catch (e) {
    console.error('[Sender] DB保存エラー:', e.message);
  }
}

let sentOrders = loadSentOrders();

// 1. Web画面: オーダー作成・送信画面
app.get('/', (req, res) => {
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  const hostname = hostHeader.split(':')[0] || 'localhost';
  const isEncrypted = req.socket.encrypted || (req.headers['x-forwarded-proto'] === 'https');
  const currentProto = isEncrypted ? 'https' : 'http';
  const receiverPort = isEncrypted ? (process.env.HTTPS_RECEIVER_PORT || 5443) : 5000;
  res.render('index', {
    patients: SamplePatients,
    sentOrders: sentOrders,
    port: req.socket.localPort || PORT,
    isHttps: isEncrypted,
    protocol: currentProto,
    serverHostname: hostname,
    defaultReceiverUrl: `${currentProto}://${hostname}:${receiverPort}`,
    medicineStats: medicineMaster.getMedicineStats()
  });
});

// 2. 薬剤マスタ検索 API (GET /api/medicines)
app.get('/api/medicines', (req, res) => {
  const { q = '', category = '', adoptType = '', limit = 50 } = req.query;
  const list = medicineMaster.searchMedicines({
    q,
    category,
    adoptType,
    limit: parseInt(limit, 10) || 50
  });
  res.json({
    success: true,
    count: list.length,
    medicines: list
  });
});

// 2-2. 薬剤個別詳細 API (GET /api/medicines/:id)
app.get('/api/medicines/:id', (req, res) => {
  const med = medicineMaster.getMedicineById(req.params.id);
  if (!med) {
    return res.status(404).json({ success: false, error: '指定の薬剤が見つかりません' });
  }
  res.json({ success: true, medicine: med });
});

// 2-3. 薬剤マスタ統計 API (GET /api/medicines-stats)
app.get('/api/medicines-stats', (req, res) => {
  res.json({ success: true, stats: medicineMaster.getMedicineStats() });
});

// 3. 送信履歴取得 API
app.get('/api/orders/history', (req, res) => {
  res.json({
    success: true,
    count: sentOrders.length,
    orders: sentOrders
  });
});

// 3. オーダー送信 API (POST /api/orders/send)
app.post('/api/orders/send', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      receiverUrl = `${protocol}://localhost:5000`,
      orderType = 'PRESCRIPTION',
      priority = 'ROUTINE',
      patientId,
      patientName,
      patientDepartment,
      doctorName = '担当医',
      doctorDept = '内科',
      title,
      details = {}
    } = req.body;

    const orderId = generateOrderId(orderType.substring(0, 3));
    const now = new Date();

    const isReqHttps = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
    const reqProto = isReqHttps ? 'https' : 'http';
    const reqHost = req.headers.host || `localhost:${req.socket.localPort || (isReqHttps ? HTTPS_PORT : HTTP_PORT)}`;
    const dynamicSenderHost = `${reqProto}://${reqHost}`;

    const orderPayload = {
      orderId,
      orderType,
      title: title || `${orderType}オーダー (${patientName || patientId})`,
      priority,
      patient: {
        id: patientId || 'P001',
        name: patientName || '患者',
        department: patientDepartment || '一般病棟',
        ...(req.body.patient || {})
      },
      doctor: {
        name: doctorName,
        department: doctorDept
      },
      details,
      senderHost: dynamicSenderHost,
      senderUser: doctorName,
      orderDate: req.body.orderDate || req.body.details?.orderDate || now.toISOString(),
      createdAt: now.toISOString()
    };

    // 送信先URLの決定
    // 1. 標準総合エンドポイント: /api/orders/receive
    // 2. incident-system互換の場合: /api/iv-orders/receive 等
    let targetEndpoint = '/api/orders/receive';
    if (receiverUrl.includes('3000')) {
      // incident-system (ポート3000) への送信の場合
      if (orderType === 'IV') targetEndpoint = '/api/iv-orders/receive';
      else if (orderType === 'RADIOLOGY') targetEndpoint = '/api/radiology-orders/receive';
      else if (orderType === 'MEAL') targetEndpoint = '/api/meal-orders/receive';
    }

    const cleanBaseUrl = receiverUrl.replace(/\/+$/, '');
    const finalUrl = cleanBaseUrl.endsWith('/receive') ? cleanBaseUrl : `${cleanBaseUrl}${targetEndpoint}`;

    console.log(`\n🚀 [Sender] オーダー送信開始: [${orderId}] -> ${finalUrl}`);

    // HTTP POST で受信側へ送信 (タイムアウト 5秒)
    let responseData = null;
    let isSuccess = false;
    let statusCode = 0;
    let errorMessage = '';

    // incident-system (ポート3000) への送信時はフラット構造にマッピング
    const payloadToSend = receiverUrl.includes('3000') ? {
      orderId,
      targetCustomId: patientId,
      targetName: patientName,
      targetDepartment: patientDepartment || '一般病棟',
      scheduledAt: details.scheduledAt || now.toISOString(),
      senderHost: dynamicSenderHost,
      senderUser: doctorName,
      remarks: details.remarks || '',
      ...details
    } : orderPayload;

    try {
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadToSend),
        signal: AbortSignal.timeout(5000)
      });

      statusCode = response.status;
      if (response.ok) {
        responseData = await response.json();
        isSuccess = true;
      } else {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (netErr) {
      errorMessage = `通信失敗: ${netErr.message}`;
    }

    const elapsedMs = Date.now() - startTime;

    // 送信履歴レコードの作成
    const historyItem = {
      orderId,
      orderType,
      title: orderPayload.title,
      priority,
      patient: orderPayload.patient,
      doctor: orderPayload.doctor,
      details,
      orderDate: orderPayload.orderDate,
      targetUrl: finalUrl,
      sentAt: now.toISOString(),
      status: isSuccess ? (responseData.status || 'SENT') : 'FAILED',
      elapsedMs,
      statusCode,
      success: isSuccess,
      errorMessage,
      receiverResponse: responseData
    };

    sentOrders.unshift(historyItem);
    saveSentOrders(sentOrders);
    broadcastSse('order-sent', { order: historyItem, orders: sentOrders });

    if (isSuccess) {
      console.log(`✅ [Sender] 送信成功 (${elapsedMs}ms): [${orderId}] 受付ステータス: ${historyItem.status}`);
      res.status(201).json({
        success: true,
        message: 'オーダーを正常に送信しました',
        order: historyItem,
        receiverResponse: responseData
      });
    } else {
      console.error(`❌ [Sender] 送信失敗 (${elapsedMs}ms): ${errorMessage}`);
      res.status(502).json({
        success: false,
        error: `送信先に接続できませんでした (${errorMessage})`,
        order: historyItem
      });
    }

  } catch (err) {
    console.error('[Sender] システムエラー:', err);
    res.status(500).json({ success: false, error: 'オーダー送信処理エラー: ' + err.message });
  }
});

// 4. 受信側ステータス照会 API (GET /api/orders/:id/check-status)
app.get('/api/orders/:id/check-status', async (req, res) => {
  const item = sentOrders.find(o => o.orderId === req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: '送信履歴が見つかりません' });
  }

  try {
    const receiverBase = item.targetUrl.split('/api/')[0];
    const statusUrl = `${receiverBase}/api/orders/${item.orderId}`;
    const response = await fetch(statusUrl, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.order) {
        item.status = data.order.status;
        item.receiverOrder = data.order;
        item.lastActor = (data.order.executionHistory && data.order.executionHistory.slice(-1)[0]?.actor) || '';
        item.lastNote = (data.order.executionHistory && data.order.executionHistory.slice(-1)[0]?.note) || '';
        saveSentOrders(sentOrders);
        return res.json({ success: true, status: item.status, order: data.order });
      }
    }
    res.json({ success: false, message: '受信サーバーからのステータス取得不可', currentStatus: item.status });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 5. 🔔 受信側からのステータス更新コールバック受信 API (POST /api/orders/:id/status-callback)
app.post('/api/orders/:id/status-callback', (req, res) => {
  const orderId = req.params.id;
  const { status, actor, note, updatedAt, order } = req.body;
  const item = sentOrders.find(o => o.orderId === orderId);

  if (!item) {
    console.log(`⚠️ [Sender] コールバック受信: 対象オーダー ${orderId} が送信履歴に見つかりません`);
    return res.status(404).json({ success: false, error: '送信履歴が見つかりません' });
  }

  item.status = status;
  item.lastUpdated = updatedAt || new Date().toISOString();
  item.lastActor = actor || '';
  item.lastNote = note || '';
  if (order) item.receiverOrder = order;

  saveSentOrders(sentOrders);
  console.log(`\n🔔 [Sender] 受信側からステータス通知を受信: [${orderId}] -> ${status} (${actor || '部門'}: ${note || '更新'})`);

  // ⚡ 接続中のブラウザ画面すべてへ即座にプッシュ通知
  broadcastSse('status-update', {
    orderId: item.orderId,
    status: item.status,
    lastActor: item.lastActor,
    lastNote: item.lastNote,
    updatedAt: item.lastUpdated,
    orders: sentOrders
  });

  res.json({ success: true, message: '送信側のステータスを更新しました', status: item.status });
});

// 5-B. 💉 注射指示箋 編集・実施状況保存 API (POST /api/orders/:id/injection-sheet)
app.post('/api/orders/:id/injection-sheet', (req, res) => {
  const orderId = req.params.id;
  const { sheetState, medicines, pharmacistChecked, remarks } = req.body;
  const item = sentOrders.find(o => o.orderId === orderId);

  if (!item) {
    return res.status(404).json({ success: false, error: 'オーダーが見つかりません' });
  }

  item.details = item.details || {};
  if (sheetState) item.details.injectionSheetState = sheetState;
  if (medicines) item.details.medicines = medicines;
  if (typeof pharmacistChecked === 'boolean') item.details.pharmacistChecked = pharmacistChecked;
  if (remarks !== undefined) item.details.remarks = remarks;

  saveSentOrders(sentOrders);
  console.log(`\n💉 [Sender] 注射指示箋の変更を保存: [${orderId}]`);
  res.json({ success: true, message: '注射指示箋の変更を保存しました' });
});

// 6. 全未完了オーダーのステータス一括同期 API (GET /api/orders/sync-all)
app.get('/api/orders/sync-all', async (req, res) => {
  const pendingOrders = sentOrders.filter(o => o.status !== 'COMPLETED' && o.status !== 'FAILED' && o.targetUrl);
  let updatedCount = 0;

  for (const item of pendingOrders) {
    try {
      const receiverBase = item.targetUrl.split('/api/')[0];
      const statusUrl = `${receiverBase}/api/orders/${item.orderId}`;
      const response = await fetch(statusUrl, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.order && data.order.status !== item.status) {
          item.status = data.order.status;
          item.receiverOrder = data.order;
          item.lastActor = (data.order.executionHistory && data.order.executionHistory.slice(-1)[0]?.actor) || '';
          item.lastNote = (data.order.executionHistory && data.order.executionHistory.slice(-1)[0]?.note) || '';
          updatedCount++;
        }
      }
    } catch (err) {
      // 個別同期失敗は無視
    }
  }

  if (updatedCount > 0) {
    saveSentOrders(sentOrders);
    console.log(`🔄 [Sender] ステータス同期完了: ${updatedCount}件更新`);
    broadcastSse('status-update', { orders: sentOrders, updatedCount });
  }

  res.json({ success: true, updatedCount, orders: sentOrders });
});

// 7. ⚡ SSE (Server-Sent Events) リアルタイム更新ストリーム API
app.get('/api/orders/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const clientId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const client = { id: clientId, res };
  sseClients.push(client);

  // 初回接続確認と最新データの即時送信
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, count: sentOrders.length })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// 8. 履歴クリア
app.post('/api/orders/clear-history', (req, res) => {
  sentOrders = [];
  saveSentOrders(sentOrders);
  console.log('🧹 [Sender] 送信履歴をクリアしました');
  res.json({ success: true, message: '送信履歴をクリアしました' });
});

const HTTP_PORT = parseInt(process.env.PORT, 10) || 4000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 4443;

// 1. HTTP サーバー起動 (LAN内端末・一般的なブラウザアクセス用)
const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 オーダリング【送信側】(Sender) HTTP 稼働中 [平文/LAN推奨]`);
  console.log(`   ローカルURL : http://localhost:${HTTP_PORT}`);
  console.log(`   LAN内URL   : http://192.168.0.5:${HTTP_PORT}`);
  console.log(`   送信先デフォルト: http://localhost:5000`);
  console.log(`======================================================`);
});

// 2. HTTPS サーバー起動 (SSL証明書が存在する場合)
if (isHttps) {
  try {
    const sslOptions = {
      key: fs.readFileSync(KEY_FILE),
      cert: fs.readFileSync(CERT_FILE)
    };
    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`🔒 オーダリング【送信側】(Sender) HTTPS 稼働中 [暗号化]`);
      console.log(`   ローカルURL : https://localhost:${HTTPS_PORT}`);
      console.log(`   LAN内URL   : https://192.168.0.5:${HTTPS_PORT}`);
      console.log(`======================================================\n`);
    });
  } catch (err) {
    console.warn(`[Sender] HTTPS サーバーの起動をスキップしました:`, err.message);
  }
}
