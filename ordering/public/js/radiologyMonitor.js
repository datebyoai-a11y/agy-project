'use strict';

(function initRadiologyMonitor() {
  let currentFilter = 'ACTIVE';
  let searchQuery = '';
  let includeInactive = false;
  let sortKey = 'date';
  let sortOrder = 'desc';
  let currentOrders = [];
  let pollTimer = null;

  const statusEl = document.getElementById('monitorStatus');
  const lastUpdatedEl = document.getElementById('lastUpdatedLabel');
  const kanbanEl = document.getElementById('kanbanContainer');
  const listEl = document.getElementById('listViewContainer');
  const tableBody = document.getElementById('ordersTableBody');
  const tableCountBadge = document.getElementById('tableCountBadge');
  const sortBadge = document.getElementById('currentSortBadge');
  const btnResetSort = document.getElementById('btnResetSort');

  const statOrdered = document.getElementById('statOrdered');
  const statAccepted = document.getElementById('statAccepted');
  const statCompleted = document.getElementById('statCompleted');
  const statPortable = document.getElementById('statPortable');

  const xrayList = document.getElementById('xrayCardList');
  const ctList = document.getElementById('ctCardList');
  const fluoroList = document.getElementById('fluoroCardList');
  const badgeXray = document.getElementById('badgeXrayCount');
  const badgeCt = document.getElementById('badgeCtCount');
  const badgeFluoro = document.getElementById('badgeFluoroCount');

  const searchInput = document.getElementById('searchInput');
  const chkIncludeInactive = document.getElementById('chkIncludeInactive');
  const chkAutoPoll = document.getElementById('chkAutoPoll');

  function showStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `status-msg ${isError ? 'is-err' : 'is-ok'}`;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDateTime(val) {
    if (!val) return '-';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return '-';
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${hh}:${mm}`;
  }

  function fmtTime(val) {
    if (!val) return '';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function getStatusMeta(o) {
    if (o.isSuperseded) return { code: 'SUPERSEDED', label: '訂正済', cls: 'superseded', prio: 5 };
    if (o.isCancelled || o.orderStatus === 'CANCELLED') return { code: 'CANCELLED', label: '中止', cls: 'cancelled', prio: 4 };
    if (o.orderStatus === 'COMPLETED') return { code: 'COMPLETED', label: '実施済', cls: 'completed', prio: 3 };
    if (o.orderStatus === 'ACCEPTED') return { code: 'ACCEPTED', label: '受付済', cls: 'accepted', prio: 2 };
    return { code: 'ORDERED', label: '未受付', cls: 'ordered', prio: 1 };
  }

  function applyVisibilityToggles() {
    // カラム表示
    let visibleCols = 0;
    document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
      const colKey = cb.getAttribute('data-col-toggle');
      const panel = document.querySelector(`[data-col-panel="${colKey}"]`);
      if (panel) panel.classList.toggle('is-hidden', !cb.checked);
      if (cb.checked) visibleCols += 1;
    });
    if (kanbanEl) {
      kanbanEl.style.gridTemplateColumns = `repeat(${Math.max(1, visibleCols)}, minmax(0, 1fr))`;
    }

    // カード・テーブル内項目表示
    document.querySelectorAll('[data-card-toggle]').forEach((cb) => {
      const key = cb.getAttribute('data-card-toggle');
      document.querySelectorAll(`[data-card-item="${key}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    });
  }

  function renderCard(o) {
    const st = getStatusMeta(o);
    const alerts = [];
    if (o.isPortable) {
      alerts.push(`<span class="alert-tag alert-tag--port">ポータブル(${esc(o.portableRoom || o.room || '病室')})</span>`);
    }
    if (o.isUrgent) {
      alerts.push('<span class="alert-tag alert-tag--urgent">至急</span>');
    }
    if (o.infection && o.infection !== '無') {
      alerts.push(`<span class="alert-tag alert-tag--inf">感染: ${esc(o.infection)}</span>`);
    }
    if (o.contrast === '造影') {
      alerts.push('<span class="alert-tag alert-tag--contrast">造影</span>');
    }
    if (o.mobility && o.mobility !== '徒歩') {
      alerts.push(`<span class="alert-tag alert-tag--mob">${esc(o.mobility)}</span>`);
    }

    let stampHtml = '';
    if (st.code === 'COMPLETED' && o.completedBy) {
      stampHtml = `
        <div class="card-stamp">
          <span>実施: <strong>${esc(o.completedBy)}</strong> (${fmtTime(o.completedAt)})</span>
          <button type="button" class="btn-act btn-act--revert js-status-btn" data-order="${esc(o.orderNumber)}" data-next="ACCEPTED">戻す</button>
        </div>`;
    } else if (st.code === 'ACCEPTED' && o.acceptedBy) {
      stampHtml = `
        <div class="card-stamp">
          <span>受付: <strong>${esc(o.acceptedBy)}</strong> (${fmtTime(o.acceptedAt)})</span>
          <button type="button" class="btn-act btn-act--revert js-status-btn" data-order="${esc(o.orderNumber)}" data-next="ORDERED">戻す</button>
        </div>`;
    } else if (st.code === 'CANCELLED') {
      stampHtml = `<div class="card-stamp">中止: ${esc(o.cancelReason || '')} (${esc(o.cancelledBy)})</div>`;
    } else if (st.code === 'SUPERSEDED') {
      stampHtml = `<div class="card-stamp">訂正先: ${esc(o.supersededBy)}</div>`;
    }

    let actionBtns = '';
    if (st.code === 'ORDERED') {
      actionBtns = `
        <button type="button" class="btn-act btn-act--accept js-status-btn" data-order="${esc(o.orderNumber)}" data-next="ACCEPTED">受付</button>
        <button type="button" class="btn-act btn-act--complete js-status-btn" data-order="${esc(o.orderNumber)}" data-next="COMPLETED">実施済</button>`;
    } else if (st.code === 'ACCEPTED') {
      actionBtns = `
        <button type="button" class="btn-act btn-act--complete js-status-btn" data-order="${esc(o.orderNumber)}" data-next="COMPLETED">実施済</button>`;
    }

    const nextOnBadge = st.code === 'ORDERED' ? 'ACCEPTED' : st.code === 'ACCEPTED' ? 'COMPLETED' : '';

    return `
      <article class="order-card order-card--${st.cls} ${o.isPortable ? 'is-portable' : ''}">
        <div class="card-top">
          <code class="card-num">${esc(o.orderNumber)}</code>
          <button
            type="button"
            class="st-badge st-badge--${st.cls} ${nextOnBadge ? 'js-status-btn' : ''}"
            data-order="${esc(o.orderNumber)}"
            data-next="${nextOnBadge}"
            ${nextOnBadge ? 'title="クリックで次の状態へ進める"' : 'disabled'}
          >${st.label}</button>
          <span class="card-date">${fmtDateTime(o.scheduledDate || o.createdAt)}</span>
        </div>
        <div class="card-patient">
          <span class="card-pid">${esc(o.patientId)}</span>
          <span class="card-pname">${esc(o.patientName)}</span>
          <span class="card-pmeta">${esc(o.gender)} ${o.age != null ? o.age + '歳' : ''} / ${esc(o.ward)} ${esc(o.room)}</span>
        </div>
        ${alerts.length > 0 ? `<div class="card-alerts" data-card-item="alerts">${alerts.join('')}</div>` : ''}
        <div class="card-exam">${esc(o.examType)}${o.partsDetail ? ` <span class="card-sub">(${esc(o.partsDetail)})</span>` : ''}</div>
        ${o.purpose ? `<div class="card-sub" data-card-item="purpose">目的: ${esc(o.purpose)}</div>` : ''}
        <div class="card-sub" data-card-item="doctor">依頼: ${esc(o.doctorName)}（${esc(o.requestDepartment)}）</div>
        ${stampHtml}
        <div class="card-actions">
          ${actionBtns}
          <a href="/radiology/print/${encodeURIComponent(o.orderNumber)}" target="_blank" class="btn-act btn-act--slip">伝票</a>
        </div>
      </article>
    `;
  }

  function renderColumn(container, orders, emptyText) {
    if (!container) return;
    if (!orders || orders.length === 0) {
      container.innerHTML = `<div class="empty-col">${emptyText}</div>`;
      return;
    }
    const sorted = [...orders].sort((a, b) => {
      const pA = getStatusMeta(a).prio;
      const pB = getStatusMeta(b).prio;
      if (pA !== pB) return pA - pB;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    container.innerHTML = sorted.map(renderCard).join('');
  }

  function renderTable(orders) {
    if (!tableBody) return;
    if (tableCountBadge) tableCountBadge.textContent = `${orders.length}件`;

    if (orders.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="10" class="empty-col">該当するオーダーはありません</td></tr>';
      return;
    }

    const sorted = [...orders].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'status') cmp = getStatusMeta(a).prio - getStatusMeta(b).prio;
      else if (sortKey === 'modality') cmp = (a.modality || '').localeCompare(b.modality || '', 'ja');
      else if (sortKey === 'orderNumber') cmp = (a.orderNumber || '').localeCompare(b.orderNumber || '');
      else if (sortKey === 'patient') cmp = (a.patientName || '').localeCompare(b.patientName || '', 'ja');
      else if (sortKey === 'exam') cmp = (a.examType || '').localeCompare(b.examType || '', 'ja');
      else if (sortKey === 'purpose') cmp = (a.purpose || '').localeCompare(b.purpose || '', 'ja');
      else if (sortKey === 'doctor') cmp = (a.doctorName || '').localeCompare(b.doctorName || '', 'ja');
      else if (sortKey === 'operator') cmp = (a.completedBy || a.acceptedBy || '').localeCompare(b.completedBy || b.acceptedBy || '', 'ja');
      else cmp = new Date(a.scheduledDate || a.createdAt).getTime() - new Date(b.scheduledDate || b.createdAt).getTime();

      return sortOrder === 'asc' ? cmp : -cmp;
    });

    tableBody.innerHTML = sorted
      .map((o) => {
        const st = getStatusMeta(o);
        const opStr = o.completedBy
          ? `実施: ${o.completedBy} (${fmtTime(o.completedAt)})`
          : o.acceptedBy
            ? `受付: ${o.acceptedBy} (${fmtTime(o.acceptedAt)})`
            : '-';

        let btns = '';
        if (st.code === 'ORDERED') {
          btns = `<button type="button" class="btn-act btn-act--accept js-status-btn" data-order="${esc(o.orderNumber)}" data-next="ACCEPTED">受付</button>
                  <button type="button" class="btn-act btn-act--complete js-status-btn" data-order="${esc(o.orderNumber)}" data-next="COMPLETED">実施済</button>`;
        } else if (st.code === 'ACCEPTED') {
          btns = `<button type="button" class="btn-act btn-act--complete js-status-btn" data-order="${esc(o.orderNumber)}" data-next="COMPLETED">実施済</button>
                  <button type="button" class="btn-act btn-act--revert js-status-btn" data-order="${esc(o.orderNumber)}" data-next="ORDERED">戻す</button>`;
        } else if (st.code === 'COMPLETED') {
          btns = `<button type="button" class="btn-act btn-act--revert js-status-btn" data-order="${esc(o.orderNumber)}" data-next="ACCEPTED">戻す</button>`;
        }

        return `
          <tr>
            <td><span class="st-badge st-badge--${st.cls}">${st.label}</span></td>
            <td><span class="mod-pill mod-pill--${esc(o.modalityKey)}">${esc(o.modality)}</span></td>
            <td><code>${esc(o.orderNumber)}</code></td>
            <td>${fmtDateTime(o.scheduledDate || o.createdAt)}</td>
            <td><strong>${esc(o.patientId)}</strong> ${esc(o.patientName)} <span class="card-sub">(${esc(o.ward)} ${esc(o.room)})</span></td>
            <td><strong>${esc(o.examType)}</strong>${o.isPortable ? ' <span class="alert-tag alert-tag--port">ポータブル</span>' : ''}</td>
            <td data-card-item="purpose">${esc(o.purpose || '-')}</td>
            <td data-card-item="doctor">${esc(o.doctorName)}</td>
            <td>${esc(opStr)}</td>
            <td class="cell-actions">
              ${btns}
              <a href="/radiology/print/${encodeURIComponent(o.orderNumber)}" target="_blank" class="btn-act">伝票</a>
            </td>
          </tr>`;
      })
      .join('');
  }

  async function loadOrders(silent) {
    try {
      const params = new URLSearchParams({
        status: currentFilter,
        search: searchQuery,
        includeInactive: includeInactive ? 'true' : 'false',
        _t: String(Date.now())
      });
      const res = await fetch(`/api/radiology-orders?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '取得失敗');
      }

      currentOrders = data.orders || [];
      const c = data.counts || {};
      if (statOrdered) statOrdered.textContent = c.ordered || 0;
      if (statAccepted) statAccepted.textContent = c.accepted || 0;
      if (statCompleted) statCompleted.textContent = c.completed || 0;
      if (statPortable) statPortable.textContent = c.portable || 0;

      const grouped = data.grouped || { xray: [], ct: [], fluoro: [] };
      renderColumn(xrayList, grouped.xray, '一般撮影のオーダーはありません');
      renderColumn(ctList, grouped.ct, 'CT検査のオーダーはありません');
      renderColumn(fluoroList, grouped.fluoro, 'X線透視のオーダーはありません');
      if (badgeXray) badgeXray.textContent = `${grouped.xray.length}件`;
      if (badgeCt) badgeCt.textContent = `${grouped.ct.length}件`;
      if (badgeFluoro) badgeFluoro.textContent = `${grouped.fluoro.length}件`;

      renderTable(currentOrders);
      applyVisibilityToggles();

      if (lastUpdatedEl) {
        lastUpdatedEl.textContent = new Date().toLocaleTimeString('ja-JP', { hour12: false });
      }
      if (!silent) showStatus('最新状態に更新しました。', false);
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  async function updateStatus(orderNumber, nextStatus) {
    if (!orderNumber || !nextStatus) return;
    try {
      const res = await fetch(`/api/radiology-orders/${encodeURIComponent(orderNumber)}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'ステータス更新に失敗しました');
      }
      const label = nextStatus === 'ACCEPTED' ? '受付済' : nextStatus === 'COMPLETED' ? '実施済' : '未受付';
      showStatus(`${orderNumber} を「${label}」に更新しました。`, false);
      await loadOrders(true);
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  // イベント設定
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentFilter = btn.getAttribute('data-filter');
      const isList = currentFilter === 'ALL';
      if (kanbanEl) kanbanEl.hidden = isList;
      if (listEl) listEl.hidden = !isList;
      loadOrders(true);
    });
  });

  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        loadOrders(true);
      }, 200);
    });
  }

  if (chkIncludeInactive) {
    chkIncludeInactive.addEventListener('change', () => {
      includeInactive = chkIncludeInactive.checked;
      loadOrders(true);
    });
  }

  document.getElementById('btnRefresh')?.addEventListener('click', () => loadOrders(false));

  document.querySelectorAll('[data-col-toggle], [data-card-toggle]').forEach((cb) => {
    cb.addEventListener('change', applyVisibilityToggles);
  });

  // ステータス変更ボタン（イベント委譲）
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.js-status-btn');
    if (!btn || btn.disabled) return;
    const orderNum = btn.getAttribute('data-order');
    const next = btn.getAttribute('data-next');
    if (orderNum && next) {
      updateStatus(orderNum, next);
    }
  });

  // テーブルソート
  const SORT_LABELS = {
    status: '状態',
    modality: '区分',
    orderNumber: 'オーダー番号',
    date: '検査日時',
    patient: '患者',
    exam: '検査種別',
    purpose: '検査目的',
    doctor: '依頼医',
    operator: '対応技師'
  };

  function updateSortUi() {
    if (sortBadge) {
      sortBadge.textContent = `並替: ${SORT_LABELS[sortKey] || sortKey}（${sortOrder === 'asc' ? '昇順' : '降順'}）`;
    }
    if (btnResetSort) {
      btnResetSort.hidden = sortKey === 'date' && sortOrder === 'desc';
    }
  }

  document.querySelectorAll('.th-sort').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-sort');
      if (sortKey === k) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = k;
        sortOrder = k === 'date' ? 'desc' : 'asc';
      }
      updateSortUi();
      renderTable(currentOrders);
      applyVisibilityToggles();
    });
  });

  if (btnResetSort) {
    btnResetSort.addEventListener('click', () => {
      sortKey = 'date';
      sortOrder = 'desc';
      updateSortUi();
      renderTable(currentOrders);
      applyVisibilityToggles();
    });
  }

  function syncPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (chkAutoPoll && chkAutoPoll.checked) {
      pollTimer = setInterval(() => loadOrders(true), 5000);
    }
  }

  if (chkAutoPoll) {
    chkAutoPoll.addEventListener('change', syncPolling);
  }

  updateSortUi();
  loadOrders(true);
  syncPolling();
})();
