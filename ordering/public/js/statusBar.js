'use strict';

(function initStatusBarMenu() {
  function setupDropdown(containerSel, toggleSel, panelSel) {
    const container = document.querySelector(containerSel);
    if (!container) return null;
    const toggleBtn = container.querySelector(toggleSel);
    const panel = container.querySelector(panelSel);
    if (!toggleBtn || !panel) return null;

    function setOpen(isOpen) {
      panel.hidden = !isOpen;
      toggleBtn.setAttribute('aria-expanded', String(isOpen));
    }

    toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(panel.hidden);
    });

    document.addEventListener('click', (event) => {
      if (!container.contains(event.target)) {
        setOpen(false);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    });

    return { container, toggleBtn, panel, setOpen };
  }

  setupDropdown('[data-menu-dropdown]', '[data-menu-toggle]', '[data-menu-panel]');
  const elevateMenu = setupDropdown('[data-elevate-menu]', '[data-elevate-toggle]', '[data-elevate-panel]');

  if (elevateMenu) {
    elevateMenu.panel.addEventListener('click', async (event) => {
      const docBtn = event.target.closest('[data-elevate-doctor]');
      if (docBtn) {
        const doctorStaffId = docBtn.getAttribute('data-elevate-doctor');
        if (!doctorStaffId) return;
        try {
          const res = await fetch('/api/auth/elevate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ doctorStaffId })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) {
            window.alert(data.error || '権限代行に失敗しました。');
            return;
          }
          if (window.location.pathname.startsWith('/workspace/') && (data.workspacePath || data.redirectTo)) {
            window.location.href = (data.workspacePath || data.redirectTo) + window.location.search;
          } else {
            window.location.reload();
          }
        } catch (err) {
          window.alert(err.message || '権限代行に失敗しました。');
        }
        return;
      }

      const clearBtn = event.target.closest('[data-elevate-clear]');
      if (clearBtn) {
        try {
          const res = await fetch('/api/auth/elevate/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) {
            window.alert(data.error || '権限代行の解除に失敗しました。');
            return;
          }
          if (window.location.pathname.startsWith('/workspace/') && (data.workspacePath || data.redirectTo)) {
            window.location.href = (data.workspacePath || data.redirectTo) + window.location.search;
          } else {
            window.location.reload();
          }
        } catch (err) {
          window.alert(err.message || '権限代行の解除に失敗しました。');
        }
      }
    });
  }

  /**
   * 縦3列レイアウトの極細境界ドラッグリサイズ
   */
  (function initThreeColumnResizers() {
    if (document.body && document.body.dataset.embed === '1') return;

    const CONFIGS = [
      { selector: '.workspace-grid', mode: 'left-mid', defaults: [230, 330], min: [120, 160, 260] },
      { selector: '.rx-grid:not(.is-embed-grid)', mode: 'left-mid', defaults: [210, 300], min: [120, 160, 260] },
      { selector: '.inj-grid:not(.is-embed-grid)', mode: 'left-mid', defaults: [210, 300], min: [120, 160, 260] },
      { selector: '.clin-grid:not(.is-embed-grid)', mode: 'left-mid', defaults: [210, 300], min: [120, 160, 260] },
      { selector: '.rad-grid:not(.is-embed-grid)', mode: 'left-mid', defaults: [195, 300], min: [120, 160, 260] },
      { selector: '.med-grid', mode: 'left-right', defaults: [225, 340], min: [120, 260, 180] }
    ];

    let grid = null;
    let cfg = null;
    for (const c of CONFIGS) {
      const el = document.querySelector(c.selector);
      if (el) {
        grid = el;
        cfg = c;
        break;
      }
    }
    if (!grid || !cfg) return;

    const panes = Array.from(grid.children).filter((el) => !el.classList.contains('pane-resizer'));
    if (panes.length !== 3) return;

    const storageKey = `ordering:colwidths:${cfg.selector}`;
    let widths = [...cfg.defaults];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 2 && parsed.every((n) => Number.isFinite(n) && n >= 80)) {
          widths = parsed;
        }
      }
    } catch (_) {}

    grid.classList.add('has-pane-resizers');

    const handle0 = document.createElement('div');
    handle0.className = 'pane-resizer';
    handle0.setAttribute('role', 'separator');
    handle0.setAttribute('aria-orientation', 'vertical');
    handle0.setAttribute('aria-label', '左列・中列の境界幅を変更');
    handle0.title = 'ドラッグで幅を変更（ダブルクリックで初期化）';

    const handle1 = document.createElement('div');
    handle1.className = 'pane-resizer';
    handle1.setAttribute('role', 'separator');
    handle1.setAttribute('aria-orientation', 'vertical');
    handle1.setAttribute('aria-label', '中列・右列の境界幅を変更');
    handle1.title = 'ドラッグで幅を変更（ダブルクリックで初期化）';

    grid.appendChild(handle0);
    grid.appendChild(handle1);

    function isPaneVisible(el) {
      return el && window.getComputedStyle(el).display !== 'none';
    }

    function clampWidths() {
      const total = grid.clientWidth || window.innerWidth || 1200;
      const [min0, min1, min2] = cfg.min;
      if (cfg.mode === 'left-mid') {
        const maxLeft = Math.max(min0, total - min1 - min2 - 2);
        widths[0] = Math.min(Math.max(Math.round(widths[0]), min0), maxLeft);
        const maxMid = Math.max(min1, total - widths[0] - min2 - 2);
        widths[1] = Math.min(Math.max(Math.round(widths[1]), min1), maxMid);
      } else {
        const maxLeft = Math.max(min0, total - min1 - min2 - 2);
        widths[0] = Math.min(Math.max(Math.round(widths[0]), min0), maxLeft);
        const maxRight = Math.max(min2, total - widths[0] - min1 - 2);
        widths[1] = Math.min(Math.max(Math.round(widths[1]), min2), maxRight);
      }
    }

    function positionHandles() {
      const vis0 = isPaneVisible(panes[0]);
      const vis1 = isPaneVisible(panes[1]);
      const vis2 = isPaneVisible(panes[2]);

      if (vis0 && vis1) {
        handle0.hidden = false;
        handle0.style.left = `${panes[0].offsetLeft + panes[0].offsetWidth}px`;
      } else {
        handle0.hidden = true;
      }

      if (vis1 && vis2) {
        handle1.hidden = false;
        handle1.style.left = `${panes[1].offsetLeft + panes[1].offsetWidth}px`;
      } else {
        handle1.hidden = true;
      }
    }

    function applyColumns() {
      const allVis = isPaneVisible(panes[0]) && isPaneVisible(panes[1]) && isPaneVisible(panes[2]);
      if (!allVis) {
        grid.style.gridTemplateColumns = '';
      } else {
        clampWidths();
        if (cfg.mode === 'left-mid') {
          grid.style.gridTemplateColumns = `${widths[0]}px ${widths[1]}px 1fr`;
        } else {
          grid.style.gridTemplateColumns = `${widths[0]}px 1fr ${widths[1]}px`;
        }
      }
      window.requestAnimationFrame(positionHandles);
    }

    function saveWidths() {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(widths));
      } catch (_) {}
    }

    function attachDrag(handleEl, index) {
      handleEl.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();

        const startX = event.clientX;
        const startWidths = [...widths];
        handleEl.classList.add('is-dragging');
        document.body.classList.add('is-col-resizing');

        function onMove(moveEvent) {
          const dx = moveEvent.clientX - startX;
          if (index === 0) {
            widths[0] = startWidths[0] + dx;
          } else if (cfg.mode === 'left-mid') {
            widths[1] = startWidths[1] + dx;
          } else {
            widths[1] = startWidths[1] - dx;
          }
          applyColumns();
        }

        function onUp() {
          handleEl.classList.remove('is-dragging');
          document.body.classList.remove('is-col-resizing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          saveWidths();
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      handleEl.addEventListener('dblclick', () => {
        widths = [...cfg.defaults];
        try {
          window.localStorage.removeItem(storageKey);
        } catch (_) {}
        applyColumns();
      });
    }

    attachDrag(handle0, 0);
    attachDrag(handle1, 1);

    window.addEventListener('resize', applyColumns);
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => positionHandles());
      ro.observe(grid);
    }
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(() => applyColumns());
      mo.observe(grid, { attributes: true, attributeFilter: ['class'] });
    }

    applyColumns();
  })();

  /**
   * 中列オーダークリック時の詳細モーダル（中止指示日時・指示者・訂正履歴・操作履歴を含む）
   */
  (function initOrderDetailModal() {
    if (document.body && document.body.dataset.embed === '1') return;

    let backdrop = null;
    let titleEl = null;
    let bodyEl = null;
    let printLinkEl = null;

    function esc(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function fmtFullDateTime(val) {
      if (!val) return '-';
      const d = new Date(val);
      if (Number.isNaN(d.getTime())) return String(val);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
    }

    function actionLabel(action) {
      const map = {
        CREATED: '新規発行',
        REVISED_CREATE: '訂正再発行（新版作成）',
        SUPERSEDED: '訂正済（旧版フラグ）',
        CANCELLED: '中止指示',
        ACCEPTED: '受付',
        COMPLETED: '実施完了',
        ORDERED: '未受付へ戻し'
      };
      return map[action] || action || '-';
    }

    function ensureModal() {
      if (backdrop) return;
      backdrop = document.createElement('div');
      backdrop.className = 'ord-detail-backdrop';
      backdrop.id = 'orderDetailModal';
      backdrop.hidden = true;
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.innerHTML = `
        <div class="ord-detail-modal">
          <div class="ord-detail-modal__head">
            <span class="ord-detail-modal__title" id="orderDetailModalTitle">オーダー詳細</span>
            <button type="button" class="ord-detail-modal__close" id="btnCloseOrderDetail" aria-label="閉じる">×</button>
          </div>
          <div class="ord-detail-modal__body" id="orderDetailModalBody"></div>
          <div class="ord-detail-modal__foot">
            <a href="#" target="_blank" class="ord-detail-btn" id="btnPrintOrderDetail" hidden>印刷プレビュー</a>
            <button type="button" class="ord-detail-btn ord-detail-btn--primary" id="btnOkOrderDetail">閉じる</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);

      titleEl = backdrop.querySelector('#orderDetailModalTitle');
      bodyEl = backdrop.querySelector('#orderDetailModalBody');
      printLinkEl = backdrop.querySelector('#btnPrintOrderDetail');

      const close = () => {
        backdrop.hidden = true;
      };
      backdrop.querySelector('#btnCloseOrderDetail').addEventListener('click', close);
      backdrop.querySelector('#btnOkOrderDetail').addEventListener('click', close);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
        const refLink = e.target.closest('.ord-detail-link');
        if (refLink) {
          openDetail(refLink.dataset.refType, refLink.dataset.refOrder);
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && backdrop && !backdrop.hidden) close();
      });
    }

    function renderFlagsHtml(type, obj) {
      const blocks = [];
      if (obj.isCancelled) {
        blocks.push(`
          <div class="ord-detail-alert ord-detail-alert--cancel">
            <div><strong>【中止指示】</strong></div>
            <div>中止日時: <strong>${esc(fmtFullDateTime(obj.cancelledAt))}</strong> ／ 中止指示者: <strong>${esc(obj.cancelledBy || '-')}</strong></div>
            <div>中止理由: ${esc(obj.cancelReason || '中止')}</div>
          </div>`);
      }
      if (obj.isSuperseded) {
        blocks.push(`
          <div class="ord-detail-alert ord-detail-alert--superseded">
            <div><strong>【訂正済（旧版）】</strong></div>
            <div>訂正日時: <strong>${esc(fmtFullDateTime(obj.supersededAt))}</strong> ／ 訂正先:
              <button type="button" class="ord-detail-link" data-ref-type="${esc(type)}" data-ref-order="${esc(obj.supersededBy)}">${esc(obj.supersededBy)}</button>
            </div>
          </div>`);
      }
      if (obj.parentOrderNumber) {
        blocks.push(`
          <div class="ord-detail-alert ord-detail-alert--info">
            訂正元オーダー: <button type="button" class="ord-detail-link" data-ref-type="${esc(type)}" data-ref-order="${esc(obj.parentOrderNumber)}">${esc(obj.parentOrderNumber)}</button>
            ${obj.revisionNote ? `（理由: ${esc(obj.revisionNote)}）` : ''}
          </div>`);
      }
      if (obj.doSourceOrderNumber) {
        blocks.push(`
          <div class="ord-detail-alert ord-detail-alert--info">
            Do処方引用元: <button type="button" class="ord-detail-link" data-ref-type="rx" data-ref-order="${esc(obj.doSourceOrderNumber)}">${esc(obj.doSourceOrderNumber)}</button>
          </div>`);
      }
      return blocks.join('');
    }

    function renderHistoryTable(history) {
      const list = Array.isArray(history) ? history : [];
      if (list.length === 0) return '';
      const rows = list
        .map(
          (h) => `
          <tr>
            <td style="white-space:nowrap;">${esc(fmtFullDateTime(h.at))}</td>
            <td style="white-space:nowrap;"><strong>${esc(actionLabel(h.action))}</strong></td>
            <td>${esc(h.actor || '-')}</td>
            <td>${esc(h.note || '-')}</td>
          </tr>`
        )
        .join('');
      return `
        <div>
          <div class="ord-detail-sec-title">操作・変更履歴（追記監査ログ）</div>
          <table class="ord-detail-table ord-detail-list-table">
            <thead>
              <tr><th>日時</th><th>操作区分</th><th>指示者・実施者</th><th>内容・理由</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    function renderPrescriptionDetail(rx) {
      const itemsHtml = (rx.items || [])
        .map(
          (it, idx) => `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td><strong>${esc(it.drugName)}</strong>${it.genericName ? `<div style="font-size:10px;color:#64748b;">${esc(it.genericName)}</div>` : ''}</td>
            <td style="white-space:nowrap;">${esc(it.dailyDose)}</td>
            <td style="white-space:nowrap;">${it.divisionCount && /^\d+$/.test(it.divisionCount) ? `分${esc(it.divisionCount)}` : esc(it.divisionCount || '-')}</td>
            <td>${esc(it.administrationMethod)}</td>
            <td style="white-space:nowrap;">${esc(it.prescriptionDays)}${esc(it.dayUnit)}</td>
            <td>${esc(it.note || '')}</td>
          </tr>`
        )
        .join('');

      return `
        ${renderFlagsHtml('rx', rx)}
        <table class="ord-detail-table">
          <tr>
            <th>処方番号</th><td><code>${esc(rx.orderNumber)}</code></td>
            <th>処方種別</th><td><strong>${esc(rx.prescriptionType)}</strong>（${esc(rx.dispenseType || '院内処方')}）</td>
          </tr>
          <tr>
            <th>対象患者</th><td><strong>[${esc(rx.patientId)}] ${esc(rx.patientName)}</strong>（${esc(rx.gender || '-')} / ${rx.age != null ? esc(rx.age) + '歳' : '-'}）</td>
            <th>区分・病室</th><td>${esc(rx.ward || '-')} ${esc(rx.room || '')}</td>
          </tr>
          <tr>
            <th>指示者（医師）</th><td><strong>${esc(rx.doctorName || '-')}</strong></td>
            <th>発行日時 / 開始日</th><td>${esc(fmtFullDateTime(rx.createdAt))} ／ 開始: ${esc(rx.startDate || '-')}</td>
          </tr>
          <tr>
            <th>全体備考</th><td colspan="3">${esc(rx.remarks || '-')}</td>
          </tr>
        </table>
        <div>
          <div class="ord-detail-sec-title">処方内容</div>
          <table class="ord-detail-table ord-detail-list-table">
            <thead>
              <tr><th>#</th><th>薬剤名</th><th>1日量</th><th>分割回数</th><th>服用方法</th><th>処方日数</th><th>備考欄</th></tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        </div>
        ${renderHistoryTable(rx.statusHistory)}`;
    }

    function renderInjectionDetail(inj) {
      const showTimingCol = inj.injectionType !== '入院注射';
      const itemsHtml = (inj.items || [])
        .map(
          (it) => `
          <tr>
            <td style="text-align:center;font-weight:700;">Rp${esc(it.rpNo)}</td>
            <td><strong>${esc(it.drugName)}</strong></td>
            <td style="white-space:nowrap;">${esc(it.dose)}</td>
            <td style="white-space:nowrap;">${esc(it.route)}</td>
            ${showTimingCol ? `<td>${esc(it.timing || '-')}</td>` : ''}
            <td>${esc(it.rate || '-')}</td>
            <td style="white-space:nowrap;">${esc(it.days)}${esc(it.dayUnit)}</td>
            <td>${esc(it.note || '')}</td>
          </tr>`
        )
        .join('');

      const allDates = Array.from(
        new Set((inj.items || []).flatMap((it) => (it.dailySchedule || []).map((d) => d.date)))
      ).sort();

      let schedHtml = '';
      if (allDates.length > 0) {
        const heads = allDates.map((d) => `<th style="text-align:center;">${esc(d.slice(5).replace('-', '/'))}</th>`).join('');
        const bodyRows = (inj.items || [])
          .map((it) => {
            const map = Object.fromEntries((it.dailySchedule || []).map((d) => [d.date, d.status]));
            const cells = allDates
              .map((d) => {
                const st = map[d] || '';
                const style = st === 'DELETE'
                  ? 'text-align:center;background:#fee2e2;color:#991b1b;text-decoration:line-through;font-weight:700;'
                  : st === 'CONTINUE'
                    ? 'text-align:center;background:#dcfce7;color:#166534;font-weight:700;'
                    : 'text-align:center;';
                return `<td style="${style}">${st === 'CONTINUE' ? '○ 継続' : st === 'DELETE' ? '× 削除' : '-'}</td>`;
              })
              .join('');
            return `<tr><td style="text-align:center;font-weight:700;">Rp${esc(it.rpNo)}</td><td>${esc(it.drugName)}</td>${cells}</tr>`;
          })
          .join('');
        schedHtml = `
          <div>
            <div class="ord-detail-sec-title">日付別 継続・削除スケジュール</div>
            <table class="ord-detail-table ord-detail-list-table">
              <thead><tr><th>Rp</th><th>薬剤名</th>${heads}</tr></thead>
              <tbody>${bodyRows}</tbody>
            </table>
          </div>`;
      }

      return `
        ${renderFlagsHtml('inj', inj)}
        <table class="ord-detail-table">
          <tr>
            <th>注射番号</th><td><code>${esc(inj.orderNumber)}</code></td>
            <th>注射種別</th><td><strong>${esc(inj.injectionType)}</strong></td>
          </tr>
          <tr>
            <th>対象患者</th><td><strong>[${esc(inj.patientId)}] ${esc(inj.patientName)}</strong>（${esc(inj.gender || '-')} / ${inj.age != null ? esc(inj.age) + '歳' : '-'}）</td>
            <th>区分・病室</th><td>${esc(inj.ward || '-')} ${esc(inj.room || '')}</td>
          </tr>
          <tr>
            <th>指示者（医師）</th><td><strong>${esc(inj.doctorName || '-')}</strong></td>
            <th>発行日時 / 開始日</th><td>${esc(fmtFullDateTime(inj.createdAt))} ／ 開始: ${esc(inj.startDate || '-')}</td>
          </tr>
          <tr>
            <th>全体備考</th><td colspan="3">${esc(inj.remarks || '-')}</td>
          </tr>
        </table>
        <div>
          <div class="ord-detail-sec-title">注射内容</div>
          <table class="ord-detail-table ord-detail-list-table">
            <thead>
              <tr><th>Rp</th><th>薬剤名</th><th>投与量</th><th>投与経路</th>${showTimingCol ? '<th>実施時間</th>' : ''}<th>速度・時間</th><th>日数/回数</th><th>備考</th></tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        </div>
        ${schedHtml}
        ${renderHistoryTable(inj.statusHistory)}`;
    }

    function renderRadiologyDetail(o) {
      const statusText = o.isSuperseded
        ? '訂正済'
        : o.isCancelled
          ? '中止'
          : o.orderStatus === 'COMPLETED'
            ? '実施済'
            : o.orderStatus === 'ACCEPTED'
              ? '受付済'
              : '未受付';

      return `
        ${renderFlagsHtml('rad', o)}
        <table class="ord-detail-table">
          <tr>
            <th>オーダー番号</th><td><code>${esc(o.orderNumber)}</code></td>
            <th>モダリティ / 状態</th><td><strong>${esc(o.modality)}（${esc(o.formName)}）</strong> ／ ${esc(statusText)}</td>
          </tr>
          <tr>
            <th>対象患者</th><td><strong>[${esc(o.patientId)}] ${esc(o.patientName)}</strong>（${esc(o.gender || '-')} / ${o.age != null ? esc(o.age) + '歳' : '-'}）</td>
            <th>区分・病室</th><td>${esc(o.ward || '-')} ${esc(o.room || '')}</td>
          </tr>
          <tr>
            <th>依頼医師</th><td><strong>${esc(o.doctorName || '-')}</strong>（${esc(o.requestDepartment || '-')}）</td>
            <th>発行日時 / 予定日時</th><td>${esc(fmtFullDateTime(o.createdAt))} ／ 予定: ${esc(fmtFullDateTime(o.scheduledDate))}</td>
          </tr>
          <tr>
            <th>検査内容・部位</th><td colspan="3"><strong>${esc(o.examType)}</strong>${o.partsDetail ? ` / ${esc(o.partsDetail)}` : ''}</td>
          </tr>
          <tr>
            <th>造影 / 至急 / ポータブル</th>
            <td>${esc(o.contrast || '単純')}${o.dynamicPhase ? `（${esc(o.dynamicPhase)}）` : ''} ／ ${o.isUrgent ? '至急' : '通常'} ／ ${o.isPortable ? `ポータブル(${esc(o.portableRoom || o.room || '病室')})` : '移動可'}</td>
            <th>移動区分 / 感染症</th>
            <td>${esc(o.mobility || '-')} ／ 感染症: ${esc(o.infection || '無')}</td>
          </tr>
          <tr>
            <th>依頼目的</th><td colspan="3">${esc(o.purpose || '-')}</td>
          </tr>
          <tr>
            <th>撮影条件 / 備考</th>
            <td colspan="3">${o.conditionKv || o.conditionMa || o.conditionSec ? `${esc(o.conditionKv || '-')}kV / ${esc(o.conditionMa || '-')}mA / ${esc(o.conditionSec || '-')}s ／ ` : ''}${esc(o.remarks || '-')}</td>
          </tr>
          <tr>
            <th>受付情報</th><td>${o.acceptedBy ? `${esc(o.acceptedBy)}（${esc(fmtFullDateTime(o.acceptedAt))}）` : '-'}</td>
            <th>実施情報</th><td>${o.completedBy ? `${esc(o.completedBy)}（${esc(fmtFullDateTime(o.completedAt))}）` : '-'}</td>
          </tr>
          ${o.technicianNotes ? `<tr><th>技師メモ</th><td colspan="3">${esc(o.technicianNotes)}</td></tr>` : ''}
        </table>
        ${renderHistoryTable(o.statusHistory)}`;
    }

    function renderMealDetail(m) {
      return `
        ${renderFlagsHtml('meal', m)}
        <table class="ord-detail-table">
          <tr>
            <th>オーダー番号</th><td><code>${esc(m.orderNumber)}</code></td>
            <th>開始日・開始食</th><td><strong>${esc(m.startDate)} ${esc(m.startMeal)}〜</strong></td>
          </tr>
          <tr>
            <th>対象患者</th><td><strong>[${esc(m.patientId)}] ${esc(m.patientName)}</strong>（${esc(m.gender || '-')} / ${m.age != null ? esc(m.age) + '歳' : '-'}）</td>
            <th>区分・病室</th><td>${esc(m.ward || '-')} ${esc(m.room || '')}</td>
          </tr>
          <tr>
            <th>指示者</th><td><strong>${esc(m.doctorName || '-')}</strong></td>
            <th>発行日時</th><td>${esc(fmtFullDateTime(m.createdAt))}</td>
          </tr>
          <tr>
            <th>食種</th><td colspan="3"><strong>${esc(m.dietType)}</strong></td>
          </tr>
          <tr>
            <th>主食 / 量</th><td>${esc(m.stapleType)} ／ ${esc(m.stapleAmount)}</td>
            <th>副食形態 / とろみ</th><td>${esc(m.sideTexture)} ／ とろみ: ${esc(m.thickener || 'なし')}</td>
          </tr>
          <tr>
            <th>エネルギー / 塩分</th><td>${esc(m.calories || '標準')} ／ ${esc(m.saltLimit || '制限なし')}</td>
            <th>蛋白 / 水分制限</th><td>${esc(m.proteinLimit || '-')} ／ ${esc(m.waterLimit || '-')}</td>
          </tr>
          <tr>
            <th>補助食品・濃厚流動</th><td colspan="3">${esc(m.supplement || '-')}</td>
          </tr>
          <tr>
            <th>禁止食品・アレルギー</th><td colspan="3"><strong>${esc(m.prohibitedFoods || '特になし')}</strong></td>
          </tr>
          <tr>
            <th>食事介助・食器</th><td colspan="3">${m.eatingAid && m.eatingAid.length ? esc(m.eatingAid.join(' ／ ')) : '-'}</td>
          </tr>
          <tr>
            <th>備考・連絡事項</th><td colspan="3">${esc(m.remarks || '-')}</td>
          </tr>
        </table>
        ${renderHistoryTable(m.statusHistory)}`;
    }

    function renderRehabDetail(r) {
      return `
        ${renderFlagsHtml('rehab', r)}
        <table class="ord-detail-table">
          <tr>
            <th>指示番号</th><td><code>${esc(r.orderNumber)}</code></td>
            <th>疾患別区分</th><td><strong>${esc(r.rehabCategory)}</strong></td>
          </tr>
          <tr>
            <th>対象患者</th><td><strong>[${esc(r.patientId)}] ${esc(r.patientName)}</strong>（${esc(r.gender || '-')} / ${r.age != null ? esc(r.age) + '歳' : '-'}）</td>
            <th>区分・病室</th><td>${esc(r.ward || '-')} ${esc(r.room || '')}</td>
          </tr>
          <tr>
            <th>指示医師</th><td><strong>${esc(r.doctorName || '-')}</strong></td>
            <th>発行日時 / 指示日</th><td>${esc(fmtFullDateTime(r.createdAt))} ／ 指示: ${esc(r.orderDate || '-')}（発症: ${esc(r.onsetDate || '-')}）</td>
          </tr>
          <tr>
            <th>診断名・算定病名</th><td colspan="3"><strong>${esc(r.diagnosisName)}</strong></td>
          </tr>
          <tr>
            <th>頻度・単位</th><td>${esc(r.frequencyPerWeek)} ／ ${esc(r.unitsPerDay)}</td>
            <th>期間・実施場所</th><td>${esc(r.durationMonths)} ／ ${esc(r.location)}</td>
          </tr>
          <tr>
            <th>急変・安全リスク</th><td colspan="3">${r.risks && r.risks.length ? esc(r.risks.join(' ／ ')) : '特記なし'}</td>
          </tr>
          <tr>
            <th>酸素投与量</th><td>${esc(r.oxygenFlow || '-')}</td>
            <th>禁忌・中止基準</th><td>${esc(r.contraindications || '-')}</td>
          </tr>
          <tr>
            <th>リハ必要性・目標</th><td colspan="3">${esc(r.necessityReason || '-')}</td>
          </tr>
          <tr>
            <th>理学療法（PT）</th><td colspan="3">${r.ptItems && r.ptItems.length ? esc(r.ptItems.join(' ／ ')) : '-'}</td>
          </tr>
          <tr>
            <th>作業療法（OT）</th><td colspan="3">${r.otItems && r.otItems.length ? esc(r.otItems.join(' ／ ')) : '-'}</td>
          </tr>
          <tr>
            <th>言語聴覚療法（ST）</th><td colspan="3">${r.stItems && r.stItems.length ? esc(r.stItems.join(' ／ ')) : '-'}</td>
          </tr>
          <tr>
            <th>評価・物理療法</th><td colspan="3">${r.evalItems && r.evalItems.length ? esc(r.evalItems.join(' ／ ')) : '-'}</td>
          </tr>
          <tr>
            <th>特記事項・備考</th><td colspan="3">${esc(r.remarks || '-')}</td>
          </tr>
        </table>
        ${renderHistoryTable(r.statusHistory)}`;
    }

    async function openDetail(type, orderNumber) {
      if (!type || !orderNumber) return;
      ensureModal();
      titleEl.textContent = `オーダー詳細 (${orderNumber})`;
      bodyEl.innerHTML = '<div style="padding:12px;color:#64748b;">読み込み中...</div>';
      printLinkEl.hidden = true;
      backdrop.hidden = false;

      try {
        let apiUrl = '';
        let printUrl = '';
        if (type === 'rx') {
          apiUrl = `/api/prescriptions/${encodeURIComponent(orderNumber)}`;
          printUrl = `/prescriptions/print/${encodeURIComponent(orderNumber)}`;
        } else if (type === 'inj') {
          apiUrl = `/api/injections/${encodeURIComponent(orderNumber)}`;
          printUrl = `/injections/print/${encodeURIComponent(orderNumber)}`;
        } else if (type === 'rad') {
          apiUrl = `/api/radiology-orders/${encodeURIComponent(orderNumber)}`;
          printUrl = `/radiology/print/${encodeURIComponent(orderNumber)}`;
        } else if (type === 'meal') {
          apiUrl = `/api/meals/${encodeURIComponent(orderNumber)}`;
          printUrl = `/meals/print/${encodeURIComponent(orderNumber)}`;
        } else if (type === 'rehab') {
          apiUrl = `/api/rehab/${encodeURIComponent(orderNumber)}`;
          printUrl = `/rehab/print/${encodeURIComponent(orderNumber)}`;
        } else {
          return;
        }

        const res = await fetch(apiUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || '詳細の取得に失敗しました。');
        }

        if (type === 'rx') {
          titleEl.textContent = `${data.prescription.prescriptionType}箋 詳細 (${data.prescription.orderNumber})`;
          bodyEl.innerHTML = renderPrescriptionDetail(data.prescription);
        } else if (type === 'inj') {
          titleEl.textContent = `${data.injection.injectionType}箋 詳細 (${data.injection.orderNumber})`;
          bodyEl.innerHTML = renderInjectionDetail(data.injection);
        } else if (type === 'meal') {
          titleEl.textContent = `食事オーダー 詳細 (${data.meal.orderNumber})`;
          bodyEl.innerHTML = renderMealDetail(data.meal);
        } else if (type === 'rehab') {
          titleEl.textContent = `リハビリ指示 詳細 (${data.rehab.orderNumber})`;
          bodyEl.innerHTML = renderRehabDetail(data.rehab);
        } else {
          titleEl.textContent = `放射線検査オーダー 詳細 (${data.order.orderNumber})`;
          bodyEl.innerHTML = renderRadiologyDetail(data.order);
        }

        printLinkEl.href = printUrl;
        printLinkEl.hidden = false;
      } catch (err) {
        bodyEl.innerHTML = `<div class="ord-detail-alert ord-detail-alert--cancel">${esc(err.message || '詳細の取得に失敗しました。')}</div>`;
      }
    }

    document.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select, textarea, label')) return;
      const card = event.target.closest('[data-detail-type][data-detail-order]');
      if (!card) return;
      openDetail(card.getAttribute('data-detail-type'), card.getAttribute('data-detail-order'));
    });

    window.OrderDetailModal = { open: openDetail };
  })();
})();
