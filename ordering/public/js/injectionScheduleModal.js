'use strict';

/**
 * 入院注射箋 日付別 継続・削除編集モーダル
 * - draft モード: 発行前の入力中データ (itemsState) の日付別継続/削除を編集して反映
 * - order モード: 発行済み入院注射箋を取得し、日付別継続/削除を編集して
 *   追記保存（元記録へ訂正済フラグを立て新記録追記、全削除時は中止フラグ設定）
 */
(function initInjectionScheduleModal() {
  const backdrop = document.getElementById('injScheduleModal');
  if (!backdrop) return;

  const metaEl = document.getElementById('injScheduleMeta');
  const startDateInput = document.getElementById('injSchedStartDate');
  const theadEl = document.getElementById('injSchedHead');
  const tbodyEl = document.getElementById('injSchedBody');
  const revWrap = document.getElementById('injSchedRevWrap');
  const revNoteInput = document.getElementById('injSchedRevNote');
  const appendNoteEl = document.getElementById('injSchedAppendNote');
  const statusEl = document.getElementById('injSchedStatus');
  const btnSave = document.getElementById('btnSaveInjScheduleModal');

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  let modalMode = 'draft'; // 'draft' | 'order'
  let activeOrder = null;
  let dates = [];
  let rows = [];
  let onApplyCallback = null;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDaysIso(iso, offset) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    const dt = m
      ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
      : new Date();
    dt.setUTCDate(dt.getUTCDate() + offset);
    return dt.toISOString().slice(0, 10);
  }

  function formatDateHeader(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return { text: iso, wd: -1 };
    const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const wd = dt.getUTCDay();
    return {
      text: `${Number(m[2])}/${Number(m[3])}(${WEEKDAYS[wd]})`,
      wd
    };
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = `inj-modal__status ${isError ? 'is-err' : 'is-ok'}`;
  }

  function buildInitialDates(startDate, items) {
    const allDates = new Set();
    let maxDays = 0;
    for (const it of items) {
      if (Array.isArray(it.dailySchedule) && it.dailySchedule.length > 0) {
        for (const d of it.dailySchedule) {
          if (d && d.date) allDates.add(d.date);
        }
      }
      maxDays = Math.max(maxDays, Number(it.days) || 1);
    }

    const baseStart = startDate || (allDates.size > 0 ? Array.from(allDates).sort()[0] : todayIso());
    const span = Math.max(maxDays, 5);
    for (let i = 0; i < span; i += 1) {
      allDates.add(addDaysIso(baseStart, i));
    }

    return Array.from(allDates).sort();
  }

  function buildRows(items, dateList, startDate) {
    return items.map((it) => {
      const statusByDate = {};
      if (Array.isArray(it.dailySchedule) && it.dailySchedule.length > 0) {
        const existingMap = Object.fromEntries(it.dailySchedule.map((d) => [d.date, d.status]));
        for (const d of dateList) {
          statusByDate[d] = existingMap[d] === 'CONTINUE' ? 'CONTINUE' : 'DELETE';
        }
      } else {
        const count = Math.max(1, Number(it.days) || 1);
        const activeDates = new Set();
        for (let i = 0; i < count; i += 1) {
          activeDates.add(addDaysIso(startDate, i));
        }
        for (const d of dateList) {
          statusByDate[d] = activeDates.has(d) ? 'CONTINUE' : 'DELETE';
        }
      }
      return {
        item: { ...it },
        statusByDate
      };
    });
  }

  function renderMatrix() {
    if (!theadEl || !tbodyEl) return;

    const dateHeadersHtml = dates
      .map((d) => {
        const fmt = formatDateHeader(d);
        const cls = fmt.wd === 0 ? 'is-sun' : fmt.wd === 6 ? 'is-sat' : '';
        return `
          <th class="inj-sched-date-th">
            <button type="button" class="inj-sched-col-btn ${cls}" data-col-date="${esc(d)}" title="クリックで ${esc(d)} の全薬剤を継続/削除切替">
              ${esc(fmt.text)}
            </button>
          </th>`;
      })
      .join('');

    theadEl.innerHTML = `
      <tr>
        <th>Rp</th>
        <th>注射薬剤・経路・時間</th>
        <th>行一括</th>
        ${dateHeadersHtml}
      </tr>`;

    tbodyEl.innerHTML = rows
      .map((row, rIdx) => {
        const it = row.item;
        const contCount = dates.filter((d) => row.statusByDate[d] === 'CONTINUE').length;
        const cellsHtml = dates
          .map((d) => {
            const isCont = row.statusByDate[d] === 'CONTINUE';
            return `
              <td class="inj-sched-cell">
                <button
                  type="button"
                  class="inj-cell-toggle ${isCont ? 'is-continue' : 'is-delete'}"
                  data-row-idx="${rIdx}"
                  data-date="${esc(d)}"
                >${isCont ? '● 継続' : '× 削除'}</button>
              </td>`;
          })
          .join('');

        return `
          <tr>
            <td style="text-align:center;font-weight:700;">Rp${esc(it.rpNo || 1)}</td>
            <td class="inj-sched-drug-cell">
              <div><strong>${esc(it.drugName)}</strong> ${esc(it.dose || '')}</div>
              <div class="inj-sched-drug-sub">${esc(it.route || '')}${it.timing ? ' / ' + esc(it.timing) : ''}${it.rate ? ' / ' + esc(it.rate) : ''}（継続 ${contCount}日）</div>
            </td>
            <td class="inj-sched-row-ops">
              <button type="button" class="inj-m-btn inj-m-btn--ok js-row-all-cont" data-row-idx="${rIdx}">全継続</button>
              <button type="button" class="inj-m-btn inj-m-btn--danger js-row-all-del" data-row-idx="${rIdx}">全削除</button>
            </td>
            ${cellsHtml}
          </tr>`;
      })
      .join('');
  }

  function closeModal() {
    backdrop.hidden = true;
    setStatus('', false);
  }

  function openForDraft({ startDate, items, patientLabel, onApply }) {
    const valid = (items || []).filter((it) => it && String(it.drugName || '').trim());
    if (valid.length === 0) {
      window.alert('先に注射薬剤を1件以上入力してください。');
      return;
    }

    modalMode = 'draft';
    activeOrder = null;
    onApplyCallback = onApply || null;

    const baseStart = startDate || todayIso();
    dates = buildInitialDates(baseStart, valid);
    rows = buildRows(valid, dates, baseStart);

    if (startDateInput) startDateInput.value = dates[0] || baseStart;
    if (metaEl) metaEl.textContent = patientLabel ? `${patientLabel}（新規入力中）` : '新規入力中';
    if (revWrap) revWrap.hidden = true;
    if (appendNoteEl) appendNoteEl.hidden = true;
    if (btnSave) btnSave.textContent = '入力欄へ反映';
    setStatus('', false);
    renderMatrix();
    backdrop.hidden = false;
  }

  async function openForOrder(orderNumber, onSaved) {
    try {
      const res = await fetch(`/api/injections/${encodeURIComponent(orderNumber)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.injection) {
        window.alert(data.error || '対象注射箋の読み込みに失敗しました。');
        return;
      }

      const inj = data.injection;
      modalMode = 'order';
      activeOrder = inj;
      onApplyCallback = onSaved || null;

      const baseStart = inj.startDate || todayIso();
      dates = buildInitialDates(baseStart, inj.items || []);
      rows = buildRows(inj.items || [], dates, baseStart);

      if (startDateInput) startDateInput.value = dates[0] || baseStart;
      if (metaEl) {
        metaEl.textContent = `${inj.orderNumber} / [${inj.patientId}] ${inj.patientName}（${inj.ward}${inj.room ? ' ' + inj.room : ''}）`;
      }
      if (revWrap) revWrap.hidden = false;
      if (revNoteInput) revNoteInput.value = '日付別 継続・削除編集';
      if (appendNoteEl) appendNoteEl.hidden = false;
      if (btnSave) btnSave.textContent = '保存（訂正追記）';
      setStatus('', false);
      renderMatrix();
      backdrop.hidden = false;
    } catch (err) {
      window.alert(err.message || '対象注射箋の読み込みに失敗しました。');
    }
  }

  function extendDays(count) {
    const last = dates.length > 0 ? dates[dates.length - 1] : todayIso();
    for (let i = 1; i <= count; i += 1) {
      const nextDate = addDaysIso(last, i);
      if (!dates.includes(nextDate)) {
        dates.push(nextDate);
        for (const row of rows) {
          // 直前の日が継続中ならそのまま継続、削除なら削除を引き継ぐ
          const prevStatus = row.statusByDate[last] || 'CONTINUE';
          row.statusByDate[nextDate] = prevStatus;
        }
      }
    }
    dates.sort();
    renderMatrix();
  }

  document.getElementById('btnInjSchedAddDay')?.addEventListener('click', () => extendDays(1));
  document.getElementById('btnInjSchedAdd3Days')?.addEventListener('click', () => extendDays(3));

  document.getElementById('btnInjSchedAllContinue')?.addEventListener('click', () => {
    for (const row of rows) {
      for (const d of dates) row.statusByDate[d] = 'CONTINUE';
    }
    renderMatrix();
  });

  document.getElementById('btnInjSchedAllDelete')?.addEventListener('click', () => {
    for (const row of rows) {
      for (const d of dates) row.statusByDate[d] = 'DELETE';
    }
    renderMatrix();
  });

  startDateInput?.addEventListener('change', () => {
    const nextStart = startDateInput.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextStart)) return;
    const len = Math.max(dates.length, 5);
    const nextDates = [];
    for (let i = 0; i < len; i += 1) {
      nextDates.push(addDaysIso(nextStart, i));
    }
    rows.forEach((row) => {
      const nextMap = {};
      nextDates.forEach((d, idx) => {
        const oldDate = dates[idx];
        nextMap[d] = row.statusByDate[d] || (oldDate ? row.statusByDate[oldDate] : 'CONTINUE') || 'CONTINUE';
      });
      row.statusByDate = nextMap;
    });
    dates = nextDates;
    renderMatrix();
  });

  theadEl?.addEventListener('click', (event) => {
    const colBtn = event.target.closest('.inj-sched-col-btn');
    if (!colBtn) return;
    const date = colBtn.getAttribute('data-col-date');
    if (!date) return;
    const allContinue = rows.every((r) => r.statusByDate[date] === 'CONTINUE');
    const nextStatus = allContinue ? 'DELETE' : 'CONTINUE';
    for (const row of rows) {
      row.statusByDate[date] = nextStatus;
    }
    renderMatrix();
  });

  tbodyEl?.addEventListener('click', (event) => {
    const cellBtn = event.target.closest('.inj-cell-toggle');
    if (cellBtn) {
      const rIdx = Number(cellBtn.dataset.rowIdx);
      const date = cellBtn.dataset.date;
      if (rows[rIdx] && date) {
        rows[rIdx].statusByDate[date] = rows[rIdx].statusByDate[date] === 'CONTINUE' ? 'DELETE' : 'CONTINUE';
        renderMatrix();
      }
      return;
    }

    const rowCont = event.target.closest('.js-row-all-cont');
    if (rowCont) {
      const rIdx = Number(rowCont.dataset.rowIdx);
      if (rows[rIdx]) {
        for (const d of dates) rows[rIdx].statusByDate[d] = 'CONTINUE';
        renderMatrix();
      }
      return;
    }

    const rowDel = event.target.closest('.js-row-all-del');
    if (rowDel) {
      const rIdx = Number(rowDel.dataset.rowIdx);
      if (rows[rIdx]) {
        for (const d of dates) rows[rIdx].statusByDate[d] = 'DELETE';
        renderMatrix();
      }
    }
  });

  btnSave?.addEventListener('click', async () => {
    const updatedItems = rows.map((row) => {
      const dailySchedule = dates.map((d) => ({
        date: d,
        status: row.statusByDate[d] === 'DELETE' ? 'DELETE' : 'CONTINUE',
        note: ''
      }));
      const contCount = dailySchedule.filter((d) => d.status === 'CONTINUE').length;
      return {
        ...row.item,
        days: contCount,
        dailySchedule
      };
    });

    const totalContinue = updatedItems.reduce(
      (sum, it) => sum + it.dailySchedule.filter((d) => d.status === 'CONTINUE').length,
      0
    );

    if (modalMode === 'draft') {
      if (typeof onApplyCallback === 'function') {
        onApplyCallback({
          startDate: dates[0] || todayIso(),
          items: updatedItems
        });
      }
      closeModal();
      return;
    }

    if (!activeOrder) return;
    btnSave.disabled = true;
    setStatus('保存中...', false);

    try {
      const reason = revNoteInput ? revNoteInput.value.trim() : '日付別 継続・削除編集';
      if (totalContinue === 0) {
        // 全日程・全薬剤が削除された場合は元記録へ中止フラグを設定（物理削除禁止）
        const res = await fetch(`/api/injections/${encodeURIComponent(activeOrder.orderNumber)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ reason: reason || '全日程削除により注射中止' })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || '中止処理に失敗しました。');
        }
        closeModal();
        if (typeof onApplyCallback === 'function') onApplyCallback(data.injection);
        return;
      }

      const payload = {
        injectionType: activeOrder.injectionType || '入院注射',
        parentOrderNumber: activeOrder.orderNumber,
        revisionNote: reason || '日付別 継続・削除編集',
        startDate: dates[0] || activeOrder.startDate,
        patientId: activeOrder.patientId,
        patientName: activeOrder.patientName,
        patientKana: activeOrder.patientKana || '',
        age: activeOrder.age != null ? activeOrder.age : '',
        gender: activeOrder.gender || '不明',
        birthDate: activeOrder.birthDate || '',
        ward: activeOrder.ward === '病棟' ? '医療病棟' : (activeOrder.ward || '医療病棟'),
        room: activeOrder.room || '',
        sourceDepartment: activeOrder.sourceDepartment || '',
        items: updatedItems,
        remarks: activeOrder.remarks || ''
      };

      const res = await fetch('/api/injections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || '保存に失敗しました。');
      }
      closeModal();
      if (typeof onApplyCallback === 'function') onApplyCallback(data.injection);
    } catch (err) {
      setStatus(err.message || '保存に失敗しました。', true);
    } finally {
      btnSave.disabled = false;
    }
  });

  document.getElementById('btnCloseInjScheduleModal')?.addEventListener('click', closeModal);
  document.getElementById('btnCancelInjScheduleModal')?.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdrop.hidden) closeModal();
  });

  window.InjectionScheduleModal = {
    openForDraft,
    openForOrder,
    close: closeModal
  };
})();
