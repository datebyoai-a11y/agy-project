/**
 * 🤸 交雄会だて病院 リハビリテーション科 指示受け・実施モニター フロントエンド制御 (app.js)
 * 
 * 1. 職種別・療法別 縦3列 (Kanban) 表示 (PT / OT / ST & 物理療法)
 * 2. 全件一覧形式 (テーブルビュー) 表示（「すべて表示」選択時に自動切り替え）
 * 3. ワンクリック「📥 受付」「▶️ 実施中」「✅ 実施済」「↩️ 戻す」
 * 4. リアルタイム自動ポーリング (4秒)
 * 5. リハビリテーション指示書Ver3.0原本プレビュー連携
 */

// 状態管理
let currentFilter = 'ACTIVE'; // 'ACTIVE' (未受付+受付済+実施中), 'ALL', 'ordered', 'in_progress', 'completed'
let currentViewMode = 'kanban'; // 'kanban' | 'list'
let searchQuery = '';
let isPollingActive = true;
let pollTimer = null;
let currentOrders = [];
let currentCounts = {};
let selectedOrderIdForRecord = null;

// DOM要素
const elKanbanContainer = document.getElementById('kanbanContainer');
const elListViewContainer = document.getElementById('listViewContainer');
const elOrdersTableBody = document.getElementById('ordersTableBody');
const elTableCountBadge = document.getElementById('tableCountBadge');

// カラム別リスト要素
const elPtList = document.getElementById('ptCardList');
const elOtList = document.getElementById('otCardList');
const elStList = document.getElementById('stCardList');

// バッジ要素
const elStatOrdered = document.getElementById('statOrdered');
const elStatAccepted = document.getElementById('statAccepted');
const elStatInProgress = document.getElementById('statInProgress');
const elStatCompleted = document.getElementById('statCompleted');
const elStatRisk = document.getElementById('statRisk');

const elBadgePtCount = document.getElementById('badgePtCount');
const elBadgeOtCount = document.getElementById('badgeOtCount');
const elBadgeStCount = document.getElementById('badgeStCount');

const elSearchInput = document.getElementById('searchInput');
const elRefreshBtn = document.getElementById('refreshBtn');

// テーブルソート
let tableSortKey = 'orderDate';
let tableSortOrder = 'desc';

