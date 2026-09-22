const http = require('http');
const https = require('https');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { generateOrderId } = require('../shared/orderSchema');
const medicineMaster = require('../shared/medicineMaster');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_FILE = path.join(__dirname, 'orders_db.json');

// SSL証明書の確認とプロトコル決定
const USE_HTTPS = process.env.USE_HTTPS === 'true' || process.env.USE_HTTPS === '1';
const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_FILE = path.join(CERT_DIR, 'server.key');
const CERT_FILE = path.join(CERT_DIR, 'server.crt');
const isHttps = USE_HTTPS && fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE);
const protocol = isHttps ? 'https' : 'http';

// 自己署名証明書（HTTPS）環境でのコールバック送信エラーを回避
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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// データロード / セーブ用ヘルパー
function loadOrders() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[Receiver] DB読み込みエラー:', e.message);
  }
  return [];
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2), 'utf8');
  } catch (e) {
    console.error('[Receiver] DB保存エラー:', e.message);
  }
}

let receivedOrders = loadOrders();

// 薬剤マスタ付加ヘルパー（複数薬剤オーダー対応）
function enrichOrderWithMedicine(order) {
  if (!order) return order;
  if (!order.details) return order;

  const details = { ...order.details };
  let medicines = details.medicines;

  // 複数薬剤配列が存在しない場合（旧形式や単一薬剤の互換性確保）
  if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
    if (details.medicine) {
      medicines = [
        {
          rp: 1,
          medicineId: details.medicineId || '',
          medicine: details.medicine,
          dosage: details.dosage || details.dose || '指示通り',
          days: details.days || '7',
          quantity: details.quantity || '',
          instruction: details.instruction || ''
        }
      ];
    } else {
      medicines = [];
    }
  }

  // 各薬剤に対して薬剤マスタ情報を付与
  const enrichedMedicines = medicines.map((item, idx) => {
    let med = null;
    if (item.medicineId) {
      med = medicineMaster.getMedicineById(item.medicineId);
    }
    if (!med && item.medicine) {
      med = medicineMaster.getMedicineByName(item.medicine);
    }
    return {
      ...item,
      rp: item.rp || (idx + 1),
      medicineMaster: med ? {
        id: med.id,
        name: med.name,
        genericName: med.genericName,
        category: med.category,
        dosage: med.dosage,
        suspensionOk: med.suspensionOk,
        crushOk: med.crushOk,
        uncapsuleOk: med.uncapsuleOk,
        brandType: med.brandType,
        therapeuticCategoryMajor: med.therapeuticCategoryMajor,
        therapeuticCategoryMiddle: med.therapeuticCategoryMiddle,
        pharmacyComment: med.pharmacyComment,
        remarks: med.remarks
      } : null
    };
  });

  // 第一代表薬剤マスタ (後方互換性)
  let primaryMed = null;
  const firstWithMaster = enrichedMedicines.find(m => m.medicineMaster);
  if (firstWithMaster) {
    primaryMed = firstWithMaster.medicineMaster;
  } else if (details.medicineId) {
    primaryMed = medicineMaster.getMedicineById(details.medicineId);
  } else if (details.medicine) {
    primaryMed = medicineMaster.getMedicineByName(details.medicine);
  }

  return {
    ...order,
    details: {
      ...details,
      medicines: enrichedMedicines
    },
    medicineMaster: primaryMed,
    medicineMasterList: enrichedMedicines.map(m => m.medicineMaster).filter(Boolean)
  };
}

// 1. Web画面: 受信モニター画面
app.get('/', (req, res) => {
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  const hostname = hostHeader.split(':')[0] || 'localhost';
  const isEncrypted = req.socket.encrypted || (req.headers['x-forwarded-proto'] === 'https');
  const currentProto = isEncrypted ? 'https' : 'http';
  const senderPort = isEncrypted ? (process.env.HTTPS_SENDER_PORT || 4443) : 4000;
  res.render('index', {
    orders: receivedOrders.map(enrichOrderWithMedicine),
    port: req.socket.localPort || PORT,
    isHttps: isEncrypted,
    protocol: currentProto,
    serverHostname: hostname,
    senderPort: senderPort
  });
});

// 2. 受信オーダー一覧取得 API
app.get('/api/orders', (req, res) => {
  res.json({
    success: true,
    count: receivedOrders.length,
    orders: receivedOrders.map(enrichOrderWithMedicine)
  });
});

// 2-2. 薬剤マスタ検索 API (GET /api/medicines)
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

