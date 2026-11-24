'use strict';

(function initInjectionOrder() {
  const isEmbed = document.body.dataset.embed === '1';
  const isInpatient = document.body.dataset.injKind === 'inpatient';
  const initialRevise = document.body.dataset.revise || '';
  const injPath = document.body.dataset.injPath || '/injections/inpatient';
  const injTitle = document.body.dataset.injTitle || '入院注射箋';
  const defaultDays = Math.max(1, Number(document.body.dataset.defaultDays) || 1);
  const defaultDayUnit = document.body.dataset.defaultDayUnit || '日間';
  const defaultTimings = isInpatient
    ? []
    : (document.body.dataset.defaultTimings || '').split(',').filter(Boolean);
  const timingOptions = isInpatient
    ? []
    : (document.body.dataset.timingOptions || '').split(',').filter(Boolean);

  const patientPicker = document.getElementById('injPatientPicker');
  const statusEl = document.getElementById('injStatusMsg');
  const itemsBody = document.getElementById('injItemsBody');

  const fInjType = document.getElementById('injType');
  const fParent = document.getElementById('injParentOrderNumber');
  const fRevBanner = document.getElementById('injRevisionBanner');
  const fRevParentLabel = document.getElementById('injRevisionParent');
  const fRevNote = document.getElementById('injRevisionNote');
  const fPatientId = document.getElementById('injPatientId');
  const fPatientName = document.getElementById('injPatientName');
  const fPatientKana = document.getElementById('injPatientKana');
  const fAge = document.getElementById('injAge');
  const fGender = document.getElementById('injGender');
  const fBirthDate = document.getElementById('injBirthDate');
  const fSourceDept = document.getElementById('injSourceDept');
  const fStartDate = document.getElementById('injStartDate');
  const fWard = document.getElementById('injWard');
  const fRoom = document.getElementById('injRoom');
  const fDoctorName = document.getElementById('injDoctorName');
  const fRemarks = document.getElementById('injRemarks');

  const medSearchInput = document.getElementById('injMedSearch');
  const medCatFilter = document.getElementById('injMedCatFilter');
  const majorFilterTag = document.getElementById('injMajorFilterTag');
  const suggestWrap = document.getElementById('injMedSuggestWrap');
  const suggestBody = document.getElementById('injMedSuggestBody');

  const DOSE_UNITS = ['本', '管', '袋', 'V', 'A', 'mL', 'g', 'mg', 'キット', 'シリンジ'];
  const ROUTE_OPTIONS = [
    '点滴静注(DIV)',
    '静脈注射(IV)',
    '側管注',
    '皮下注射(SC)',
    '筋肉注射(IM)',
    '中心静脈(CV)',
    '関節腔内注射'
  ];

  let selectedMajor = '';
  let itemsState = [createBlankItem(1)];
  let searchTimer = null;
  let lastSuggestions = [];

  function createBlankItem(rpNo) {
    return {
      rpNo: rpNo || 1,
      drugId: '',
      drugName: '',
      genericName: '',
      spec: '',
      unit: '本',
      category: '注射剤',
      doseNum: '1',
      doseUnit: '本',
      dose: '1本',
      route: '点滴静注(DIV)',
      timingSet: [...defaultTimings],
      timing: defaultTimings.join('・'),
      rate: '1時間かけて',
      days: defaultDays,
      dayUnit: defaultDayUnit,
      note: '',
      dailySchedule: []
    };
  }

  function composeDose(it) {
    const num = String(it.doseNum || '').trim();
    const unit = String(it.doseUnit || '').trim();
    return num ? `${num}${unit}` : '';
  }

  function composeTiming(it) {
    if (isInpatient || timingOptions.length === 0) return '';
    const ordered = timingOptions.filter((t) => (it.timingSet || []).includes(t));
    return ordered.join('・');
  }

  function parseDose(str, fallbackUnit) {
    const s = String(str || '').trim();
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (m) {
      const u = m[2].trim() || fallbackUnit || '本';
      return { doseNum: m[1], doseUnit: DOSE_UNITS.includes(u) ? u : '本' };
    }
    return { doseNum: s || '1', doseUnit: DOSE_UNITS.includes(fallbackUnit) ? fallbackUnit : '本' };
  }

  function parseTiming(str) {
    const s = String(str || '').trim();
    if (!s) return [...defaultTimings];
    const matched = timingOptions.filter((opt) => s.includes(opt));
    return matched.length > 0 ? matched : [];
  }

  function inferRouteAndRate(medName) {
    const name = String(medName || '');
    if (/皮下注/.test(name)) return { route: '皮下注射(SC)', rate: '皮下注射' };
    if (/筋注/.test(name)) return { route: '筋肉注射(IM)', rate: '筋肉注射' };
    if (/点滴|輸液|バック|バッグ|キット/.test(name)) return { route: '点滴静注(DIV)', rate: '1時間かけて' };
    if (/静注/.test(name)) return { route: '静脈注射(IV)', rate: '緩徐に静注' };
    return { route: '点滴静注(DIV)', rate: '1時間かけて' };
  }

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

  async function apiFetch(url, options) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `エラー (${res.status})`);
    }
    return data;
  }

  function setTodayIfEmpty() {
    if (fStartDate && !fStartDate.value) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      fStartDate.value = `${y}-${m}-${d}`;
    }
  }

  function applyVisibilityCheckboxes() {
    document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
      const key = cb.getAttribute('data-col-toggle');
      document.querySelectorAll(`[data-col="${key}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    });

    document.querySelectorAll('[data-hist-toggle]').forEach((cb) => {
      const key = cb.getAttribute('data-hist-toggle');
      document.querySelectorAll(`[data-hist-item="${key}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    });

    const chkFlag = document.getElementById('chkInjShowFlagged');
    if (chkFlag) {
      document.querySelectorAll('.hist-card[data-flagged="true"]').forEach((el) => {
        el.classList.toggle('is-hidden', !chkFlag.checked);
      });
    }
  }

  function renderItemsTable() {
    if (!itemsBody) return;
    if (itemsState.length === 0) itemsState.push(createBlankItem(1));

    itemsBody.innerHTML = itemsState
      .map((it, idx) => {
        const unitOptionsHtml = DOSE_UNITS.map(
          (u) => `<option value="${u}" ${it.doseUnit === u ? 'selected' : ''}>${u}</option>`
        ).join('');

        const routeOptionsHtml = ROUTE_OPTIONS.map(
          (r) => `<option value="${r}" ${it.route === r ? 'selected' : ''}>${r}</option>`
        ).join('');

        const timingSet = Array.isArray(it.timingSet) ? it.timingSet : [];
        const timingChecksHtml = timingOptions
          .map(
            (t) => `
              <label class="timing-opt">
                <input
                  type="checkbox"
                  class="js-inj-timing-chk"
                  data-idx="${idx}"
                  value="${t}"
                  ${timingSet.includes(t) ? 'checked' : ''}
                ><span>${t}</span>
              </label>`
          )
          .join('');

        const schedChipsHtml =
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

        return `
          <tr data-row-idx="${idx}">
            <td data-col="rp">
              <input
                type="number"
                min="1"
                max="20"
                class="s-input js-inj-rp"
                data-idx="${idx}"
                value="${esc(it.rpNo)}"
                style="text-align:center;"
              >
            </td>
            <td>
              <input
                type="text"
                class="s-input s-bold js-inj-name"
                data-idx="${idx}"
                value="${esc(it.drugName)}"
                placeholder="注射薬剤名"
              >
              ${schedChipsHtml}
            </td>
            <td data-col="dose">
              <div class="dose-cell">
                <input
                  type="text"
                  class="s-input js-inj-dose-num"
                  data-idx="${idx}"
                  value="${esc(it.doseNum)}"
                  placeholder="量"
                >
                <select class="s-select js-inj-dose-unit" data-idx="${idx}" aria-label="投与量単位">
                  ${unitOptionsHtml}
                </select>
              </div>
            </td>
            <td data-col="route">
              <select class="s-select js-inj-route" data-idx="${idx}" aria-label="投与経路">
                ${routeOptionsHtml}
              </select>
            </td>
            ${
              isInpatient
                ? ''
                : `<td data-col="timing">
                    <div class="timing-checks">${timingChecksHtml}</div>
                  </td>`
            }
            <td data-col="rate">
              <input
                type="text"
                class="s-input js-inj-rate"
                data-idx="${idx}"
                value="${esc(it.rate)}"
                list="injRatePresetList"
                placeholder="例: 1時間かけて"
              >
            </td>
            <td data-col="days">
              <div class="days-cell">
                <input
                  type="number"
                  min="1"
                  max="60"
                  class="s-input js-inj-days"
                  data-idx="${idx}"
                  value="${esc(it.days)}"
                >
                <select class="s-select js-inj-day-unit" data-idx="${idx}">
                  ${['日間', '回']
                    .map((u) => `<option value="${u}" ${it.dayUnit === u ? 'selected' : ''}>${u}</option>`)
                    .join('')}
                </select>
              </div>
            </td>
            <td data-col="note">
              <input
                type="text"
                class="s-input js-inj-note"
                data-idx="${idx}"
                value="${esc(it.note)}"
                placeholder="混注・側管・遮光等"
              >
            </td>
            <td class="row-ops-cell">
              <button type="button" class="btn-mini btn-mini--copy js-copy-row" data-idx="${idx}" title="この行を複写（複数回実施用）">複写</button>
              <button type="button" class="btn-mini btn-mini--warn js-del-row" data-idx="${idx}" title="行削除">×</button>
            </td>
          </tr>`;
      })
      .join('');

    applyVisibilityCheckboxes();
  }

  function addMedicineRow(med) {
    const inferred = inferRouteAndRate(med.name);
    const unit = DOSE_UNITS.includes(med.unit) ? med.unit : '管';
    const currentRp = itemsState.length > 0 ? itemsState[itemsState.length - 1].rpNo || 1 : 1;

    const newItem = {
      rpNo: currentRp,
      drugId: med.drugId || '',
      drugName: med.name || '',
      genericName: med.genericName || '',
      spec: med.spec || '',
      unit,
      category: med.category || '注射剤',
      doseNum: '1',
      doseUnit: unit,
      dose: `1${unit}`,
      route: inferred.route,
      timingSet: [...defaultTimings],
      timing: defaultTimings.join('・'),
      rate: inferred.rate,
      days: defaultDays,
      dayUnit: defaultDayUnit,
      note: '',
      dailySchedule: []
    };

    if (itemsState.length === 1 && !itemsState[0].drugName.trim()) {
      itemsState[0] = newItem;
    } else {
      itemsState.push(newItem);
    }

    renderItemsTable();
    showStatus(`「${med.name}」を追加（${newItem.dose} / ${newItem.route}）`, false);
  }

  async function searchMedicines() {
    const q = medSearchInput ? medSearchInput.value.trim() : '';
    const cat = medCatFilter ? medCatFilter.value : '';
    if (!q && !selectedMajor) {
      suggestWrap.hidden = true;
      suggestBody.innerHTML = '';
      lastSuggestions = [];
      return;
    }

    try {
      const params = new URLSearchParams({
        q,
        category: cat,
        majorCategory: selectedMajor,
        adoptType: 'ACTIVE'
      });
      const data = await apiFetch(`/api/medicines?${params.toString()}`);
      lastSuggestions = (data.medicines || []).slice(0, 30);

      if (lastSuggestions.length === 0) {
        suggestBody.innerHTML = '<tr><td colspan="3" class="empty-msg">該当注射薬剤なし</td></tr>';
      } else {
        suggestBody.innerHTML = lastSuggestions
          .map(
            (m, i) => `
            <tr class="suggest-row" data-sug-idx="${i}">
              <td><strong>${esc(m.name)}</strong></td>
              <td style="color:#64748b;">${esc(m.genericName || '')}</td>
              <td style="white-space:nowrap;">${esc(m.unit || '管')} / ${esc(m.majorCategory || '')}</td>
            </tr>`
          )
          .join('');
      }
      suggestWrap.hidden = false;
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  if (medSearchInput) {
    medSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(searchMedicines, 150);
    });
    medSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (lastSuggestions.length > 0) {
          addMedicineRow(lastSuggestions[0]);
          medSearchInput.value = '';
          if (!selectedMajor) suggestWrap.hidden = true;
        }
      }
    });
  }

  if (medCatFilter) {
    medCatFilter.addEventListener('change', searchMedicines);
  }

  if (suggestBody) {
    suggestBody.addEventListener('click', (event) => {
      const row = event.target.closest('tr.suggest-row');
      if (!row) return;
      const med = lastSuggestions[Number(row.dataset.sugIdx)];
      if (med) {
        addMedicineRow(med);
        medSearchInput.value = '';
        if (!selectedMajor) suggestWrap.hidden = true;
        medSearchInput.focus();
      }
    });
  }

  document.getElementById('injCategoryTree')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.tree-leaf');
    if (!btn) return;
    document.querySelectorAll('#injCategoryTree .tree-leaf').forEach((el) => el.classList.remove('is-selected'));
    btn.classList.add('is-selected');

    const cat = btn.getAttribute('data-tree-cat') || '';
    selectedMajor = btn.getAttribute('data-tree-major') || '';
    if (medCatFilter) medCatFilter.value = cat;

    if (majorFilterTag) {
      if (selectedMajor) {
        majorFilterTag.textContent = selectedMajor;
        majorFilterTag.hidden = false;
      } else {
        majorFilterTag.hidden = true;
      }
    }
    searchMedicines();
    if (medSearchInput) medSearchInput.focus();
  });

  itemsBody.addEventListener('input', (event) => {
    const t = event.target;
    const idx = Number(t.dataset.idx);
    if (Number.isNaN(idx) || !itemsState[idx]) return;

    if (t.classList.contains('js-inj-rp')) itemsState[idx].rpNo = Math.max(1, Number(t.value) || 1);
    else if (t.classList.contains('js-inj-name')) itemsState[idx].drugName = t.value;
    else if (t.classList.contains('js-inj-dose-num')) {
      itemsState[idx].doseNum = t.value;
      itemsState[idx].dose = composeDose(itemsState[idx]);
    } else if (t.classList.contains('js-inj-rate')) itemsState[idx].rate = t.value;
    else if (t.classList.contains('js-inj-days')) itemsState[idx].days = Math.max(1, Number(t.value) || 1);
    else if (t.classList.contains('js-inj-note')) itemsState[idx].note = t.value;
  });

  itemsBody.addEventListener('change', (event) => {
    const t = event.target;
    const idx = Number(t.dataset.idx);
    if (Number.isNaN(idx) || !itemsState[idx]) return;

    if (t.classList.contains('js-inj-dose-unit')) {
      itemsState[idx].doseUnit = t.value;
      itemsState[idx].unit = t.value;
      itemsState[idx].dose = composeDose(itemsState[idx]);
    } else if (t.classList.contains('js-inj-route')) {
      itemsState[idx].route = t.value;
    } else if (t.classList.contains('js-inj-day-unit')) {
      itemsState[idx].dayUnit = t.value;
    } else if (t.classList.contains('js-inj-timing-chk')) {
      const set = new Set(itemsState[idx].timingSet || []);
      if (t.checked) set.add(t.value);
      else set.delete(t.value);
      itemsState[idx].timingSet = timingOptions.filter((opt) => set.has(opt));
      itemsState[idx].timing = composeTiming(itemsState[idx]);
    }
  });

  itemsBody.addEventListener('click', (event) => {
    const copyBtn = event.target.closest('.js-copy-row');
    if (copyBtn) {
      const idx = Number(copyBtn.dataset.idx);
      const src = itemsState[idx];
      if (!src) return;
      const maxRp = itemsState.reduce((acc, it) => Math.max(acc, Number(it.rpNo) || 1), 0);
      const cloned = {
        ...src,
        rpNo: maxRp + 1,
        timingSet: Array.isArray(src.timingSet) ? [...src.timingSet] : [],
        dailySchedule: Array.isArray(src.dailySchedule)
          ? src.dailySchedule.map((d) => ({ ...d }))
          : []
      };
      itemsState.splice(idx + 1, 0, cloned);
      renderItemsTable();
      showStatus(`「${cloned.drugName || '空行'}」を行複写しました（Rp${cloned.rpNo}）。`, false);
      return;
    }

    const delBtn = event.target.closest('.js-del-row');
    if (!delBtn) return;
    const idx = Number(delBtn.dataset.idx);
    itemsState.splice(idx, 1);
    if (itemsState.length === 0) itemsState.push(createBlankItem(1));
    renderItemsTable();
  });

  document.getElementById('btnInjAddRow')?.addEventListener('click', () => {
    const curRp = itemsState.length > 0 ? itemsState[itemsState.length - 1].rpNo || 1 : 1;
    itemsState.push(createBlankItem(curRp));
    renderItemsTable();
  });

  document.getElementById('btnInjAddRp')?.addEventListener('click', () => {
    const maxRp = itemsState.reduce((acc, it) => Math.max(acc, Number(it.rpNo) || 1), 0);
    itemsState.push(createBlankItem(maxRp + 1));
    renderItemsTable();
  });

  document.getElementById('btnInjScheduleModal')?.addEventListener('click', () => {
    if (!window.InjectionScheduleModal) return;
    const prepared = itemsState.map((it) => ({
      ...it,
      dose: composeDose(it),
      timing: composeTiming(it)
    }));
    const ptLabel = fPatientId.value.trim()
      ? `[${fPatientId.value.trim()}] ${fPatientName.value.trim()}`
      : '';
    window.InjectionScheduleModal.openForDraft({
      startDate: fStartDate ? fStartDate.value : '',
      items: prepared,
      patientLabel: ptLabel,
      onApply: ({ startDate, items }) => {
        if (fStartDate && startDate) fStartDate.value = startDate;
        itemsState = items.map((it) => {
          const parsedDose = parseDose(it.dose, it.unit);
          const timingSet = parseTiming(it.timing);
          return {
            ...createBlankItem(it.rpNo || 1),
            ...it,
            doseNum: parsedDose.doseNum,
            doseUnit: parsedDose.doseUnit,
            timingSet,
            timing: it.timing || timingSet.join('・'),
            days: Math.max(0, Number(it.days) || 0),
            dailySchedule: Array.isArray(it.dailySchedule) ? it.dailySchedule : []
          };
        });
        renderItemsTable();
        showStatus('日付別の継続・削除スケジュールを反映しました。', false);
      }
    });
  });

  function clearRevisionMode() {
    fParent.value = '';
    if (fRevNote) fRevNote.value = '';
    if (fRevBanner) fRevBanner.hidden = true;
  }

  document.getElementById('btnInjCancelRevision')?.addEventListener('click', clearRevisionMode);

  if (patientPicker) {
    patientPicker.addEventListener('change', () => {
      const pid = patientPicker.value;
      window.location.href = pid
        ? `${injPath}?patientId=${encodeURIComponent(pid)}`
        : `${injPath}?patientId=`;
    });
  }

  async function loadInjectionForRevision(orderNumber) {
    try {
      const { injection } = await apiFetch(`/api/injections/${encodeURIComponent(orderNumber)}`);
      fParent.value = injection.orderNumber;
      if (fInjType && injection.injectionType) {
        fInjType.value = injection.injectionType;
      }
      fRevParentLabel.textContent = injection.orderNumber;
      fRevBanner.hidden = false;

      fPatientId.value = injection.patientId || '';
      fPatientName.value = injection.patientName || '';
      fPatientKana.value = injection.patientKana || '';
      fAge.value = injection.age != null ? String(injection.age) : '';
      fGender.value = injection.gender || '不明';
      fBirthDate.value = injection.birthDate || '';
      fStartDate.value = injection.startDate || '';
      fWard.value = injection.ward === '病棟' ? '医療病棟' : (injection.ward || '医療病棟');
      fRoom.value = injection.room || '';
      fRemarks.value = injection.remarks || '';

      itemsState =
        Array.isArray(injection.items) && injection.items.length > 0
          ? injection.items.map((it) => {
              const parsedDose = parseDose(it.dose, it.unit);
              const timingSet = parseTiming(it.timing);
              return {
                ...createBlankItem(it.rpNo || 1),
                ...it,
                doseNum: parsedDose.doseNum,
                doseUnit: parsedDose.doseUnit,
                timingSet,
                timing: it.timing || timingSet.join('・')
              };
            })
          : [createBlankItem(1)];
      renderItemsTable();
      showStatus(`注射箋 ${injection.orderNumber} を訂正再発行用に読み込みました。`, false);
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  document.getElementById('pastInjList')?.addEventListener('click', async (event) => {
    const schedBtn = event.target.closest('.js-inj-schedule');
    if (schedBtn && window.InjectionScheduleModal) {
      window.InjectionScheduleModal.openForOrder(schedBtn.dataset.order, () => {
        window.location.reload();
      });
      return;
    }

    const revBtn = event.target.closest('.js-inj-revise');
    if (revBtn) {
      await loadInjectionForRevision(revBtn.dataset.order);
      return;
    }

    const cancelBtn = event.target.closest('.js-inj-cancel');
    if (cancelBtn) {
      const orderNum = cancelBtn.dataset.order;
      const reason = window.prompt(`注射箋 ${orderNum} に中止フラグを設定します。理由を入力してください:`, '医師指示により中止');
      if (reason === null) return;
      try {
        await apiFetch(`/api/injections/${encodeURIComponent(orderNum)}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });
        window.location.reload();
      } catch (err) {
        showStatus(err.message, true);
      }
    }
  });

  async function submitInjection(openPrint) {
    const validItems = itemsState
      .filter((it) => it.drugName.trim())
      .map((it) => ({
        ...it,
        dose: composeDose(it),
        unit: it.doseUnit,
        timing: composeTiming(it)
      }));

    const payload = {
      injectionType: fInjType ? fInjType.value : '入院注射',
      parentOrderNumber: fParent.value.trim(),
      revisionNote: fRevNote ? fRevNote.value.trim() : '',
      startDate: fStartDate.value,
      patientId: fPatientId.value.trim(),
      patientName: fPatientName.value.trim(),
      patientKana: fPatientKana.value.trim(),
      age: fAge.value,
      gender: fGender.value,
      birthDate: fBirthDate.value,
      ward: fWard.value,
      room: fRoom.value.trim(),
      sourceDepartment: fSourceDept.value,
      doctorName: fDoctorName.value.trim(),
      items: validItems,
      remarks: fRemarks.value.trim()
    };

    const btnSave = document.getElementById('btnSubmitInj');
    const btnPrint = document.getElementById('btnSubmitInjPrint');
    if (btnSave) btnSave.disabled = true;
    if (btnPrint) btnPrint.disabled = true;

    try {
      const { injection } = await apiFetch('/api/injections', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (openPrint && injection && injection.orderNumber) {
        window.open(`/injections/print/${encodeURIComponent(injection.orderNumber)}?autoprint=1`, '_blank');
      }

      if (isEmbed && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'INJECTION_SAVED', injection }, window.location.origin);
        itemsState = [createBlankItem(1)];
        clearRevisionMode();
        renderItemsTable();
        showStatus(`${injTitle} ${injection.orderNumber} を発行しました。`, false);
        if (btnSave) btnSave.disabled = false;
        if (btnPrint) btnPrint.disabled = false;
        return;
      }

      window.location.href = `${injPath}?patientId=${encodeURIComponent(injection.patientId)}`;
    } catch (err) {
      showStatus(err.message, true);
      if (btnSave) btnSave.disabled = false;
      if (btnPrint) btnPrint.disabled = false;
    }
  }

  document.getElementById('btnSubmitInj')?.addEventListener('click', () => submitInjection(false));
  document.getElementById('btnSubmitInjPrint')?.addEventListener('click', () => submitInjection(true));

  document.querySelectorAll('[data-col-toggle], [data-hist-toggle], #chkInjShowFlagged').forEach((cb) => {
    cb.addEventListener('change', applyVisibilityCheckboxes);
  });

  setTodayIfEmpty();
  renderItemsTable();
  if (initialRevise) {
    loadInjectionForRevision(initialRevise);
  }
})();