// 🖨️ リハビリ指示書 A4原本プレビューを開く
function openRehabSlip(orderId) {
  if (!orderId) return;
  const w = window.screen.availWidth || 1280;
  const h = window.screen.availHeight || 900;
  const url = `/rehabili/orders/${orderId}/print`;
  const winName = `rehab_order_${orderId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const features = `width=${w},height=${h},top=0,left=0,scrollbars=yes,resizable=yes,status=no,toolbar=no,menubar=no,location=no`;
  
  const win = window.open(url, winName, features);
  if (win) {
    win.focus();
  } else {
    window.open(url, '_blank');
  }
}

// 初期ロード
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupTableSortListeners();
  setViewMode('kanban');
  loadOrders();
  startPolling();
});

function setupEventListeners() {
  // フィルターボタン
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.getAttribute('data-filter');

      if (currentFilter === 'ALL') {
        setViewMode('list');
      } else {
        setViewMode('kanban');
      }

      loadOrders();
    });
  });

  // 検索入力
  let searchTimeout = null;
  if (elSearchInput) {
    elSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchQuery = e.target.value.trim();
        loadOrders();
      }, 250);
    });
  }

  // 手動更新ボタン
  if (elRefreshBtn) {
    elRefreshBtn.addEventListener('click', () => {
      loadOrders(true);
    });
  }

  // 実施記録モーダルボタン
  const recordSubmitBtn = document.getElementById('recordSubmitBtn');
  if (recordSubmitBtn) {
    recordSubmitBtn.addEventListener('click', submitRecordComplete);
  }
}

function setViewMode(mode) {
  currentViewMode = mode;
  if (mode === 'list') {
    if (elKanbanContainer) elKanbanContainer.style.display = 'none';
    if (elListViewContainer) elListViewContainer.style.display = 'block';
  } else {
    if (elKanbanContainer) elKanbanContainer.style.display = 'grid';
    if (elListViewContainer) elListViewContainer.style.display = 'none';
  }
}

// ポーリング制御
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (isPollingActive) {
      loadOrders(false);
    }
  }, 4000);
}

// 📡 オーダー一覧ロード
async function loadOrders(isManual = false) {
  try {
    const params = new URLSearchParams();
    if (currentFilter) params.append('status', currentFilter);
    if (searchQuery) params.append('search', searchQuery);

    const res = await fetch(`/reha-uke/api/orders?${params.toString()}`);
    if (!res.ok) {
      // プロキシなし直接アクセスのフォールバック
      const directRes = await fetch(`/api/orders?${params.toString()}`);
      if (!directRes.ok) throw new Error('API request failed');
      const data = await directRes.json();
      renderOrders(data);
      return;
    }

    const data = await res.json();
    renderOrders(data);

    if (isManual && elRefreshBtn) {
      elRefreshBtn.textContent = '✅ 更新完了';
      setTimeout(() => {
        elRefreshBtn.textContent = '🔄 今すぐ更新';
      }, 1000);
    }
  } catch (err) {
    console.warn('⚠️ オーダー取得エラー:', err);
  }
}

// 描画メイン処理
function renderOrders(data) {
  if (!data || !data.success) return;

  currentOrders = data.orders || [];
  currentCounts = data.counts || {};

  // 1. 統計バッジ更新
  if (elStatOrdered) elStatOrdered.textContent = currentCounts.ordered || 0;
  if (elStatAccepted) elStatAccepted.textContent = currentCounts.received || 0;
  if (elStatInProgress) elStatInProgress.textContent = currentCounts.in_progress || 0;
  if (elStatCompleted) elStatCompleted.textContent = currentCounts.completed || 0;
  if (elStatRisk) elStatRisk.textContent = currentCounts.risk || 0;

  // 2. カラム別件数バッジ更新
  if (elBadgePtCount) elBadgePtCount.textContent = (data.grouped?.pt?.length || 0) + '件';
  if (elBadgeOtCount) elBadgeOtCount.textContent = (data.grouped?.ot?.length || 0) + '件';
  if (elBadgeStCount) elBadgeStCount.textContent = (data.grouped?.st?.length || 0) + '件';
  if (elTableCountBadge) elTableCountBadge.textContent = (currentOrders.length || 0) + '件';

  // 3. ビュー別の描画
  if (currentViewMode === 'list') {
    renderListView(currentOrders);
  } else {
    renderKanbanColumn(elPtList, data.grouped?.pt || [], 'pt');
    renderKanbanColumn(elOtList, data.grouped?.ot || [], 'ot');
    renderKanbanColumn(elStList, data.grouped?.st || [], 'st');
  }
}

// 縦列 (Kanban) のレンダリング
function renderKanbanColumn(container, orders, columnType) {
  if (!container) return;
  if (orders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📭</span>
        <p>該当する指示書はありません</p>
      </div>
    `;
    return;
  }

  container.innerHTML = orders.map(order => createOrderCardHtml(order, columnType)).join('');
}

// 急変リスクバッジ生成
function getRiskBadgesHtml(order) {
  const badges = [];
  if (order.riskCirculatory) badges.push('<span class="risk-badge">🚨 循環器異常</span>');
  if (order.riskRespiratory) badges.push(`<span class="risk-badge">🫁 呼吸不全 ${order.oxygenFlow ? '(' + order.oxygenFlow + 'L)' : ''}</span>`);
  if (order.riskMedicine) badges.push('<span class="risk-badge">💊 薬剤影響</span>');
  if (order.riskJoint) badges.push(`<span class="risk-badge">🦴 人工関節 ${order.jointSide || ''}${order.jointPart || ''}</span>`);
  if (order.riskDementia) badges.push('<span class="risk-badge">🧠 認知症</span>');
  if (order.contraindications) badges.push(`<span class="risk-badge" title="${escapeHtml(order.contraindications)}">⚠️ 禁忌: ${escapeHtml(order.contraindications.substring(0, 10))}...</span>`);
  return badges.length > 0 ? `<div style="display:flex; flex-wrap:wrap; gap:3px; margin:4px 0;">${badges.join('')}</div>` : '';
}

