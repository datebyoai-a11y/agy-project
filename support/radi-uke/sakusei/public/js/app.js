/**
 * 🏥 交雄会だて病院 放射線科 指示受け・実施モニター フロントエンド制御 (app.js)
 * 
 * 1. モダリティ別 縦3列 (Kanban) 表示
 * 2. 全件一覧形式 (テーブルビュー) 表示（「すべて表示」選択時に自動切り替え）
 * 3. ワンクリック「📥 受付」「✅ 実施済」「↩️ 戻す」
 * 4. リアルタイム自動ポーリング (4秒)
 */

// 状態管理
let currentFilter = 'ACTIVE'; // 'ACTIVE' (未受付+受付済), 'ALL', 'ORDERED', 'COMPLETED'
let currentViewMode = 'kanban'; // 'kanban' | 'list'
let searchQuery = '';
let isPollingActive = true;
let pollTimer = null;
let currentOrders = [];
let currentCounts = {};

// DOM要素
const elKanbanContainer = document.getElementById('kanbanContainer');
const elListViewContainer = document.getElementById('listViewContainer');
const elOrdersTableBody = document.getElementById('ordersTableBody');
const elTableCountBadge = document.getElementById('tableCountBadge');

// テーブルソート状態 (デフォルト: 指示日時 降順)
let tableSortKey = 'date';
let tableSortOrder = 'desc';

const elXrayList = document.getElementById('xrayCardList');
const elCtList = document.getElementById('ctCardList');
const elFluoroList = document.getElementById('fluoroCardList');
const elSearchInput = document.getElementById('searchInput');
const elRefreshBtn = document.getElementById('refreshBtn');

// 統計バッジ
const elStatOrdered = document.getElementById('statOrdered');
const elStatAccepted = document.getElementById('statAccepted');
const elStatCompleted = document.getElementById('statCompleted');
const elStatPortable = document.getElementById('statPortable');

// カラム別件数バッジ (下にある情報の件数)
const elBadgeXrayCount = document.getElementById('badgeXrayCount');
const elBadgeCtCount = document.getElementById('badgeCtCount');
const elBadgeFluoroCount = document.getElementById('badgeFluoroCount');