// 2-3. 薬剤個別詳細 API (GET /api/medicines/:id)
app.get('/api/medicines/:id', (req, res) => {
  const med = medicineMaster.getMedicineById(req.params.id);
  if (!med) {
    return res.status(404).json({ success: false, error: '指定の薬剤が見つかりません' });
  }
  res.json({ success: true, medicine: med });
});

// 3. 個別オーダー取得 API
app.get('/api/orders/:id', (req, res) => {
  const order = receivedOrders.find(o => o.orderId === req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, error: 'オーダーが見つかりません' });
  }
  res.json({ success: true, order: enrichOrderWithMedicine(order) });
});

// 4. 総合オーダー受信 API (POST /api/orders/receive)
app.post('/api/orders/receive', (req, res) => {
  try {
    const data = req.body;
    const now = new Date();

    const orderId = data.orderId || generateOrderId(data.orderType || 'ORD');
    const orderRecord = {
      orderId,
      orderType: data.orderType || 'GENERAL',
      title: data.title || `${data.orderType || '一般'}オーダー`,
      priority: data.priority || 'ROUTINE',
      patient: data.patient || {
        id: data.targetCustomId || 'UNKNOWN',
        name: data.targetName || '未指定患者',
        department: data.targetDepartment || '一般病棟'
      },
      doctor: data.doctor || {
        name: data.senderUser || '送信元医師',
        department: data.senderDept || '診療科'
      },
      details: data.details || {},
      orderDate: data.orderDate || data.details?.orderDate || data.createdAt || now.toISOString(),
      createdAt: data.createdAt || now.toISOString(),
      status: 'RECEIVED',
      senderHost: data.senderHost || req.headers['host'] || req.ip,
      receivedAt: now.toISOString(),
      executionHistory: [
        {
          status: 'RECEIVED',
          timestamp: now.toISOString(),
          actor: '受信サーバー (Receiver)',
          note: 'オーダーを受信・登録しました'
        }
      ]
    };

    receivedOrders.unshift(orderRecord);
    saveOrders(receivedOrders);

    console.log(`\n📥 [Receiver] 新着オーダー受信: [${orderRecord.orderId}] ${orderRecord.title} (患者: ${orderRecord.patient.name})`);

    res.status(201).json({
      success: true,
      message: 'オーダーを正常に受信しました',
      orderId: orderRecord.orderId,
      status: orderRecord.status,
      receivedAt: orderRecord.receivedAt
    });
  } catch (err) {
    console.error('[Receiver] 受信エラー:', err);
    res.status(500).json({ success: false, error: 'オーダー受信処理エラー: ' + err.message });
  }
});