// 指示療法タグ生成
function getTherapyTagsHtml(order) {
  const tags = [];
  const { isPt, isOt, isSt } = order.therapies || {};
  if (isPt) tags.push('<span class="tag-therapy tag-pt">PT 理学</span>');
  if (isOt) tags.push('<span class="tag-therapy tag-ot">OT 作業</span>');
  if (isSt) tags.push('<span class="tag-therapy tag-st">ST 言語・消炎</span>');
  return tags.join('');
}

// ステータスバッジ生成
function getStatusBadgeHtml(status) {
  switch (status) {
    case 'ordered':
      return '<span class="status-badge status-ordered">🟡 未受付</span>';
    case 'received':
      return '<span class="status-badge status-accepted">🔵 受付済</span>';
    case 'in_progress':
      return '<span class="status-badge" style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe;">🟣 実施中</span>';
    case 'completed':
      return '<span class="status-badge status-completed">🟢 実施済</span>';
    default:
      return '<span class="status-badge">未設定</span>';
  }
}

// オーダーカード HTML
function createOrderCardHtml(order, columnType) {
  const id = order._id;
  const status = order.status || 'ordered';
  const wardInfo = order.ward ? `${order.ward} ${order.roomNo ? order.roomNo + '号室' : ''}` : (order.patientType === 'outpatient' ? '外来' : '病棟未定');
  const summary = order.summaryItems || {};

  // アクションボタン定義
  let actionButtonsHtml = '';
  if (status === 'ordered') {
    actionButtonsHtml = `
      <button class="btn btn-sm btn-accept" onclick="acceptOrder('${id}', event)" title="指示書を受付済みにします">
        📥 受付
      </button>
    `;
  } else if (status === 'received') {
    actionButtonsHtml = `
      <button class="btn btn-sm btn-outline" onclick="startInProgress('${id}', event)" style="background:#e0e7ff; color:#3730a3; border-color:#c7d2fe;" title="本日の訓練を開始します">
        ▶️ 実施中
      </button>
      <button class="btn btn-sm btn-complete" onclick="openRecordModal('${id}', event)" title="訓練を完了し実施記録を残します">
        ✅ 実施済
      </button>
    `;
  } else if (status === 'in_progress') {
    actionButtonsHtml = `
      <button class="btn btn-sm btn-complete" onclick="openRecordModal('${id}', event)" title="訓練を完了し実施記録を残します">
        ✅ 実施済
      </button>
    `;
  } else if (status === 'completed') {
    actionButtonsHtml = `
      <span style="font-size:0.75rem; color:#10b981; font-weight:700; align-self:center;">
        🏁 ${order.completedBy ? order.completedBy + ' 実施' : '実施完了'}
      </span>
    `;
  }

  // 戻すボタン（ordered以外で表示）
  const revertBtnHtml = (status !== 'ordered') ? `
    <button class="btn btn-sm btn-outline btn-revert" onclick="revertOrder('${id}', event)" title="前の状態に戻します">
      ↩️ 戻す
    </button>
  ` : '';

  return `
    <article class="order-card card-status-${status}" data-id="${id}" onclick="openRehabSlip('${id}')" style="cursor:pointer;" title="クリックでリハビリ指示書原本を表示">
      <div class="card-header-line">
        <span class="order-num">${order.orderNumber || '--'}</span>
        ${getStatusBadgeHtml(status)}
      </div>

      <div class="card-patient-line" style="margin-top:6px;">
        <span class="patient-name" style="font-size:1.05rem; font-weight:700; color:#0f172a;">${escapeHtml(order.patientName)}</span>
        <span class="patient-meta" style="font-size:0.78rem; color:#64748b; margin-left:6px;">
          ${order.patientGender || ''} ${order.patientAge ? order.patientAge + '歳' : ''} (ID: ${order.patientId})
        </span>
      </div>

      <div class="card-info-grid" style="font-size:0.78rem; color:#475569; margin-top:6px; display:grid; grid-template-columns:1fr 1fr; gap:3px;">
        <div>🏥 <strong>${escapeHtml(wardInfo)}</strong></div>
        <div>👨‍⚕️ <strong>${escapeHtml(order.doctorName || '主治医')}</strong></div>
        <div style="grid-column:1 / -1;">🩺 <strong>${escapeHtml(order.diagnosisName || '診断名未定')}</strong></div>
      </div>

      ${getRiskBadgesHtml(order)}

      <!-- 具体的指示サマリー -->
      <div class="card-summary" style="margin-top:6px; background:#f8fafc; padding:5px 8px; border-radius:4px; border:1px solid #e2e8f0; font-size:0.75rem; color:#334155;">
        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
          <div>${getTherapyTagsHtml(order)}</div>
          <div style="color:#64748b; font-weight:600;">週${order.frequencyPerWeek || '2〜3'}回 / ${order.durationMonths || '3'}ヶ月</div>
        </div>
        ${summary.pt ? `<div><strong>PT:</strong> ${escapeHtml(summary.pt)}</div>` : ''}
        ${summary.ot ? `<div><strong>OT:</strong> ${escapeHtml(summary.ot)}</div>` : ''}
        ${summary.st ? `<div><strong>ST/物理:</strong> ${escapeHtml(summary.st)}</div>` : ''}
        ${order.rehabNotes ? `<div style="margin-top:3px; color:#047857; font-weight:600;">📝 メモ: ${escapeHtml(order.rehabNotes)}</div>` : ''}
      </div>

      <div class="card-footer" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; gap:6px;" onclick="event.stopPropagation();">
        <button class="btn btn-sm btn-outline" onclick="openRehabSlip('${id}')" title="A4リハビリ指示書原本を表示">
          📄 原本閲覧
        </button>
        <div style="display:flex; gap:4px; align-items:center;">
          ${actionButtonsHtml}
          ${revertBtnHtml}
        </div>
      </div>
    </article>
  `;
}