// 🖨️ 画面いっぱいの別ウィンドウで伝票を開く
function openRadiologySlip(orderId) {
  if (!orderId) return;
  const w = window.screen.availWidth || window.innerWidth || 1280;
  const h = window.screen.availHeight || window.innerHeight || 900;
  const url = `/radiology/preview/${orderId}?viewer=1`;
  const winName = `radiology_slip_${orderId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const features = `width=${w},height=${h},top=0,left=0,scrollbars=yes,resizable=yes,status=no,toolbar=no,menubar=no,location=no`;
  
  const win = window.open(url, winName, features);
  if (win) {
    win.focus();
  } else {
    // ポップアップブロッカー発生時のフォールバック
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

      // 🌟 「すべて表示 (一覧)」の時は一覧テーブル形式にし、それ以外は縦3列Kanbanにする
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
  elSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = e.target.value.trim();
      loadOrders();
    }, 250);
  });

  // 手動更新
  elRefreshBtn.addEventListener('click', () => {
    loadOrders();
    showToast('info', '🔄 オーダー一覧を更新しました');
  });
}

// 表示モード切り替え (Kanban / 一覧テーブル)
function setViewMode(mode) {
  currentViewMode = mode;
  if (mode === 'list') {
    if (elKanbanContainer) elKanbanContainer.style.display = 'none';
    if (elListViewContainer) elListViewContainer.style.display = 'block';
  } else {
    if (elKanbanContainer) {
      elKanbanContainer.style.display = 'grid';
      elKanbanContainer.className = 'kanban-container';
    }
    if (elListViewContainer) elListViewContainer.style.display = 'none';
  }
}

// ↕️ テーブルカラムソートのイベントリスナー設定
function setupTableSortListeners() {
  const headers = document.querySelectorAll('.orders-table th.th-sortable');
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const sortKey = th.getAttribute('data-sort');
      if (tableSortKey === sortKey) {
        // 同じカラム: 昇順 ⇄ 降順 切り替え
        tableSortOrder = (tableSortOrder === 'asc') ? 'desc' : 'asc';
      } else {
        // 別のカラム: 新規選択 (日付や状態は降順、それ以外は昇順初期値)
        tableSortKey = sortKey;
        tableSortOrder = (sortKey === 'date' || sortKey === 'status') ? 'desc' : 'asc';
      }
      updateSortHeaderIndicators();
      renderTableView(currentOrders);
    });
  });

  // リセットボタン
  const btnReset = document.getElementById('btnResetSort');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      tableSortKey = 'date';
      tableSortOrder = 'desc';
      updateSortHeaderIndicators();
      renderTableView(currentOrders);
    });
  }
}

// ソート矢印および表示バッジの更新
function updateSortHeaderIndicators() {
  const headers = document.querySelectorAll('.orders-table th.th-sortable');
  const sortLabels = {
    status: '状態',
    modality: '区分',
    date: '指示日時',
    patient: '患者情報',
    exam: '検査種別・部位',
    purpose: '検査目的',
    doctor: '依頼医師',
    operator: '対応技師'
  };

  headers.forEach(th => {
    const key = th.getAttribute('data-sort');
    const icon = th.querySelector('.sort-icon');
    th.classList.remove('sorted-asc', 'sorted-desc');

    if (key === tableSortKey) {
      if (tableSortOrder === 'asc') {
        th.classList.add('sorted-asc');
        if (icon) icon.textContent = '▲';
      } else {
        th.classList.add('sorted-desc');
        if (icon) icon.textContent = '▼';
      }
    } else {
      if (icon) icon.textContent = '↕️';
    }
  });

  // バッジ更新
  const badge = document.getElementById('currentSortBadge');
  const btnReset = document.getElementById('btnResetSort');
  const orderText = tableSortOrder === 'asc' ? '昇順 (古い/五十音順)' : '降順 (新しい順)';
  const arrow = tableSortOrder === 'asc' ? '🔼' : '🔽';
  if (badge) {
    badge.textContent = `${arrow} ${sortLabels[tableSortKey] || tableSortKey} (${orderText})`;
  }
  if (btnReset) {
    btnReset.style.display = (tableSortKey === 'date' && tableSortOrder === 'desc') ? 'none' : 'inline-block';
  }
}

// 自動ポーリング (4秒ごと)
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (isPollingActive) {
      loadOrders(true); // silent update
    }
  }, 4000);
}

// オーダー一覧取得
async function loadOrders(isSilent = false) {
  try {
    const params = new URLSearchParams({
      status: currentFilter,
      search: searchQuery,
      dateRange: 'all',
      _t: Date.now() // キャッシュ無効化 (常に最新状態を取得)
    });

    const prefix = window.APP_PREFIX || '';
    const res = await fetch(`${prefix}/api/orders?${params.toString()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    const data = await res.json();

    if (!data.success) {
      console.error('オーダー取得失敗:', data.error);
      return;
    }

    currentOrders = data.orders;
    currentCounts = data.counts;

    updateStats(data.counts);
    renderKanbanColumns(data.grouped);
    renderTableView(data.orders);

  } catch (err) {
    console.error('オーダー一覧取得通信エラー:', err);
  }
}

// 統計値の更新
function updateStats(counts) {
  if (!counts) return;

  if (elStatOrdered) elStatOrdered.textContent = counts.ordered || 0;
  if (elStatAccepted) elStatAccepted.textContent = counts.accepted || 0;
  if (elStatCompleted) elStatCompleted.textContent = counts.completed || 0;
  if (elStatPortable) elStatPortable.textContent = counts.portable || 0;
}

// ==============================================================================
// 📊 1. モダリティ別 縦3列 (Kanban) 描画
// ==============================================================================
function renderKanbanColumns(grouped) {
  const xrayOrders = (grouped && grouped.xray) || [];
  const ctOrders = (grouped && grouped.ct) || [];
  const fluoroOrders = (grouped && grouped.fluoro) || [];

  renderColumn(elXrayList, xrayOrders, '📷 一般撮影・X線の指示はありません');
  renderColumn(elCtList, ctOrders, '🌀 CT検査の指示はありません');
  renderColumn(elFluoroList, fluoroOrders, '📺 X線透視の指示はありません');

  // 🌟 下にある情報の件数だけを表示
  if (elBadgeXrayCount) elBadgeXrayCount.textContent = `${xrayOrders.length}件`;
  if (elBadgeCtCount) elBadgeCtCount.textContent = `${ctOrders.length}件`;
  if (elBadgeFluoroCount) elBadgeFluoroCount.textContent = `${fluoroOrders.length}件`;
}

