'use strict';

(function initWorkspaceScreen() {
  const deptCode = document.body.dataset.deptCode || '';
  const deptName = document.body.dataset.deptName || '';
  const workspacePath = document.body.dataset.workspacePath || window.location.pathname;
  const selectedPatientId = document.body.dataset.patientId || '';
  const selectedPatientCareCategory = document.body.dataset.patientCareCategory || '';
  const selectedPatientCareName = document.body.dataset.patientCareName || '';
  const isRadLinked = document.body.dataset.radLinked === '1';

  const patientPicker = document.getElementById('wsPatientPicker');
  const radTreeBadge = document.getElementById('radTreeCountBadge');
  const rxTreeBadge = document.getElementById('rxTreeCountBadge');
  const injTreeBadge = document.getElementById('injTreeCountBadge');
  const mealTreeBadge = document.getElementById('mealTreeCountBadge');
  const rehabTreeBadge = document.getElementById('rehabTreeCountBadge');
  const historyListEl = document.getElementById('wsRadiologyHistory');
  const chkShowFlagged = document.getElementById('chkWsShowFlagged');

  const defaultBody = document.getElementById('editorDefaultBody');
  const summaryPanel = document.getElementById('radSummaryPanel');
  const summaryBody = document.getElementById('wsRadSummaryBody');
  const embedWrap = document.getElementById('radEmbedWrap');
  const embedFrame = document.getElementById('radOrderFrame');
  const statusBarTitleEl = document.querySelector('[data-testid="status-bar-title"]');
  const baseScreenTitle = statusBarTitleEl ? statusBarTitleEl.textContent : '';

  function setStatusTitle(subTitle) {
    if (!statusBarTitleEl) return;
    statusBarTitleEl.textContent = subTitle ? `${deptName} ${subTitle}` : baseScreenTitle;
  }

  function rxKindFromType(rxType) {
    if (rxType === '定期処方') return 'regular';
    if (rxType === '外来処方') return 'outpatient';
    return 'adhoc';
  }

  function rxTitleFromKind(kind) {
    if (kind === 'regular') return '定期処方箋';
    if (kind === 'outpatient') return '外来処方箋';
    return '臨時処方箋';
  }

  function injKindFromType(injType) {
    return injType === '外来注射' ? 'outpatient' : 'inpatient';
  }

  function injTitleFromKind(kind) {
    return kind === 'outpatient' ? '外来注射箋' : '入院注射箋';
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

  function getRadStatusMeta(o) {
    if (o.isSuperseded) return { label: '訂正済', cls: 'st-superseded' };
    if (o.isCancelled || o.orderStatus === 'CANCELLED') return { label: '中止', cls: 'st-cancelled' };
    if (o.orderStatus === 'COMPLETED') return { label: '実施済', cls: 'st-completed' };
    if (o.orderStatus === 'ACCEPTED') return { label: '受付済', cls: 'st-accepted' };
    return { label: '未受付', cls: 'st-ordered' };
  }

  function getRxStatusMeta(rx) {
    if (rx.isSuperseded) return { label: '訂正済', cls: 'st-superseded' };
    if (rx.isCancelled || rx.orderStatus === 'CANCELLED') return { label: '中止', cls: 'st-cancelled' };
    return { label: '発行済', cls: 'st-completed' };
  }

  function applyDisplayCheckboxes() {
    document.querySelectorAll('[data-toggle-target]').forEach((checkbox) => {
      const targetName = checkbox.getAttribute('data-toggle-target');
      document.querySelectorAll(`[data-toggle-group="${targetName}"]`).forEach((el) => {
        el.classList.toggle('is-hidden-item', !checkbox.checked);
      });
    });

    const kindEnabled = {};
    document.querySelectorAll('[data-type-toggle]').forEach((cb) => {
      kindEnabled[cb.getAttribute('data-type-toggle')] = cb.checked;
    });
    const showFlagged = chkShowFlagged ? chkShowFlagged.checked : true;

    document.querySelectorAll('.ws-hist-card').forEach((card) => {
      const kind = card.getAttribute('data-order-kind') || '';
      const flagged = card.getAttribute('data-flagged') === 'true';
      const hideByKind = kind && Object.prototype.hasOwnProperty.call(kindEnabled, kind) && !kindEnabled[kind];
      const hideByFlag = flagged && !showFlagged;
      card.classList.toggle('is-hidden-item', Boolean(hideByKind || hideByFlag));
    });
  }

  document.querySelectorAll('[data-toggle-target], [data-type-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', applyDisplayCheckboxes);
  });
  if (chkShowFlagged) {
    chkShowFlagged.addEventListener('change', applyDisplayCheckboxes);
  }

  if (patientPicker) {
    patientPicker.addEventListener('change', () => {
      const pid = patientPicker.value;
      window.location.href = pid
        ? `${workspacePath}?patientId=${encodeURIComponent(pid)}`
        : `${workspacePath}?patientId=`;
    });
  }

  function setEditorMode(mode) {
    if (defaultBody) defaultBody.hidden = mode !== 'default';
    if (summaryPanel) summaryPanel.hidden = mode !== 'list';
    if (embedWrap) embedWrap.hidden = mode !== 'embed';
  }

  function isClinicalDeptCode(code) {
    return code === 'ward' || code === 'outpatient' || code === 'care_umikaze' || code === 'care_shiokaze';
  }

  function isClinicalDeptName(name) {
    return (
      name === '医療病棟' ||
      name === '病棟' ||
      name === '外来' ||
      name === '介護医療院(うみかぜ)' ||
      name === '介護医療院(しおかぜ)'
    );
  }

  function defaultWardForOrder() {
    if (selectedPatientCareName) return selectedPatientCareName;
    return isClinicalDeptName(deptName) ? deptName : '';
  }

  let currentEmbedType = '';

  function openRadiologyEmbed(reviseOrderNumber) {
    if (!embedFrame) return;
    const params = new URLSearchParams({
      embed: '1',
      sourceDept: deptCode,
      ward: defaultWardForOrder()
    });
    if (selectedPatientId) params.set('patientId', selectedPatientId);
    if (reviseOrderNumber) params.set('revise', reviseOrderNumber);
    currentEmbedType = 'rad';
    embedFrame.src = `/radiology?${params.toString()}`;
    setStatusTitle('放射線検査オーダー');
    setEditorMode('embed');
  }

  function openPrescriptionEmbed(kind, reviseOrderNumber, doOrderNumber) {
    if (!embedFrame) return;
    const safeKind = kind === 'regular' || kind === 'outpatient' ? kind : 'adhoc';
    const params = new URLSearchParams({
      embed: '1',
      sourceDept: deptCode,
      ward: defaultWardForOrder()
    });
    if (selectedPatientId) params.set('patientId', selectedPatientId);
    if (reviseOrderNumber) params.set('revise', reviseOrderNumber);
    if (doOrderNumber) params.set('do', doOrderNumber);
    currentEmbedType = 'rx';
    embedFrame.src = `/prescriptions/${safeKind}?${params.toString()}`;
    setStatusTitle(rxTitleFromKind(safeKind));
    setEditorMode('embed');
  }

  function openInjectionEmbed(kind, reviseOrderNumber) {
    if (!embedFrame) return;
    const safeKind = kind === 'outpatient' ? 'outpatient' : 'inpatient';
    const params = new URLSearchParams({
      embed: '1',
      sourceDept: deptCode,
      ward: defaultWardForOrder()
    });
    if (selectedPatientId) params.set('patientId', selectedPatientId);
    if (reviseOrderNumber) params.set('revise', reviseOrderNumber);
    currentEmbedType = 'inj';
    embedFrame.src = `/injections/${safeKind}?${params.toString()}`;
    setStatusTitle(injTitleFromKind(safeKind));
    setEditorMode('embed');
  }

  function openMealEmbed(reviseOrderNumber) {
    if (!embedFrame) return;
    const params = new URLSearchParams({
      embed: '1',
      sourceDept: deptCode,
      ward: defaultWardForOrder()
    });
    if (selectedPatientId) params.set('patientId', selectedPatientId);
    if (reviseOrderNumber) params.set('revise', reviseOrderNumber);
    currentEmbedType = 'meal';
    embedFrame.src = `/meals?${params.toString()}`;
    setStatusTitle('食事オーダー');
    setEditorMode('embed');
  }

  function openRehabEmbed(reviseOrderNumber) {
    if (!embedFrame) return;
    const params = new URLSearchParams({
      embed: '1',
      sourceDept: deptCode,
      ward: defaultWardForOrder()
    });
    if (selectedPatientId) params.set('patientId', selectedPatientId);
    if (reviseOrderNumber) params.set('revise', reviseOrderNumber);
    currentEmbedType = 'rehab';
    embedFrame.src = `/rehab?${params.toString()}`;
    setStatusTitle('リハビリ指示');
    setEditorMode('embed');
  }

  function renderCombinedHistory(radOrders, rxOrders, injOrders, mealOrders, rehabOrders) {
    const activeRad = radOrders.filter((o) => !o.isCancelled && !o.isSuperseded).length;
    const activeRx = rxOrders.filter((o) => !o.isCancelled && !o.isSuperseded).length;
    const activeInj = (injOrders || []).filter((o) => !o.isCancelled && !o.isSuperseded).length;
    const activeMeal = (mealOrders || []).filter((m) => !m.isCancelled && !m.isSuperseded).length;
    const activeRehab = (rehabOrders || []).filter((r) => !r.isCancelled && !r.isSuperseded).length;

    if (radTreeBadge) {
      radTreeBadge.textContent = String(activeRad);
      radTreeBadge.classList.toggle('tree-badge--active', activeRad > 0);
    }
    if (rxTreeBadge) {
      rxTreeBadge.textContent = String(activeRx);
      rxTreeBadge.classList.toggle('tree-badge--active', activeRx > 0);
    }
    if (injTreeBadge) {
      injTreeBadge.textContent = String(activeInj);
      injTreeBadge.classList.toggle('tree-badge--active', activeInj > 0);
    }
    if (mealTreeBadge) {
      mealTreeBadge.textContent = String(activeMeal);
      mealTreeBadge.classList.toggle('tree-badge--active', activeMeal > 0);
    }
    if (rehabTreeBadge) {
      rehabTreeBadge.textContent = String(activeRehab);
      rehabTreeBadge.classList.toggle('tree-badge--active', activeRehab > 0);
    }

    if (!historyListEl) return;
    if (
      radOrders.length === 0 &&
      rxOrders.length === 0 &&
      (!injOrders || injOrders.length === 0) &&
      (!mealOrders || mealOrders.length === 0) &&
      (!rehabOrders || rehabOrders.length === 0)
    ) {
      historyListEl.innerHTML = '<div class="empty-state"><p>過去記載はありません。</p></div>';
      return;
    }

    function toSortMs(val) {
      if (!val) return 0;
      const t = new Date(val).getTime();
      return Number.isNaN(t) ? 0 : t;
    }

    function renderInjCard(inj) {
      const st = getRxStatusMeta(inj);
      const flagged = Boolean(inj.isCancelled || inj.isSuperseded);
      const itemLines = (inj.items || [])
        .map((it) => {
          const chips =
            Array.isArray(it.dailySchedule) && it.dailySchedule.length > 0
              ? `<div class="inj-sched-chips">${it.dailySchedule
                  .map(
                    (d) =>
                      `<span class="inj-chip ${d.status === 'DELETE' ? 'inj-chip--del' : 'inj-chip--cont'}">${esc(
                        d.date.slice(5).replace('-', '/')
                      )}:${d.status === 'DELETE' ? '削' : '継'}</span>`
                  )
                  .join('')}</div>`
              : '';
          return `<div class="ws-rx-line"><strong>Rp${it.rpNo}:</strong> ${esc(it.drugName)} ${esc(it.dose)}（${esc(it.route)}${it.timing ? '・' + esc(it.timing) : ''}${it.rate ? '・' + esc(it.rate) : ''}・${esc(it.days)}${esc(it.dayUnit)}）${chips}</div>`;
        })
        .join('');
      return `
        <article class="ws-hist-card ws-hist-card--inj ${flagged ? 'is-flagged' : ''}" data-order-kind="inj" data-flagged="${flagged ? 'true' : 'false'}" data-detail-type="inj" data-detail-order="${esc(inj.orderNumber)}" title="クリックで詳細表示">
          <div class="ws-hist-card__top">
            <span class="mod-tag mod-tag--inj" data-toggle-group="col-category">注射/${esc(inj.injectionType)}</span>
            <code class="ws-code">${esc(inj.orderNumber)}</code>
            <span class="st-tag ${st.cls}">${st.label}</span>
            <span class="ws-date" data-toggle-group="col-date">${fmtDateTime(inj.createdAt)}</span>
          </div>
          <div class="ws-hist-card__main">
            ${!selectedPatientId ? `<span class="ws-pt">[${esc(inj.patientId)}] ${esc(inj.patientName)}</span>` : ''}
            ${itemLines}
          </div>
          ${inj.isSuperseded ? `<div class="ws-hist-card__flag">訂正先: ${esc(inj.supersededBy)}</div>` : ''}
          ${inj.isCancelled ? `<div class="ws-hist-card__flag">中止: ${esc(inj.cancelReason || '注射中止')}</div>` : ''}
          <div class="ws-hist-card__foot">
            <span class="ws-author" data-toggle-group="col-author">指示: ${esc(inj.doctorName)}（${esc(inj.ward)}${inj.room ? ' ' + esc(inj.room) : ''}）</span>
            <div class="ws-actions">
              ${!flagged && inj.injectionType === '入院注射' ? `<button type="button" class="btn-ws js-ws-inj-schedule" data-order="${esc(inj.orderNumber)}">日付編集</button>` : ''}
              ${!flagged ? `<button type="button" class="btn-ws js-ws-inj-revise" data-order="${esc(inj.orderNumber)}" data-inj-type="${esc(inj.injectionType)}">訂正再発行</button><button type="button" class="btn-ws btn-ws--warn js-ws-inj-cancel" data-order="${esc(inj.orderNumber)}">中止</button>` : ''}
              <a href="/injections/print/${encodeURIComponent(inj.orderNumber)}" target="_blank" class="btn-ws">印刷</a>
            </div>
          </div>
        </article>`;
    }

    function renderRxCard(rx) {
      const st = getRxStatusMeta(rx);
      const flagged = Boolean(rx.isCancelled || rx.isSuperseded);
      const rpLines = (rx.rpItems || [])
        .map(
          (rp) =>
            `<div class="ws-rx-line"><strong>Rp${rp.rpNo}:</strong> ${(rp.medicines || [])
              .map((m) => `${esc(m.name)} ${esc(m.dose)}`)
              .join(' / ')}（${esc(rp.usage)}・${esc(rp.days)}${esc(rp.dayUnit)}）</div>`
        )
        .join('');
      return `
        <article class="ws-hist-card ws-hist-card--rx ${flagged ? 'is-flagged' : ''}" data-order-kind="rx" data-flagged="${flagged ? 'true' : 'false'}" data-detail-type="rx" data-detail-order="${esc(rx.orderNumber)}" title="クリックで詳細表示">
          <div class="ws-hist-card__top">
            <span class="mod-tag mod-tag--fluoro" data-toggle-group="col-category">処方/${esc(rx.prescriptionType)}</span>
            <code class="ws-code">${esc(rx.orderNumber)}</code>
            <span class="st-tag ${st.cls}">${st.label}</span>
            <span class="ws-date" data-toggle-group="col-date">${fmtDateTime(rx.createdAt)}</span>
          </div>
          <div class="ws-hist-card__main">
            ${!selectedPatientId ? `<span class="ws-pt">[${esc(rx.patientId)}] ${esc(rx.patientName)}</span>` : ''}
            ${rpLines}
          </div>
          ${rx.isSuperseded ? `<div class="ws-hist-card__flag">訂正先: ${esc(rx.supersededBy)}</div>` : ''}
          ${rx.isCancelled ? `<div class="ws-hist-card__flag">中止: ${esc(rx.cancelReason || '処方中止')}</div>` : ''}
          <div class="ws-hist-card__foot">
            <span class="ws-author" data-toggle-group="col-author">処方: ${esc(rx.doctorName)}（${esc(rx.ward)}${rx.room ? ' ' + esc(rx.room) : ''}）</span>
            <div class="ws-actions">
              <button type="button" class="btn-ws btn-ws--do js-ws-rx-do" data-order="${esc(rx.orderNumber)}" data-rx-type="${esc(rx.prescriptionType)}">Do処方</button>
              ${!flagged ? `<button type="button" class="btn-ws js-ws-rx-revise" data-order="${esc(rx.orderNumber)}" data-rx-type="${esc(rx.prescriptionType)}">訂正再発行</button><button type="button" class="btn-ws btn-ws--warn js-ws-rx-cancel" data-order="${esc(rx.orderNumber)}">中止</button>` : ''}
              <a href="/prescriptions/print/${encodeURIComponent(rx.orderNumber)}" target="_blank" class="btn-ws">印刷</a>
            </div>
          </div>
        </article>`;
    }

    function renderRadCard(o) {
      const st = getRadStatusMeta(o);
      const flagged = Boolean(o.isCancelled || o.isSuperseded);
      const stamp = o.completedBy
        ? `<div class="ws-hist-card__stamp">実施: ${esc(o.completedBy)}</div>`
        : o.acceptedBy
          ? `<div class="ws-hist-card__stamp">受付: ${esc(o.acceptedBy)}</div>`
          : '';
      return `
        <article class="ws-hist-card ws-hist-card--${esc(o.modalityKey)} ${flagged ? 'is-flagged' : ''}" data-order-kind="rad" data-flagged="${flagged ? 'true' : 'false'}" data-detail-type="rad" data-detail-order="${esc(o.orderNumber)}" title="クリックで詳細表示">
          <div class="ws-hist-card__top">
            <span class="mod-tag mod-tag--${esc(o.modalityKey)}" data-toggle-group="col-category">放射線/${esc(o.modality)}</span>
            <code class="ws-code">${esc(o.orderNumber)}</code>
            <span class="st-tag ${st.cls}">${st.label}</span>
            <span class="ws-date" data-toggle-group="col-date">${fmtDateTime(o.createdAt || o.scheduledDate)}</span>
          </div>
          <div class="ws-hist-card__main">
            ${!selectedPatientId ? `<span class="ws-pt">[${esc(o.patientId)}] ${esc(o.patientName)}</span>` : ''}
            <strong>${esc(o.examType)}</strong>
            ${o.isPortable ? '<span class="mini-alert mini-alert--port">ポータブル</span>' : ''}
            ${o.isUrgent ? '<span class="mini-alert mini-alert--urgent">至急</span>' : ''}
            ${o.contrast === '造影' ? '<span class="mini-alert mini-alert--contrast">造影</span>' : ''}
          </div>
          ${o.purpose ? `<div class="ws-hist-card__sub">目的: ${esc(o.purpose)}</div>` : ''}
          ${stamp}
          ${o.isSuperseded ? `<div class="ws-hist-card__flag">訂正先: ${esc(o.supersededBy)}</div>` : ''}
          ${o.isCancelled ? `<div class="ws-hist-card__flag">中止: ${esc(o.cancelReason || '中止')}</div>` : ''}
          <div class="ws-hist-card__foot">
            <span class="ws-author" data-toggle-group="col-author">依頼: ${esc(o.doctorName)}（${esc(o.ward)}${o.room ? ' ' + esc(o.room) : ''}）</span>
            <div class="ws-actions">
              ${!flagged ? `<button type="button" class="btn-ws js-ws-revise" data-order="${esc(o.orderNumber)}">訂正再発行</button><button type="button" class="btn-ws btn-ws--warn js-ws-cancel" data-order="${esc(o.orderNumber)}">中止</button>` : ''}
              <a href="/radiology/print/${encodeURIComponent(o.orderNumber)}" target="_blank" class="btn-ws">伝票</a>
            </div>
          </div>
        </article>`;
    }

    function renderMealCard(m) {
      const st = getRxStatusMeta(m);
      const flagged = Boolean(m.isCancelled || m.isSuperseded);
      const subParts = [
        m.calories || '',
        m.saltLimit && m.saltLimit !== '制限なし' ? `塩分:${m.saltLimit}` : '',
        m.prohibitedFoods ? `禁止:${m.prohibitedFoods}` : ''
      ].filter(Boolean);
      return `
        <article class="ws-hist-card ws-hist-card--meal ${flagged ? 'is-flagged' : ''}" data-order-kind="meal" data-flagged="${flagged ? 'true' : 'false'}" data-detail-type="meal" data-detail-order="${esc(m.orderNumber)}" title="クリックで詳細表示">
          <div class="ws-hist-card__top">
            <span class="mod-tag mod-tag--meal" data-toggle-group="col-category">食事</span>
            <code class="ws-code">${esc(m.orderNumber)}</code>
            <span class="st-tag ${st.cls}">${st.label}</span>
            <span class="ws-date" data-toggle-group="col-date">${fmtDateTime(m.createdAt)}</span>
          </div>
          <div class="ws-hist-card__main">
            ${!selectedPatientId ? `<span class="ws-pt">[${esc(m.patientId)}] ${esc(m.patientName)}</span>` : ''}
            <strong>${esc(m.dietType)}</strong>（${esc(m.startDate)} ${esc(m.startMeal)}〜 ／ 主食:${esc(m.stapleType)} ${esc(m.stapleAmount)} ／ 副食:${esc(m.sideTexture)}${m.thickener && m.thickener !== 'なし' ? ' ／ とろみ:' + esc(m.thickener) : ''}）
          </div>
          ${subParts.length ? `<div class="ws-hist-card__sub">${esc(subParts.join(' ／ '))}</div>` : ''}
          ${m.isSuperseded ? `<div class="ws-hist-card__flag">訂正先: ${esc(m.supersededBy)}</div>` : ''}
          ${m.isCancelled ? `<div class="ws-hist-card__flag">中止: ${esc(m.cancelReason || '食事中止')}</div>` : ''}
          <div class="ws-hist-card__foot">
            <span class="ws-author" data-toggle-group="col-author">指示: ${esc(m.doctorName)}（${esc(m.ward)}${m.room ? ' ' + esc(m.room) : ''}）</span>
            <div class="ws-actions">
              ${!flagged ? `<button type="button" class="btn-ws js-ws-meal-revise" data-order="${esc(m.orderNumber)}">訂正再発行</button><button type="button" class="btn-ws btn-ws--warn js-ws-meal-cancel" data-order="${esc(m.orderNumber)}">中止</button>` : ''}
              <a href="/meals/print/${encodeURIComponent(m.orderNumber)}" target="_blank" class="btn-ws">印刷</a>
            </div>
          </div>
        </article>`;
    }

    function renderRehabCard(r) {
      const st = getRxStatusMeta(r);
      const flagged = Boolean(r.isCancelled || r.isSuperseded);
      const parts = [];
      if (r.ptItems && r.ptItems.length) parts.push('PT:' + r.ptItems.join('・'));
      if (r.otItems && r.otItems.length) parts.push('OT:' + r.otItems.join('・'));
      if (r.stItems && r.stItems.length) parts.push('ST:' + r.stItems.join('・'));
      if (r.evalItems && r.evalItems.length) parts.push('評価:' + r.evalItems.join('・'));
      return `
        <article class="ws-hist-card ws-hist-card--rehab ${flagged ? 'is-flagged' : ''}" data-order-kind="rehab" data-flagged="${flagged ? 'true' : 'false'}" data-detail-type="rehab" data-detail-order="${esc(r.orderNumber)}" title="クリックで詳細表示">
          <div class="ws-hist-card__top">
            <span class="mod-tag mod-tag--rehab" data-toggle-group="col-category">リハ/${esc(r.rehabCategory)}</span>
            <code class="ws-code">${esc(r.orderNumber)}</code>
            <span class="st-tag ${st.cls}">${st.label}</span>
            <span class="ws-date" data-toggle-group="col-date">${fmtDateTime(r.createdAt)}</span>
          </div>
          <div class="ws-hist-card__main">
            ${!selectedPatientId ? `<span class="ws-pt">[${esc(r.patientId)}] ${esc(r.patientName)}</span>` : ''}
            <strong>${esc(r.diagnosisName)}</strong>（${esc(r.frequencyPerWeek)}・${esc(r.unitsPerDay)}・${esc(r.location)}）
          </div>
          ${parts.length ? `<div class="ws-hist-card__sub">${esc(parts.join(' ／ '))}</div>` : ''}
          ${r.isSuperseded ? `<div class="ws-hist-card__flag">訂正先: ${esc(r.supersededBy)}</div>` : ''}
          ${r.isCancelled ? `<div class="ws-hist-card__flag">中止: ${esc(r.cancelReason || 'リハビリ中止')}</div>` : ''}
          <div class="ws-hist-card__foot">
            <span class="ws-author" data-toggle-group="col-author">指示: ${esc(r.doctorName)}（${esc(r.ward)}${r.room ? ' ' + esc(r.room) : ''}）</span>
            <div class="ws-actions">
              ${!flagged ? `<button type="button" class="btn-ws js-ws-rehab-revise" data-order="${esc(r.orderNumber)}">訂正再発行</button><button type="button" class="btn-ws btn-ws--warn js-ws-rehab-cancel" data-order="${esc(r.orderNumber)}">中止</button>` : ''}
              <a href="/rehab/print/${encodeURIComponent(r.orderNumber)}" target="_blank" class="btn-ws">印刷</a>
            </div>
          </div>
        </article>`;
    }

    const timeline = [
      ...(injOrders || []).map((d) => ({ kind: 'inj', ms: toSortMs(d.createdAt || d.startDate), d })),
      ...(rxOrders || []).map((d) => ({ kind: 'rx', ms: toSortMs(d.createdAt || d.startDate), d })),
      ...(radOrders || []).map((d) => ({ kind: 'rad', ms: toSortMs(d.createdAt || d.scheduledDate), d })),
      ...(mealOrders || []).map((d) => ({ kind: 'meal', ms: toSortMs(d.createdAt || d.startDate), d })),
      ...(rehabOrders || []).map((d) => ({ kind: 'rehab', ms: toSortMs(d.createdAt || d.orderDate), d }))
    ].sort((a, b) => b.ms - a.ms);

    historyListEl.innerHTML = timeline
      .map((entry) => {
        if (entry.kind === 'inj') return renderInjCard(entry.d);
        if (entry.kind === 'rx') return renderRxCard(entry.d);
        if (entry.kind === 'meal') return renderMealCard(entry.d);
        if (entry.kind === 'rehab') return renderRehabCard(entry.d);
        return renderRadCard(entry.d);
      })
      .join('');
    applyDisplayCheckboxes();
  }

  function renderSummaryRows(type, items) {
    if (!summaryBody) return;
    if (!items || items.length === 0) {
      summaryBody.innerHTML = '<tr><td colspan="8" class="empty-state">該当データはありません</td></tr>';
      return;
    }
    if (type === 'rad') {
      summaryBody.innerHTML = items
        .map((o) => {
          const st = getRadStatusMeta(o);
          const flagged = Boolean(o.isCancelled || o.isSuperseded);
          const op = o.completedBy ? `実施: ${o.completedBy}` : o.acceptedBy ? `受付: ${o.acceptedBy}` : '-';
          return `
            <tr>
              <td><span class="st-tag ${st.cls}">${st.label}</span></td>
              <td><span class="mod-tag mod-tag--${esc(o.modalityKey)}">${esc(o.modality)}</span></td>
              <td><code>${esc(o.orderNumber)}</code></td>
              <td>${fmtDateTime(o.scheduledDate || o.createdAt)}</td>
              <td><strong>${esc(o.patientId)}</strong> ${esc(o.patientName)}</td>
              <td><strong>${esc(o.examType)}</strong></td>
              <td>${esc(op)}</td>
              <td class="ws-actions">
                ${!flagged ? `<button type="button" class="btn-ws js-ws-revise" data-order="${esc(o.orderNumber)}">訂正</button>` : ''}
                <a href="/radiology/print/${encodeURIComponent(o.orderNumber)}" target="_blank" class="btn-ws">伝票</a>
              </td>
            </tr>`;
        })
        .join('');
    } else if (type === 'inj') {
      summaryBody.innerHTML = items
        .map((inj) => {
          const st = getRxStatusMeta(inj);
          const flagged = Boolean(inj.isCancelled || inj.isSuperseded);
          const text = (inj.items || [])
            .map((it) => `Rp${it.rpNo}: ${it.drugName} ${it.dose} (${it.route} ${it.days}${it.dayUnit})`)
            .join(' / ');
          return `
            <tr>
              <td><span class="st-tag ${st.cls}">${st.label}</span></td>
              <td><span class="mod-tag mod-tag--inj">${esc(inj.injectionType)}</span></td>
              <td><code>${esc(inj.orderNumber)}</code></td>
              <td>${fmtDateTime(inj.createdAt)}</td>
              <td><strong>${esc(inj.patientId)}</strong> ${esc(inj.patientName)}</td>
              <td>${esc(text)}</td>
              <td>${esc(inj.doctorName)}</td>
              <td class="ws-actions">
                ${!flagged && inj.injectionType === '入院注射' ? `<button type="button" class="btn-ws js-ws-inj-schedule" data-order="${esc(inj.orderNumber)}">日付編集</button>` : ''}
                ${!flagged ? `<button type="button" class="btn-ws js-ws-inj-revise" data-order="${esc(inj.orderNumber)}" data-inj-type="${esc(inj.injectionType)}">訂正</button>` : ''}
                <a href="/injections/print/${encodeURIComponent(inj.orderNumber)}" target="_blank" class="btn-ws">印刷</a>
              </td>
            </tr>`;
        })
        .join('');
    } else {
      summaryBody.innerHTML = items
        .map((rx) => {
          const st = getRxStatusMeta(rx);
          const flagged = Boolean(rx.isCancelled || rx.isSuperseded);
          const text = (rx.rpItems || [])
            .map((rp) => `Rp${rp.rpNo}: ${(rp.medicines || []).map((m) => m.name).join('・')} (${rp.days}${rp.dayUnit})`)
            .join(' / ');
          return `
            <tr>
              <td><span class="st-tag ${st.cls}">${st.label}</span></td>
              <td><span class="mod-tag mod-tag--fluoro">${esc(rx.prescriptionType)}</span></td>
              <td><code>${esc(rx.orderNumber)}</code></td>
              <td>${fmtDateTime(rx.createdAt)}</td>
              <td><strong>${esc(rx.patientId)}</strong> ${esc(rx.patientName)}</td>
              <td>${esc(text)}</td>
              <td>${esc(rx.doctorName)}</td>
              <td class="ws-actions">
                <button type="button" class="btn-ws btn-ws--do js-ws-rx-do" data-order="${esc(rx.orderNumber)}" data-rx-type="${esc(rx.prescriptionType)}">Do処方</button>
                ${!flagged ? `<button type="button" class="btn-ws js-ws-rx-revise" data-order="${esc(rx.orderNumber)}" data-rx-type="${esc(rx.prescriptionType)}">訂正</button>` : ''}
                <a href="/prescriptions/print/${encodeURIComponent(rx.orderNumber)}" target="_blank" class="btn-ws">印刷</a>
              </td>
            </tr>`;
        })
        .join('');
    }
  }

  async function refreshAllHistory(showSummaryType) {
    try {
      const pRad = new URLSearchParams({ status: 'ALL', includeInactive: 'true', _t: String(Date.now()) });
      const pRx = new URLSearchParams({ includeInactive: 'true', _t: String(Date.now()) });
      const pInj = new URLSearchParams({ includeInactive: 'true', _t: String(Date.now()) });
      const pMeal = new URLSearchParams({ includeInactive: 'true', _t: String(Date.now()) });
      const pRehab = new URLSearchParams({ includeInactive: 'true', _t: String(Date.now()) });
      if (selectedPatientId) {
        pRad.set('patientId', selectedPatientId);
        pRx.set('patientId', selectedPatientId);
        pInj.set('patientId', selectedPatientId);
        pMeal.set('patientId', selectedPatientId);
        pRehab.set('patientId', selectedPatientId);
      }

      const [radRes, rxRes, injRes, mealRes, rehabRes] = await Promise.all([
        fetch(`/api/radiology-orders?${pRad.toString()}`, { cache: 'no-store' }),
        fetch(`/api/prescriptions?${pRx.toString()}`, { cache: 'no-store' }),
        fetch(`/api/injections?${pInj.toString()}`, { cache: 'no-store' }),
        fetch(`/api/meals?${pMeal.toString()}`, { cache: 'no-store' }),
        fetch(`/api/rehab?${pRehab.toString()}`, { cache: 'no-store' })
      ]);

      const matchesDept = (rec) =>
        rec.ward === deptName ||
        (deptCode === 'ward' && rec.ward === '病棟') ||
        rec.sourceDepartment === deptCode;

      let radOrders = [];
      if (radRes && radRes.ok) {
        const d = await radRes.json();
        radOrders = d.orders || [];
        if (!selectedPatientId && isClinicalDeptCode(deptCode)) {
          radOrders = radOrders.filter(matchesDept);
        }
      }

      let rxOrders = [];
      if (rxRes && rxRes.ok) {
        const d = await rxRes.json();
        rxOrders = d.prescriptions || [];
        if (!selectedPatientId && isClinicalDeptCode(deptCode)) {
          rxOrders = rxOrders.filter(matchesDept);
        }
      }

      let injOrders = [];
      if (injRes && injRes.ok) {
        const d = await injRes.json();
        injOrders = d.injections || [];
        if (!selectedPatientId && isClinicalDeptCode(deptCode)) {
          injOrders = injOrders.filter(matchesDept);
        }
      }

      let mealOrders = [];
      if (mealRes && mealRes.ok) {
        const d = await mealRes.json();
        mealOrders = d.meals || [];
        if (!selectedPatientId && isClinicalDeptCode(deptCode)) {
          mealOrders = mealOrders.filter(matchesDept);
        }
      }

      let rehabOrders = [];
      if (rehabRes && rehabRes.ok) {
        const d = await rehabRes.json();
        rehabOrders = d.rehabs || [];
        if (!selectedPatientId && isClinicalDeptCode(deptCode)) {
          rehabOrders = rehabOrders.filter(matchesDept);
        }
      }

      renderCombinedHistory(radOrders, rxOrders, injOrders, mealOrders, rehabOrders);
      if (showSummaryType === 'rad') renderSummaryRows('rad', radOrders);
      if (showSummaryType === 'rx') renderSummaryRows('rx', rxOrders);
      if (showSummaryType === 'inj') renderSummaryRows('inj', injOrders);
    } catch (_) {}
  }

  // 左ツリークリック処理
  const leaves = document.querySelectorAll('button.tree-leaf');
  leaves.forEach((btn) => {
    btn.addEventListener('click', () => {
      leaves.forEach((other) => other.classList.remove('is-selected'));
      btn.classList.add('is-selected');

      const radAction = btn.getAttribute('data-rad-action');
      if (radAction === 'create') {
        openRadiologyEmbed('');
        return;
      }
      if (radAction === 'list') {
        setStatusTitle('放射線検査オーダー 一覧');
        setEditorMode('list');
        refreshAllHistory('rad');
        return;
      }

      const rxAction = btn.getAttribute('data-rx-action');
      if (rxAction === 'create-adhoc' || rxAction === 'create') {
        openPrescriptionEmbed('adhoc', '');
        return;
      }
      if (rxAction === 'create-regular') {
        openPrescriptionEmbed('regular', '');
        return;
      }
      if (rxAction === 'create-outpatient') {
        openPrescriptionEmbed('outpatient', '');
        return;
      }
      if (rxAction === 'list') {
        setStatusTitle('処方履歴 一覧');
        setEditorMode('list');
        refreshAllHistory('rx');
        return;
      }

      const injAction = btn.getAttribute('data-inj-action');
      if (injAction === 'create-inpatient') {
        openInjectionEmbed('inpatient', '');
        return;
      }
      if (injAction === 'create-outpatient') {
        openInjectionEmbed('outpatient', '');
        return;
      }
      if (injAction === 'list') {
        setStatusTitle('注射履歴 一覧');
        setEditorMode('list');
        refreshAllHistory('inj');
        return;
      }

      const mealAction = btn.getAttribute('data-meal-action');
      if (mealAction === 'create') {
        openMealEmbed('');
        return;
      }

      const rehabAction = btn.getAttribute('data-rehab-action');
      if (rehabAction === 'create') {
        openRehabEmbed('');
        return;
      }

      const treeItemLabel = btn.getAttribute('data-tree-item') || '';
      setStatusTitle(treeItemLabel);
      setEditorMode('default');
    });
  });

  // 中列・一覧テーブル内の訂正再発行 / 中止
  document.addEventListener('click', async (event) => {
    const revRad = event.target.closest('.js-ws-revise');
    if (revRad) {
      openRadiologyEmbed(revRad.getAttribute('data-order'));
      return;
    }

    const doRx = event.target.closest('.js-ws-rx-do');
    if (doRx) {
      const orderNum = doRx.getAttribute('data-order');
      const rxType = doRx.getAttribute('data-rx-type') || '';
      if (currentEmbedType === 'rx' && embedWrap && !embedWrap.hidden && embedFrame && embedFrame.contentWindow) {
        embedFrame.contentWindow.postMessage(
          { type: 'DO_PRESCRIPTION', orderNumber: orderNum },
          window.location.origin
        );
      } else {
        const targetKind =
          selectedPatientCareCategory === 'outpatient'
            ? 'outpatient'
            : selectedPatientCareCategory
              ? (rxType === '定期処方' ? 'regular' : 'adhoc')
              : deptCode === 'outpatient'
                ? 'outpatient'
                : rxType === '定期処方'
                  ? 'regular'
                  : 'adhoc';
        openPrescriptionEmbed(targetKind, '', orderNum);
      }
      return;
    }

    const revRx = event.target.closest('.js-ws-rx-revise');
    if (revRx) {
      const kind = rxKindFromType(revRx.getAttribute('data-rx-type'));
      openPrescriptionEmbed(kind, revRx.getAttribute('data-order'));
      return;
    }

    const schedInj = event.target.closest('.js-ws-inj-schedule');
    if (schedInj && window.InjectionScheduleModal) {
      window.InjectionScheduleModal.openForOrder(schedInj.getAttribute('data-order'), () => {
        refreshAllHistory('');
      });
      return;
    }

    const revInj = event.target.closest('.js-ws-inj-revise');
    if (revInj) {
      const kind = injKindFromType(revInj.getAttribute('data-inj-type'));
      openInjectionEmbed(kind, revInj.getAttribute('data-order'));
      return;
    }

    const cancelRad = event.target.closest('.js-ws-cancel');
    if (cancelRad) {
      const orderNum = cancelRad.getAttribute('data-order');
      const reason = window.prompt(`オーダー ${orderNum} に中止フラグを設定します。理由を入力してください:`, '医師指示により中止');
      if (reason === null) return;
      await fetch(`/api/radiology-orders/${encodeURIComponent(orderNum)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason })
      });
      await refreshAllHistory('');
      return;
    }

    const cancelRx = event.target.closest('.js-ws-rx-cancel');
    if (cancelRx) {
      const orderNum = cancelRx.getAttribute('data-order');
      const reason = window.prompt(`処方箋 ${orderNum} に中止フラグを設定します。理由を入力してください:`, '医師指示により中止');
      if (reason === null) return;
      await fetch(`/api/prescriptions/${encodeURIComponent(orderNum)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason })
      });
      await refreshAllHistory('');
      return;
    }

    const cancelInj = event.target.closest('.js-ws-inj-cancel');
    if (cancelInj) {
      const orderNum = cancelInj.getAttribute('data-order');
      const reason = window.prompt(`注射箋 ${orderNum} に中止フラグを設定します。理由を入力してください:`, '医師指示により中止');
      if (reason === null) return;
      await fetch(`/api/injections/${encodeURIComponent(orderNum)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason })
      });
      await refreshAllHistory('');
      return;
    }

    const revMeal = event.target.closest('.js-ws-meal-revise');
    if (revMeal) {
      openMealEmbed(revMeal.getAttribute('data-order'));
      return;
    }

    const cancelMeal = event.target.closest('.js-ws-meal-cancel');
    if (cancelMeal) {
      const orderNum = cancelMeal.getAttribute('data-order');
      const reason = window.prompt(`食事オーダー ${orderNum} に中止フラグを設定します。理由を入力してください:`, '指示変更により中止');
      if (reason === null) return;
      await fetch(`/api/meals/${encodeURIComponent(orderNum)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason })
      });
      await refreshAllHistory('');
      return;
    }

    const revRehab = event.target.closest('.js-ws-rehab-revise');
    if (revRehab) {
      openRehabEmbed(revRehab.getAttribute('data-order'));
      return;
    }

    const cancelRehab = event.target.closest('.js-ws-rehab-cancel');
    if (cancelRehab) {
      const orderNum = cancelRehab.getAttribute('data-order');
      const reason = window.prompt(`リハビリ指示 ${orderNum} に中止フラグを設定します。理由を入力してください:`, '医師指示により中止');
      if (reason === null) return;
      await fetch(`/api/rehab/${encodeURIComponent(orderNum)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason })
      });
      await refreshAllHistory('');
    }
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (
      event.data &&
      (event.data.type === 'RADIOLOGY_ORDER_SAVED' ||
        event.data.type === 'PRESCRIPTION_SAVED' ||
        event.data.type === 'INJECTION_SAVED' ||
        event.data.type === 'MEAL_ORDER_SAVED' ||
        event.data.type === 'REHAB_ORDER_SAVED')
    ) {
      refreshAllHistory('');
    }
  });

  applyDisplayCheckboxes();
})();