// 一覧テーブル表示
function renderListView(orders) {
  if (!elOrdersTableBody) return;
  if (orders.length === 0) {
    elOrdersTableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:#94a3b8;">該当する指示書はありません</td></tr>`;
    return;
  }

  // ソート
  const sorted = [...orders].sort((a, b) => {
    let valA = a[tableSortKey] || '';
    let valB = b[tableSortKey] || '';
    if (tableSortKey === 'risk') {
      valA = (a.riskCirculatory || a.riskRespiratory || a.riskMedicine || a.riskJoint || a.riskDementia) ? 1 : 0;
      valB = (b.riskCirculatory || b.riskRespiratory || b.riskMedicine || b.riskJoint || b.riskDementia) ? 1 : 0;
    }
    if (tableSortOrder === 'asc') return valA > valB ? 1 : -1;
    return valA < valB ? 1 : -1;
  });

  elOrdersTableBody.innerHTML = sorted.map(order => {
    const id = order._id;
    const status = order.status || 'ordered';
    const wardInfo = order.ward ? `${order.ward} ${order.roomNo || ''}` : (order.patientType === 'outpatient' ? '外来' : '病棟');

    let actionBtn = '';
    if (status === 'ordered') {
      actionBtn = `<button class="btn btn-sm btn-accept" onclick="acceptOrder('${id}', event)">📥 受付</button>`;
    } else if (status === 'received') {
      actionBtn = `
        <button class="btn btn-sm btn-outline" onclick="startInProgress('${id}', event)">▶️ 実施中</button>
        <button class="btn btn-sm btn-complete" onclick="openRecordModal('${id}', event)">✅ 済</button>
      `;
    } else if (status === 'in_progress') {
      actionBtn = `<button class="btn btn-sm btn-complete" onclick="openRecordModal('${id}', event)">✅ 済</button>`;
    } else {
      actionBtn = `<span style="color:#10b981; font-weight:700;">🏁 完了</span>`;
    }

    const revertBtn = (status !== 'ordered') ? `<button class="btn btn-sm btn-outline btn-revert" onclick="revertOrder('${id}', event)">↩️</button>` : '';

    return `
      <tr onclick="openRehabSlip('${id}')" style="cursor:pointer;">
        <td><strong>${order.orderNumber || '--'}</strong></td>
        <td>${order.orderDate || '--'}</td>
        <td><strong>${escapeHtml(order.patientName)}</strong> <span style="font-size:0.75rem; color:#64748b;">(${order.patientId})</span></td>
        <td>${escapeHtml(wardInfo)}</td>
        <td>${escapeHtml(order.diagnosisName || '--')}</td>
        <td>${getTherapyTagsHtml(order)}</td>
        <td>${escapeHtml(order.doctorName || '--')}</td>
        <td>${getRiskBadgesHtml(order) || '<span style="color:#94a3b8;">なし</span>'}</td>
        <td>${getStatusBadgeHtml(status)}</td>
        <td style="text-align:center;" onclick="event.stopPropagation();">
          <div style="display:flex; gap:4px; justify-content:center; align-items:center;">
            <button class="btn btn-sm btn-outline" onclick="openRehabSlip('${id}')">📄</button>
            ${actionBtn}
            ${revertBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// テーブルソート制御
function setupTableSortListeners() {
  document.querySelectorAll('.orders-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (tableSortKey === key) {
        tableSortOrder = tableSortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        tableSortKey = key;
        tableSortOrder = 'asc';
      }
      renderListView(currentOrders);
    });
  });
}

// 📥 受付 API 実行
async function acceptOrder(id, event) {
  if (event) event.stopPropagation();
  try {
    const res = await fetch(`/reha-uke/api/orders/${id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await res.json();
    if (result.success) {
      loadOrders();
    } else {
      alert('受付に失敗しました: ' + (result.message || ''));
    }
  } catch (err) {
    alert('通信エラー: ' + err.message);
  }
}

// ▶️ 実施中 API 実行
async function startInProgress(id, event) {
  if (event) event.stopPropagation();
  try {
    const res = await fetch(`/reha-uke/api/orders/${id}/in-progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await res.json();
    if (result.success) {
      loadOrders();
    } else {
      alert('変更に失敗しました: ' + (result.message || ''));
    }
  } catch (err) {
    alert('通信エラー: ' + err.message);
  }
}

// ↩️ 戻す API 実行
async function revertOrder(id, event) {
  if (event) event.stopPropagation();
  if (!confirm('ステータスを前の状態に戻しますか？')) return;
  try {
    const res = await fetch(`/reha-uke/api/orders/${id}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await res.json();
    if (result.success) {
      loadOrders();
    } else {
      alert('戻しに失敗しました: ' + (result.message || ''));
    }
  } catch (err) {
    alert('通信エラー: ' + err.message);
  }
}

// 実施記録モーダル開閉
function openRecordModal(id, event) {
  if (event) event.stopPropagation();
  selectedOrderIdForRecord = id;
  const modal = document.getElementById('recordModal');
  const notes = document.getElementById('recordNotes');
  if (notes) notes.value = '';
  if (modal) modal.style.display = 'flex';
}

function closeRecordModal() {
  selectedOrderIdForRecord = null;
  const modal = document.getElementById('recordModal');
  if (modal) modal.style.display = 'none';
}

async function submitRecordComplete() {
  if (!selectedOrderIdForRecord) return;
  const staffName = document.getElementById('recordStaffName')?.value.trim() || 'リハビリ科スタッフ';
  const notes = document.getElementById('recordNotes')?.value.trim() || '';

  try {
    const res = await fetch(`/reha-uke/api/orders/${selectedOrderIdForRecord}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorName: staffName, notes })
    });
    const result = await res.json();
    if (result.success) {
      closeRecordModal();
      loadOrders();
    } else {
      alert('実施記録の保存に失敗しました: ' + (result.message || ''));
    }
  } catch (err) {
    alert('通信エラー: ' + err.message);
  }
}

// 操作ログモーダル開閉
async function openLogModal() {
  const modal = document.getElementById('logModal');
  const logContent = document.getElementById('logContent');
  if (modal) modal.style.display = 'flex';
  if (logContent) {
    logContent.textContent = 'ログを読み込み中...';
    try {
      const res = await fetch('/reha-uke/api/logs?format=readable&limit=50');
      const text = await res.text();
      logContent.textContent = text || 'ログ記録がありません。';
    } catch (err) {
      logContent.textContent = 'ログ取得エラー: ' + err.message;
    }
  }
}

function closeLogModal() {
  const modal = document.getElementById('logModal');
  if (modal) modal.style.display = 'none';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