function renderColumn(container, orders, emptyText) {
  if (!container) return;

  if (!orders || orders.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder">
        <div class="empty-placeholder-icon">📭</div>
        <p>${emptyText}</p>
      </div>
    `;
    return;
  }

  // ステータス順ソート: ORDERED(未受付) ➔ ACCEPTED(受付済) ➔ COMPLETED(実施済)
  const statusPriority = { 'ORDERED': 1, 'RECEIVED': 2, 'ACCEPTED': 2, 'COMPLETED': 3, 'CANCELLED': 4 };
  const sorted = [...orders].sort((a, b) => {
    const pA = statusPriority[a.orderStatus] || 99;
    const pB = statusPriority[b.orderStatus] || 99;
    if (pA !== pB) return pA - pB;
    return new Date(b.createdAt) - new Date(a.createdAt); // 同ステータスなら新しい順
  });

  const html = sorted.map(order => createOrderCardHtml(order)).join('');
  container.innerHTML = html;
}

// 個別カードHTML生成
function createOrderCardHtml(order) {
  const status = order.orderStatus || 'ORDERED';
  const isPortable = order.isPortable || (order.portable && order.portable.includes('ポータブル'));
  const isOrdered = (status === 'ORDERED');
  const isAccepted = (status === 'ACCEPTED' || status === 'RECEIVED');
  const isCompleted = (status === 'COMPLETED');

  // ステータス表示名 (じっ済 ➔ 実施済 に訂正)
  let statusLabel = '未受付';
  if (isAccepted) statusLabel = '受付済';
  if (isCompleted) statusLabel = '実施済';

  // 時刻フォーマット
  const d = new Date(order.createdAt || order.orderDate);
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  // 年齢・性別
  const ageStr = order.age ? `${order.age}歳` : '';
  const genderStr = order.gender || '';

  // タグ生成
  let tagsHtml = '';
  if (isPortable) {
    tagsHtml += `<span class="tag-alert tag-portable">🚨 病室ポータブル (${order.portableRoom || order.room || '病室'})</span>`;
  }
  if (order.infection && order.infection !== '無') {
    tagsHtml += `<span class="tag-alert tag-infection">⚠️ 感染症: ${escapeHtml(order.infection)}</span>`;
  }
  if (order.contrast && order.contrast.includes('造影')) {
    tagsHtml += `<span class="tag-alert tag-contrast">💉 造影検査</span>`;
  }
  if (order.mobility && order.mobility !== '徒歩') {
    tagsHtml += `<span class="tag-alert tag-mobility">🦽 ${escapeHtml(order.mobility)}</span>`;
  }

  // 担当技師スタンプ
  let operatorStamp = '';
  if (isCompleted && order.completedBy) {
    const cTime = order.completedAt ? new Date(order.completedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
    operatorStamp = `
      <div class="operator-stamp">
        <span>✅ 実施: <strong>${escapeHtml(order.completedBy)}</strong> (${cTime})</span>
        <button class="btn-revert" onclick="handleRevert('${order._id}')" title="ステータスを戻す">↩️ 戻す</button>
      </div>
    `;
  } else if (isAccepted && order.acceptedBy) {
    const aTime = order.acceptedAt ? new Date(order.acceptedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
    operatorStamp = `
      <div class="operator-stamp">
        <span>📥 受付: <strong>${escapeHtml(order.acceptedBy)}</strong> (${aTime})</span>
        <button class="btn-revert" onclick="handleRevert('${order._id}')" title="ステータスを戻す">↩️ 戻す</button>
      </div>
    `;
  }

  // 操作ボタン (「じっ済」➔「実施済」)
  let actionsHtml = '';
  if (isOrdered) {
    actionsHtml = `
      <button class="btn-accept" onclick="handleAccept('${order._id}', '${escapeHtml(order.patientName)}')">
        📥 受付
      </button>
      <button class="btn-complete" onclick="handleComplete('${order._id}', '${escapeHtml(order.patientName)}')">
        ✅ 実施済
      </button>
    `;
  } else if (isAccepted) {
    actionsHtml = `
      <button class="btn-complete" onclick="handleComplete('${order._id}', '${escapeHtml(order.patientName)}')">
        ✅ 実施済
      </button>
    `;
  }

  const modType = getModalityKey(order);
  let modPill = '';
  if (modType === 'ct') {
    modPill = '<span class="modality-pill ct" style="font-size:0.68rem; padding:1px 6px;">🌀 CT</span>';
  } else if (modType === 'fluoro') {
    modPill = '<span class="modality-pill fluoro" style="font-size:0.68rem; padding:1px 6px;">📺 透視</span>';
  } else {
    modPill = '<span class="modality-pill xray" style="font-size:0.68rem; padding:1px 6px;">📷 X線</span>';
  }

  // 伝票プレビュー用URL
  const radBaseUrl = '/radiology';

  return `
    <div class="order-card modality-${modType} status-${status.toLowerCase()} ${isPortable ? 'is-portable' : ''}" id="card-${order._id}">
      <!-- 上部メタ情報 (伝票カラーバー直下) -->
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:6px;">
          ${modPill}
          <span class="order-num-text">${escapeHtml(order.orderNumber)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="status-badge ${status}">${statusLabel}</span>
          <span class="time-stamp">🕒 ${timeStr}</span>
        </div>
      </div>

      <!-- 患者情報 -->
      <div class="patient-area">
        <div class="patient-info">
          <div class="patient-name-row">
            <span class="patient-name">${escapeHtml(order.patientName)}</span>
            ${order.patientKana ? `<span class="patient-kana">${escapeHtml(order.patientKana)}</span>` : ''}
          </div>
          <div class="patient-meta">
            <span class="patient-id-tag">ID: ${escapeHtml(order.patientId)}</span>
            <span>${genderStr} ${ageStr}</span>
            <span>🏥 ${escapeHtml(order.ward || '')} ${escapeHtml(order.room || '')}</span>
          </div>
        </div>
      </div>

      <!-- 警告・アラートタグ -->
      ${tagsHtml ? `<div class="tags-row">${tagsHtml}</div>` : ''}

      <!-- 検査内容 -->
      <div class="exam-area">
        <div class="exam-title-row">
          <strong class="exam-name">${escapeHtml(order.examType)}</strong>
          ${order.contrast ? `<span style="font-size:0.75rem; color:#64748b;">${escapeHtml(order.contrast)}</span>` : ''}
        </div>
        ${order.partsDetail ? `<div class="exam-parts">📍 <strong>部位:</strong> ${escapeHtml(order.partsDetail)}</div>` : ''}
        ${order.purpose ? `<div class="exam-purpose">🎯 <strong>目的:</strong> ${escapeHtml(order.purpose)}</div>` : ''}
        <div class="doctor-info">
          <span>👨‍⚕️ ${escapeHtml(order.doctorName || '医師')} (${escapeHtml(order.requestDepartment || '')})</span>
        </div>
      </div>

      <!-- スタンプ -->
      ${operatorStamp}

      <!-- 操作ボタングループ -->
      <div class="card-actions">
        ${actionsHtml}
        <a href="${radBaseUrl}/preview/${order._id}?viewer=1" onclick="openRadiologySlip('${order._id}'); return false;" class="btn-card-sub" title="正・控え伝票を画面いっぱいに表示">
          🖨️ 伝票
        </a>
      </div>
    </div>
  `;
}

// ==============================================================================
// 📋 2. 一覧形式 (テーブルビュー) 描画
// ==============================================================================
function renderTableView(orders) {
  if (!elOrdersTableBody) return;

  if (elTableCountBadge) {
    elTableCountBadge.textContent = `${orders ? orders.length : 0}件`;
  }

  if (!orders || orders.length === 0) {
    elOrdersTableBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-dim);">
          <div style="font-size: 1.8rem; margin-bottom: 6px;">📭</div>
          該当するオーダーはありません
        </td>
      </tr>
    `;
    return;
  }

  // 選択されたソートキー・順序に応じた並び替え
  const sorted = [...orders].sort((a, b) => {
    let cmp = 0;
    switch (tableSortKey) {
      case 'status': {
        const priority = { 'ORDERED': 1, 'RECEIVED': 2, 'ACCEPTED': 2, 'COMPLETED': 3, 'CANCELLED': 4 };
        const pA = priority[a.orderStatus] || 99;
        const pB = priority[b.orderStatus] || 99;
        cmp = pA - pB;
        if (cmp === 0) {
          cmp = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        }
        break;
      }
      case 'modality': {
        const modPriority = { 'xray': 1, 'ct': 2, 'fluoro': 3 };
        const mA = modPriority[getModalityKey(a)] || 99;
        const mB = modPriority[getModalityKey(b)] || 99;
        cmp = mA - mB;
        if (cmp === 0) {
          cmp = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        }
        break;
      }
      case 'patient': {
        const nameA = (a.patientKana || a.patientName || '').trim();
        const nameB = (b.patientKana || b.patientName || '').trim();
        cmp = nameA.localeCompare(nameB, 'ja');
        break;
      }
      case 'exam': {
        const exA = `${a.examType || ''} ${a.partsDetail || ''}`.trim();
        const exB = `${b.examType || ''} ${b.partsDetail || ''}`.trim();
        cmp = exA.localeCompare(exB, 'ja');
        break;
      }
      case 'purpose': {
        const purA = `${a.purpose || ''} ${a.clinicalDiagnosis || ''}`.trim();
        const purB = `${b.purpose || ''} ${b.clinicalDiagnosis || ''}`.trim();
        cmp = purA.localeCompare(purB, 'ja');
        break;
      }
      case 'doctor': {
        const docA = (a.doctorName || '').trim();
        const docB = (b.doctorName || '').trim();
        cmp = docA.localeCompare(docB, 'ja');
        break;
      }
      case 'operator': {
        const opA = (a.completedBy || a.acceptedBy || '').trim();
        const opB = (b.completedBy || b.acceptedBy || '').trim();
        cmp = opA.localeCompare(opB, 'ja');
        if (cmp === 0) {
          const tA = new Date(a.completedAt || a.acceptedAt || 0).getTime();
          const tB = new Date(b.completedAt || b.acceptedAt || 0).getTime();
          cmp = tA - tB;
        }
        break;
      }
      case 'date':
      default: {
        const tA = new Date(a.createdAt || a.orderDate || 0).getTime();
        const tB = new Date(b.createdAt || b.orderDate || 0).getTime();
        cmp = tA - tB;
        break;
      }
    }

    return (tableSortOrder === 'desc') ? -cmp : cmp;
  });

  const rowsHtml = sorted.map(order => {
    const status = order.orderStatus || 'ORDERED';
    const isPortable = order.isPortable || (order.portable && order.portable.includes('ポータブル'));
    const isOrdered = (status === 'ORDERED');
    const isAccepted = (status === 'ACCEPTED' || status === 'RECEIVED');
    const isCompleted = (status === 'COMPLETED');

    let statusLabel = '未受付';
    if (isAccepted) statusLabel = '受付済';
    if (isCompleted) statusLabel = '実施済';

    // モダリティ判定
    const modType = getModalityKey(order);
    let modBadge = '';
    if (modType === 'ct') {
      modBadge = '<span class="modality-pill ct">🌀 CT検査</span>';
    } else if (modType === 'fluoro') {
      modBadge = '<span class="modality-pill fluoro">📺 X線透視</span>';
    } else {
      modBadge = '<span class="modality-pill xray">📷 一般X線</span>';
    }

    // 時刻
    const d = new Date(order.createdAt || order.orderDate);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    // 患者情報
    const ageGender = [order.gender, order.age ? `${order.age}歳` : ''].filter(Boolean).join(' / ');
    let extraTags = '';
    if (isPortable) extraTags += '<span class="tag-alert tag-portable" style="font-size:0.68rem;">🚨ポータブル</span> ';
    if (order.infection && order.infection !== '無') extraTags += `<span class="tag-alert tag-infection" style="font-size:0.68rem;">⚠️${escapeHtml(order.infection)}</span> `;
    if (order.mobility && order.mobility !== '徒歩') extraTags += `<span class="tag-alert tag-mobility" style="font-size:0.68rem;">🦽${escapeHtml(order.mobility)}</span> `;

    // 検査部位・詳細
    let examDetail = `<strong>${escapeHtml(order.examType)}</strong>`;
    if (order.contrast && order.contrast.includes('造影')) {
      examDetail += ' <span class="tag-alert tag-contrast" style="font-size:0.68rem;">💉造影</span>';
    }
    if (order.partsDetail) {
      examDetail += `<div style="font-size:0.75rem; color:#475569; margin-top:2px;">📍 ${escapeHtml(order.partsDetail)}</div>`;
    }

    // 技師対応状況
    let techStatus = '<span style="color:#94a3b8; font-size:0.78rem;">未着手</span>';
    if (isCompleted && order.completedBy) {
      const cTime = order.completedAt ? new Date(order.completedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
      techStatus = `<div style="font-size:0.78rem; color:#059669; font-weight:700;">✅ 実施: ${escapeHtml(order.completedBy)} (${cTime})</div>`;
    } else if (isAccepted && order.acceptedBy) {
      const aTime = order.acceptedAt ? new Date(order.acceptedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
      techStatus = `<div style="font-size:0.78rem; color:#2563eb; font-weight:700;">📥 受付: ${escapeHtml(order.acceptedBy)} (${aTime})</div>`;
    }

    // 操作ボタングループ
    let actions = '';
    if (isOrdered) {
      actions += `
        <button class="btn-sm btn-sm-accept" onclick="handleAccept('${order._id}', '${escapeHtml(order.patientName)}')">
          📥 受付
        </button>
        <button class="btn-sm btn-sm-complete" onclick="handleComplete('${order._id}', '${escapeHtml(order.patientName)}')">
          ✅ 実施済
        </button>
      `;
    } else if (isAccepted) {
      actions += `
        <button class="btn-sm btn-sm-complete" onclick="handleComplete('${order._id}', '${escapeHtml(order.patientName)}')">
          ✅ 実施済
        </button>
        <button class="btn-revert" onclick="handleRevert('${order._id}')" title="ステータスを未受付に戻す">↩️ 戻す</button>
      `;
    } else if (isCompleted) {
      actions += `
        <button class="btn-revert" onclick="handleRevert('${order._id}')" title="ステータスを受付済に戻す">↩️ 戻す</button>
      `;
    }

    actions += `
      <a href="/radiology/preview/${order._id}?viewer=1" onclick="openRadiologySlip('${order._id}'); return false;" class="btn-sm btn-sm-sub" title="正・控え伝票を画面いっぱいに表示">
        🖨️ 伝票
      </a>
    `;

    return `
      <tr id="row-${order._id}" class="${isPortable ? 'is-portable' : ''}">
        <td><span class="status-badge ${status}">${statusLabel}</span></td>
        <td>${modBadge}</td>
        <td>
          <div style="font-family:monospace; font-weight:700; color:#334155;">${escapeHtml(order.orderNumber)}</div>
          <div style="font-size:0.74rem; color:var(--text-muted);">${dateStr}</div>
        </td>
        <td>
          <div style="font-weight:700; font-size:0.95rem; color:#0f172a;">${escapeHtml(order.patientName)}</div>
          <div style="font-size:0.75rem; color:#475569;">
            <span class="patient-id-tag">ID:${escapeHtml(order.patientId)}</span>
            <span>${ageGender}</span>
          </div>
          <div style="font-size:0.75rem; color:#64748b;">🏥 ${escapeHtml(order.ward || '')} ${escapeHtml(order.room || '')}</div>
          ${extraTags ? `<div style="margin-top:3px;">${extraTags}</div>` : ''}
        </td>
        <td>${examDetail}</td>
        <td style="font-size:0.8rem; color:#475569; max-width:200px;">
          ${escapeHtml(order.purpose || '特記なし')}
        </td>
        <td style="font-size:0.78rem;">
          <div style="font-weight:600;">👨‍⚕️ ${escapeHtml(order.doctorName || '医師')}</div>
          <div style="color:var(--text-muted);">${escapeHtml(order.requestDepartment || '')}</div>
        </td>
        <td>${techStatus}</td>
        <td>
          <div class="table-actions">
            ${actions}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  elOrdersTableBody.innerHTML = rowsHtml;
}

// モダリティ判定ヘルパー
function getModalityKey(order) {
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

// ==============================================================================
// 🔘 3. 操作イベントハンドラ (名前上部バッジ & ボタン即時完全連動)
// ==============================================================================

// 📥 受付ボタン処理
async function handleAccept(orderId, patientName) {
  const staffName = window.CURRENT_USER_NAME || '放射線技師';
  // ⚡ 1. 名前上部の「未受付」バッジと操作ボタンを即座に「受付済」へ連動反映
  updateCardStatusLocally(orderId, 'ACCEPTED', staffName);
  showToast('info', `📥 ${patientName || ''} 様のオーダーを受付済にしました`);

  try {
    const prefix = window.APP_PREFIX || '';
    const res = await fetch(`${prefix}/api/orders/${orderId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorName: staffName })
    });
    const data = await res.json();
    if (data.success) {
      loadOrders(true); // バックグラウンドで全体同期
    } else {
      showToast('error', `受付失敗: ${data.message || data.error}`);
      loadOrders(); // 失敗時は元に戻す
    }
  } catch (err) {
    showToast('error', `通信エラー: ${err.message}`);
    loadOrders();
  }
}

// ✅ 実施済ボタン処理
async function handleComplete(orderId, patientName) {
  const staffName = window.CURRENT_USER_NAME || '放射線技師';
  // ⚡ 1. 名前上部のステータスバッジと操作ボタンを即座に「実施済」へ連動反映
  updateCardStatusLocally(orderId, 'COMPLETED', staffName);
  showToast('success', `✅ ${patientName || ''} 様の検査を実施済にしました`);

  try {
    const prefix = window.APP_PREFIX || '';
    const res = await fetch(`${prefix}/api/orders/${orderId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorName: staffName })
    });
    const data = await res.json();
    if (data.success) {
      loadOrders(true); // バックグラウンドで全体同期
    } else {
      showToast('error', `実施完了処理失敗: ${data.message || data.error}`);
      loadOrders(); // 失敗時は元に戻す
    }
  } catch (err) {
    showToast('error', `通信エラー: ${err.message}`);
    loadOrders();
  }
}

// ↩️ 差し戻し処理
async function handleRevert(orderId) {
  if (!confirm('ステータスを前段階に戻しますか？')) return;

  // 現在のステータスから一つ前に即時連動
  const card = document.getElementById(`card-${orderId}`);
  const isCompleted = card && card.classList.contains('status-completed');
  const nextStatus = isCompleted ? 'ACCEPTED' : 'ORDERED';
  updateCardStatusLocally(orderId, nextStatus, window.CURRENT_USER_NAME || '放射線技師');
  showToast('warning', `↩️ ステータスを戻しました`);

  try {
    const prefix = window.APP_PREFIX || '';
    const res = await fetch(`${prefix}/api/orders/${orderId}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      loadOrders(true);
    } else {
      showToast('error', `戻し失敗: ${data.message || data.error}`);
      loadOrders();
    }
  } catch (err) {
    showToast('error', `通信エラー: ${err.message}`);
    loadOrders();
  }
}

// ⚡ 名前上部の未受付バッジおよびボタン・スタンプの即時DOM連動更新関数
function updateCardStatusLocally(orderId, newStatus, staffName) {
  const card = document.getElementById(`card-${orderId}`);
  const row = document.getElementById(`row-${orderId}`);
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let label = '未受付';
  if (newStatus === 'ACCEPTED' || newStatus === 'RECEIVED') label = '受付済';
  if (newStatus === 'COMPLETED') label = '実施済';

  // 1. 🩻 Kanbanカード更新
  if (card) {
    // 🌟 名前上部のステータスバッジを即座に変更 & アニメーション
    const badge = card.querySelector('.card-top .status-badge');
    if (badge) {
      badge.textContent = label;
      badge.className = `status-badge ${newStatus}`;
      badge.style.transform = 'scale(1.2)';
      badge.style.transition = 'all 0.2s ease';
      setTimeout(() => { badge.style.transform = 'scale(1)'; }, 250);
    }

    // カード外枠ボーダー・背景色
    card.classList.remove('status-ordered', 'status-accepted', 'status-completed');
    card.classList.add(`status-${newStatus.toLowerCase()}`);

    // 操作ボタングループ & スタンプの更新
    const actionsArea = card.querySelector('.card-actions');
    const existingStamp = card.querySelector('.operator-stamp');
    if (existingStamp) existingStamp.remove();

    if (newStatus === 'ACCEPTED') {
      const stampDiv = document.createElement('div');
      stampDiv.className = 'operator-stamp';
      stampDiv.innerHTML = `
        <span>📥 受付: <strong>${escapeHtml(staffName)}</strong> (${timeStr})</span>
        <button class="btn-revert" onclick="handleRevert('${orderId}')" title="ステータスを戻す">↩️ 戻す</button>
      `;
      if (actionsArea) card.insertBefore(stampDiv, actionsArea);

      if (actionsArea) {
        actionsArea.innerHTML = `
          <button class="btn-complete" onclick="handleComplete('${orderId}', '')">
            ✅ 実施済
          </button>
          <a href="/radiology/preview/${orderId}?viewer=1" onclick="openRadiologySlip('${orderId}'); return false;" class="btn-card-sub" title="正・控え伝票を画面いっぱいに表示">
            🖨️ 伝票
          </a>
        `;
      }
    } else if (newStatus === 'COMPLETED') {
      const stampDiv = document.createElement('div');
      stampDiv.className = 'operator-stamp';
      stampDiv.innerHTML = `
        <span>✅ 実施: <strong>${escapeHtml(staffName)}</strong> (${timeStr})</span>
        <button class="btn-revert" onclick="handleRevert('${orderId}')" title="ステータスを戻す">↩️ 戻す</button>
      `;
      if (actionsArea) card.insertBefore(stampDiv, actionsArea);

      if (actionsArea) {
        actionsArea.innerHTML = `
          <a href="/radiology/preview/${orderId}?viewer=1" onclick="openRadiologySlip('${orderId}'); return false;" class="btn-card-sub" style="flex:1;" title="正・控え伝票を画面いっぱいに表示">
            🖨️ 正・控え伝票を表示
          </a>
        `;
      }
    } else if (newStatus === 'ORDERED') {
      if (actionsArea) {
        actionsArea.innerHTML = `
          <button class="btn-accept" onclick="handleAccept('${orderId}', '')">
            📥 受付
          </button>
          <button class="btn-complete" onclick="handleComplete('${orderId}', '')">
            ✅ 実施済
          </button>
          <a href="/radiology/preview/${orderId}?viewer=1" onclick="openRadiologySlip('${orderId}'); return false;" class="btn-card-sub" title="正・控え伝票を画面いっぱいに表示">
            🖨️ 伝票
          </a>
        `;
      }
    }
  }

  // 2. 📋 一覧テーブル行の更新
  if (row) {
    const badge = row.querySelector('.status-badge');
    if (badge) {
      badge.textContent = label;
      badge.className = `status-badge ${newStatus}`;
      badge.style.transform = 'scale(1.15)';
      setTimeout(() => { badge.style.transform = 'scale(1)'; }, 200);
    }
    const actions = row.querySelector('.table-actions');
    if (actions) {
      if (newStatus === 'ACCEPTED') {
        actions.innerHTML = `
          <button class="btn-sm btn-sm-complete" onclick="handleComplete('${orderId}', '')">✅ 実施済</button>
          <button class="btn-revert" onclick="handleRevert('${orderId}')" title="ステータスを未受付に戻す">↩️ 戻す</button>
          <a href="/radiology/preview/${orderId}?viewer=1" onclick="openRadiologySlip('${orderId}'); return false;" class="btn-sm btn-sm-sub" title="正・控え伝票を画面いっぱいに表示">🖨️ 伝票</a>
        `;
      } else if (newStatus === 'COMPLETED') {
        actions.innerHTML = `
          <button class="btn-revert" onclick="handleRevert('${orderId}')" title="ステータスを受付済に戻す">↩️ 戻す</button>
          <a href="/radiology/preview/${orderId}?viewer=1" onclick="openRadiologySlip('${orderId}'); return false;" class="btn-sm btn-sm-sub" title="正・控え伝票を画面いっぱいに表示">🖨️ 伝票</a>
        `;
      } else if (newStatus === 'ORDERED') {
        actions.innerHTML = `
          <button class="btn-sm btn-sm-accept" onclick="handleAccept('${orderId}', '')">📥 受付</button>
          <button class="btn-sm btn-sm-complete" onclick="handleComplete('${orderId}', '')">✅ 実施済</button>
          <a href="/radiology/preview/${orderId}?viewer=1" onclick="openRadiologySlip('${orderId}'); return false;" class="btn-sm btn-sm-sub" title="正・控え伝票を画面いっぱいに表示">🖨️ 伝票</a>
        `;
      }
    }
  }
}

// 🔔 トースト通知
function showToast(type, text) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = text;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 文字列エスケープ
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