// 5. incident-system互換: 点滴オーダー受信 (POST /api/iv-orders/receive)
app.post('/api/iv-orders/receive', (req, res) => {
  try {
    const { orderId, targetCustomId, targetName, targetDepartment, scheduledAt, medicine, dose, rate, route, remarks, senderHost, senderUser } = req.body;
    const now = new Date();
    const finalOrderId = orderId || generateOrderId('IV');

    const orderRecord = {
      orderId: finalOrderId,
      orderType: 'IV',
      title: `💉 点滴指示: ${medicine || '点滴輸液'} (${targetName || targetCustomId || '患者'})`,
      priority: 'ROUTINE',
      patient: {
        id: targetCustomId || 'P000',
        name: targetName || '対象者',
        department: targetDepartment || '一般病棟'
      },
      doctor: {
        name: senderUser || '医師',
        department: '診療科'
      },
      details: {
        medicine: medicine || '',
        dose: dose || '',
        rate: rate || '',
        route: route || '点滴静注',
        remarks: remarks || '',
        scheduledAt: scheduledAt || now.toISOString()
      },
      status: 'RECEIVED',
      senderHost: senderHost || req.headers['host'] || req.ip,
      receivedAt: now.toISOString(),
      executionHistory: [
        {
          status: 'RECEIVED',
          timestamp: now.toISOString(),
          actor: '薬剤部 / 病棟受信端末',
          note: '点滴オーダーを受信しました'
        }
      ]
    };

    receivedOrders.unshift(orderRecord);
    saveOrders(receivedOrders);

    console.log(`\n💉 [Receiver: 薬剤部] 点滴オーダー受信: [${orderRecord.orderId}] ${medicine} (患者: ${targetName})`);

    res.status(201).json({
      success: true,
      message: '点滴オーダーを受信しました',
      orderId: finalOrderId,
      status: 'RECEIVED',
      receivedAt: orderRecord.receivedAt
    });
  } catch (err) {
    console.error('[Receiver] 点滴オーダー受信エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. incident-system互換: 放射線オーダー受信 (POST /api/radiology-orders/receive)
app.post('/api/radiology-orders/receive', (req, res) => {
  try {
    const { orderId, targetCustomId, targetName, targetDepartment, scheduledAt, examType, modality, contrast, portable, purpose, remarks, senderHost, senderUser } = req.body;
    const now = new Date();
    const finalOrderId = orderId || generateOrderId('RAD');

    const orderRecord = {
      orderId: finalOrderId,
      orderType: 'RADIOLOGY',
      title: `🩻 放射線科検査指示: ${examType || 'X線撮影'} (${targetName || targetCustomId || '患者'})`,
      priority: 'ROUTINE',
      patient: {
        id: targetCustomId || 'P000',
        name: targetName || '対象者',
        department: targetDepartment || '一般病棟'
      },
      doctor: {
        name: senderUser || '医師',
        department: '診療科'
      },
      details: {
        examType: examType || '胸部X線',
        modality: modality || '一般撮影 (X-Ray)',
        contrast: contrast || '単純',
        portable: portable || '撮影室',
        purpose: purpose || '精査・経過観察',
        remarks: remarks || '',
        scheduledAt: scheduledAt || now.toISOString()
      },
      status: 'RECEIVED',
      senderHost: senderHost || req.headers['host'] || req.ip,
      receivedAt: now.toISOString(),
      executionHistory: [
        {
          status: 'RECEIVED',
          timestamp: now.toISOString(),
          actor: '放射線科受信端末',
          note: '放射線検査オーダーを受信しました'
        }
      ]
    };

    receivedOrders.unshift(orderRecord);
    saveOrders(receivedOrders);

    console.log(`\n🩻 [Receiver: 放射線科] 検査オーダー受信: [${orderRecord.orderId}] ${examType} (患者: ${targetName})`);

    res.status(201).json({
      success: true,
      message: '放射線オーダーを受信しました',
      orderId: finalOrderId,
      status: 'RECEIVED',
      receivedAt: orderRecord.receivedAt
    });
  } catch (err) {
    console.error('[Receiver] 放射線オーダー受信エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. incident-system互換: 食事オーダー受信 (POST /api/meal-orders/receive)
app.post('/api/meal-orders/receive', (req, res) => {
  try {
    const { orderId, targetCustomId, targetName, targetDepartment, scheduledAt, mealType, timing, stapleFood, sideDish, allergies, remarks, senderHost, senderUser } = req.body;
    const now = new Date();
    const finalOrderId = orderId || generateOrderId('MEAL');

    const orderRecord = {
      orderId: finalOrderId,
      orderType: 'MEAL',
      title: `🍱 食事指示: ${mealType || '常食'} (${targetName || targetCustomId || '患者'})`,
      priority: 'ROUTINE',
      patient: {
        id: targetCustomId || 'P000',
        name: targetName || '対象者',
        department: targetDepartment || '一般病棟'
      },
      doctor: {
        name: senderUser || '医師',
        department: '診療科'
      },
      details: {
        mealType: mealType || '常食',
        timing: timing || '毎食',
        stapleFood: stapleFood || '米飯',
        sideDish: sideDish || '常菜',
        allergies: allergies || 'なし',
        remarks: remarks || '',
        scheduledAt: scheduledAt || now.toISOString()
      },
      status: 'RECEIVED',
      senderHost: senderHost || req.headers['host'] || req.ip,
      receivedAt: now.toISOString(),
      executionHistory: [
        {
          status: 'RECEIVED',
          timestamp: now.toISOString(),
          actor: '栄養管理室 受信端末',
          note: '食事選択オーダーを受信しました'
        }
      ]
    };

    receivedOrders.unshift(orderRecord);
    saveOrders(receivedOrders);

    console.log(`\n🍱 [Receiver: 栄養科] 食事オーダー受信: [${orderRecord.orderId}] ${mealType} (患者: ${targetName})`);

    res.status(201).json({
      success: true,
      message: '食事オーダーを受信しました',
      orderId: finalOrderId,
      status: 'RECEIVED',
      receivedAt: orderRecord.receivedAt
    });
  } catch (err) {
    console.error('[Receiver] 食事オーダー受信エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. 部門実施確認・ステータス更新 API (POST /api/orders/:id/status)
app.post('/api/orders/:id/status', (req, res) => {
  const { status, actor, note } = req.body;
  const order = receivedOrders.find(o => o.orderId === req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, error: 'オーダーが見つかりません' });
  }

  const now = new Date();
  order.status = status;
  order.executionHistory = order.executionHistory || [];
  order.executionHistory.push({
    status,
    timestamp: now.toISOString(),
    actor: actor || '部門担当者',
    note: note || ''
  });

  saveOrders(receivedOrders);
  console.log(`\n⚙️ [Receiver] ステータス更新: [${order.orderId}] -> ${status} (${actor || '担当者'})`);

  // 🔔 送信元サーバー (order.senderHost) への自動コールバック通知
  if (order.senderHost) {
    let callbackBase = order.senderHost.replace(/\/+$/, '');
    
    // 互換性補正: もし https://...:4000 だった場合は http://...:4000 または https://...:4443 を試す
    const targetsToTry = [];
    if (callbackBase.startsWith('https://') && callbackBase.endsWith(':4000')) {
      targetsToTry.push(callbackBase.replace('https://', 'http://'));
      targetsToTry.push(callbackBase.replace(':4000', ':4443'));
    } else {
      targetsToTry.push(callbackBase);
      if (callbackBase.startsWith('https://')) {
        targetsToTry.push(callbackBase.replace('https://', 'http://'));
      }
    }

    const payload = JSON.stringify({
      orderId: order.orderId,
      status,
      actor: actor || '部門担当者',
      note: note || '',
      updatedAt: now.toISOString(),
      order
    });

    (async () => {
      for (const base of targetsToTry) {
        const callbackUrl = `${base}/api/orders/${order.orderId}/status-callback`;
        try {
          console.log(`   📡 送信元へステータス通知中: ${callbackUrl} (${status})`);
          const cbRes = await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(3000)
          });
          if (cbRes.ok) {
            console.log(`   ✅ [Receiver] 送信元へのステータス通知成功: [${order.orderId}] -> ${status}`);
            break;
          } else {
            console.log(`   ⚠️ [Receiver] 送信元通知 HTTP ${cbRes.status}`);
          }
        } catch (err) {
          console.log(`   ℹ️ [Receiver] コールバック試行エラー (${base}): ${err.message}`);
        }
      }
    })();
  }

  res.json({ success: true, message: 'ステータスを更新しました', order });
});

// 8-B. 💉 注射指示箋 編集・実施確認保存 API (POST /api/orders/:id/injection-sheet)
app.post('/api/orders/:id/injection-sheet', (req, res) => {
  const { sheetState, medicines, pharmacistChecked, remarks } = req.body;
  const order = receivedOrders.find(o => o.orderId === req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, error: 'オーダーが見つかりません' });
  }

  order.details = order.details || {};
  if (sheetState) order.details.injectionSheetState = sheetState;
  if (medicines) order.details.medicines = medicines;
  if (typeof pharmacistChecked === 'boolean') order.details.pharmacistChecked = pharmacistChecked;
  if (remarks !== undefined) order.details.remarks = remarks;

  saveOrders(receivedOrders);
  console.log(`\n💉 [Receiver] 注射指示箋の変更・実施確認を保存: [${order.orderId}]`);
  res.json({ success: true, message: '注射指示箋の変更内容を保存しました', order });
});

// 9. 練習用データ全消去 API (POST /api/orders/clear)
app.post('/api/orders/clear', (req, res) => {
  receivedOrders = [];
  saveOrders(receivedOrders);
  console.log('\n🧹 [Receiver] 練習用オーダーデータをクリアしました');
  res.json({ success: true, message: 'オーダーデータをクリアしました' });
});

const HTTP_PORT = parseInt(process.env.PORT, 10) || 5000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 5443;

// 1. HTTP サーバー起動 (LAN内端末・一般的なブラウザアクセス用)
const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🏥 オーダリング【受信側】(Receiver) HTTP 稼働中 [平文/LAN推奨]`);
  console.log(`   ローカルURL : http://localhost:${HTTP_PORT}`);
  console.log(`   LAN内URL   : http://192.168.0.5:${HTTP_PORT}`);
  console.log(`   受信エンドポイント: http://localhost:${HTTP_PORT}/api/orders/receive`);
  console.log(`   incident-system互換: http://localhost:${HTTP_PORT}/api/iv-orders/receive`);
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
      console.log(`🔒 オーダリング【受信側】(Receiver) HTTPS 稼働中 [暗号化]`);
      console.log(`   ローカルURL : https://localhost:${HTTPS_PORT}`);
      console.log(`   LAN内URL   : https://192.168.0.5:${HTTPS_PORT}`);
      console.log(`======================================================\n`);
    });
  } catch (err) {
    console.warn(`[Receiver] HTTPS サーバーの起動をスキップしました:`, err.message);
  }
}
