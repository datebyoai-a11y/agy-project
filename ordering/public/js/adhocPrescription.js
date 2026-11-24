'use strict';

(function initAdhocPrescription() {
  const isEmbed = document.body.dataset.embed === '1';
  const initialRevise = document.body.dataset.revise || '';
  const initialDo = document.body.dataset.do || '';
  const rxPath = document.body.dataset.rxPath || '/prescriptions/adhoc';
  const rxTitle = document.body.dataset.rxTitle || '臨時処方箋';
  const defaultDays = Math.max(1, Number(document.body.dataset.defaultDays) || 3);

  const patientPicker = document.getElementById('rxPatientPicker');
  const statusEl = document.getElementById('rxStatusMsg');
  const itemsBody = document.getElementById('rxItemsBody');

  const fPrescriptionType = document.getElementById('rxPrescriptionType');
  const fParent = document.getElementById('rxParentOrderNumber');
  const fDoSource = document.getElementById('rxDoSourceOrderNumber');
  const fRevBanner = document.getElementById('rxRevisionBanner');
  const fRevParentLabel = document.getElementById('rxRevisionParent');
  const fRevNote = document.getElementById('rxRevisionNote');
  const fPatientId = document.getElementById('rxPatientId');
  const fPatientName = document.getElementById('rxPatientName');
  const fPatientKana = document.getElementById('rxPatientKana');
  const fAge = document.getElementById('rxAge');
  const fGender = document.getElementById('rxGender');
  const fBirthDate = document.getElementById('rxBirthDate');
  const fSourceDept = document.getElementById('rxSourceDept');
  const fStartDate = document.getElementById('rxStartDate');
  const fDispenseType = document.getElementById('rxDispenseType');
  const fWard = document.getElementById('rxWard');
  const fRoom = document.getElementById('rxRoom');
  const fDoctorName = document.getElementById('rxDoctorName');
  const fRemarks = document.getElementById('rxRemarks');

  const medSearchInput = document.getElementById('rxMedSearch');
  const medCatFilter = document.getElementById('rxMedCatFilter');
  const majorFilterTag = document.getElementById('rxMajorFilterTag');
  const suggestWrap = document.getElementById('rxMedSuggestWrap');
  const suggestBody = document.getElementById('rxMedSuggestBody');

  const DOSE_UNITS = ['錠', 'カプセル', 'g', '包', '本', '枚', '個'];
  const DIV_OPTIONS = [
    { val: '1', label: '1回' },
    { val: '2', label: '2回' },
    { val: '3', label: '3回' },
    { val: '4', label: '4回' },
    { val: '頓用', label: '頓用' },
    { val: '外用', label: '外用' }
  ];
  const TIMING_CHECKS = ['朝', '昼', '夕', '眠前'];
  const MEAL_RADIOS = ['食前', '食後', '屯用'];

  let selectedMajor = '';
  let itemsState = [createBlankItem()];
  let searchTimer = null;
  let lastSuggestions = [];

  function createBlankItem() {
    return {
      drugId: '',
      drugName: '',
      genericName: '',
      spec: '',
      unit: '錠',
      category: '内服薬',
      doseNum: '',
      doseUnit: '錠',
      dailyDose: '',
      divisionCount: '3',
      timingSet: ['朝', '昼', '夕'],
      mealRadio: '食後',
      administrationMethod: '朝昼夕 食後',
      prescriptionDays: defaultDays,
      dayUnit: '日分',
      note: '',
      suspensionOk: '',
      crushOk: ''
    };
  }

  function composeDailyDose(item) {
    const num = String(item.doseNum || '').trim();
    const unit = String(item.doseUnit || '').trim();
    return num ? `${num}${unit}` : '';
  }

  function composeMethod(item) {
    if (item.mealRadio === '屯用') {
      return '屯用';
    }
    const ordered = TIMING_CHECKS.filter((t) => (item.timingSet || []).includes(t));
    const meals = ordered.filter((t) => t !== '眠前');
    const hasBed = ordered.includes('眠前');

    if (meals.length === 0 && hasBed) {
      return '眠前';
    }
    const mealLabel = item.mealRadio === '食前' ? '食前' : '食後';
    if (meals.length > 0 && hasBed) {
      return `${meals.join('')}${mealLabel}・眠前`;
    }
    if (meals.length > 0) {
      return `${meals.join('')} ${mealLabel}`;
    }
    return mealLabel;
  }

  function parseDailyDose(str, fallbackUnit) {
    const s = String(str || '').trim();
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (m) {
      let u = m[2].trim() || fallbackUnit || '錠';
      if (/^cap$/i.test(u)) u = 'カプセル';
      return { doseNum: m[1], doseUnit: DOSE_UNITS.includes(u) ? u : '錠' };
    }
    return { doseNum: s, doseUnit: fallbackUnit || '錠' };
  }

  function parseMethodToControls(methodStr) {
    const s = String(methodStr || '').trim();
    if (/屯用|頓用/.test(s)) {
      return { timingSet: [], mealRadio: '屯用' };
    }

    const timingSet = [];
    if (/毎食/.test(s)) {
      timingSet.push('朝', '昼', '夕');
    } else {
      if (/朝/.test(s)) timingSet.push('朝');
      if (/昼/.test(s)) timingSet.push('昼');
      if (/夕/.test(s)) timingSet.push('夕');
    }
    if (/眠前|就寝前/.test(s)) timingSet.push('眠前');

    const mealRadio = /食前/.test(s) ? '食前' : '食後';
    return { timingSet, mealRadio };
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

  function okSpan(v) {
    if (!v) return '-';
    const cls = v === '〇' ? 'ok-ok' : v === '△' ? 'ok-tri' : v === '×' ? 'ok-ng' : '';
    return `<span class="${cls}">${esc(v)}</span>`;
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

    const chkFlag = document.getElementById('chkRxShowFlagged');
    if (chkFlag) {
      document.querySelectorAll('.hist-card[data-flagged="true"]').forEach((el) => {
        el.classList.toggle('is-hidden', !chkFlag.checked);
      });
    }
  }

  function renderItemsTable() {
    if (!itemsBody) return;
    if (itemsState.length === 0) itemsState.push(createBlankItem());

    itemsBody.innerHTML = itemsState
      .map((it, idx) => {
        const timingSet = Array.isArray(it.timingSet) ? it.timingSet : [];
        const timingChecksHtml = TIMING_CHECKS.map(
          (t) => `
            <label class="radio-opt">
              <input
                type="checkbox"
                class="js-item-timing-chk"
                data-idx="${idx}"
                value="${t}"
                ${timingSet.includes(t) ? 'checked' : ''}
              ><span>${t}</span>
            </label>`
        ).join('');

        const mealRadiosHtml = MEAL_RADIOS.map(
          (m) => `
            <label class="radio-opt">
              <input
                type="radio"
                class="js-item-meal"
                name="rx_meal_${idx}"
                data-idx="${idx}"
                value="${m}"
                ${it.mealRadio === m ? 'checked' : ''}
              ><span>${m}</span>
            </label>`
        ).join('');

        const unitOptionsHtml = DOSE_UNITS.map(
          (u) => `<option value="${u}" ${it.doseUnit === u ? 'selected' : ''}>${u}</option>`
        ).join('');

        const divOptionsHtml = DIV_OPTIONS.map(
          (d) => `<option value="${d.val}" ${it.divisionCount === d.val ? 'selected' : ''}>${d.label}</option>`
        ).join('');

        return `
          <tr data-row-idx="${idx}">
            <td>
              <input
                type="text"
                class="s-input s-bold js-item-name"
                data-idx="${idx}"
                value="${esc(it.drugName)}"
                placeholder="薬剤名"
              >
            </td>
            <td data-col="daily-dose">
              <div class="dose-cell">
                <input
                  type="text"
                  class="s-input js-item-dose-num"
                  data-idx="${idx}"
                  value="${esc(it.doseNum)}"
                  placeholder="量"
                >
                <select class="s-select js-item-dose-unit" data-idx="${idx}" aria-label="1日量単位">
                  ${unitOptionsHtml}
                </select>
              </div>
            </td>
            <td data-col="division">
              <select class="s-select js-item-div" data-idx="${idx}" aria-label="分割回数">
                ${divOptionsHtml}
              </select>
            </td>
            <td data-col="method">
              <div class="method-radios">
                <div class="radio-row">${timingChecksHtml}</div>
                <div class="radio-row radio-row--meal">${mealRadiosHtml}</div>
              </div>
            </td>
            <td data-col="days">
              <div class="days-cell">
                <input
                  type="number"
                  min="1"
                  max="90"
                  class="s-input js-item-days"
                  data-idx="${idx}"
                  value="${esc(it.prescriptionDays)}"
                >
                <select class="s-select js-item-day-unit" data-idx="${idx}">
                  ${['日分', '回分', '本', '枚', '個', '包']
                    .map((u) => `<option value="${u}" ${it.dayUnit === u ? 'selected' : ''}>${u}</option>`)
                    .join('')}
                </select>
              </div>
            </td>
            <td data-col="note">
              <input
                type="text"
                class="s-input js-item-note"
                data-idx="${idx}"
                value="${esc(it.note)}"
                placeholder="一包化・粉砕・注意等"
              >
            </td>
            <td data-col="handling" style="text-align:center;font-size:11px;white-space:nowrap;">
              ${okSpan(it.suspensionOk)}/${okSpan(it.crushOk)}
            </td>
            <td style="text-align:center;">
              <button type="button" class="btn-mini btn-mini--warn js-del-row" data-idx="${idx}" title="行削除">×</button>
            </td>
          </tr>`;
      })
      .join('');

    applyVisibilityCheckboxes();
  }

  /**
   * 薬剤データベース（MongoDB medicines）から返却されたデフォルト値をそのままセット
   */
  function addMedicineRow(med) {
    const doseNum = med.defaultDailyDoseNum || '1';
    const doseUnit = DOSE_UNITS.includes(med.defaultDailyDoseUnit) ? med.defaultDailyDoseUnit : '錠';
    const divisionCount = med.defaultDivisionCount || '3';
    const parsedMethod = parseMethodToControls(
      med.defaultAdministrationMethod ||
        (med.defaultMethodTiming === '屯用'
          ? '屯用'
          : med.defaultMethodTiming === '眠前'
            ? '眠前'
            : `${med.defaultMethodTiming || '朝昼夕'} ${med.defaultMethodMeal || '食後'}`)
    );

    const isPrn = parsedMethod.mealRadio === '屯用' || divisionCount === '頓用';
    const isExt = med.category === '外用薬';

    const newItem = {
      drugId: med.drugId || '',
      drugName: med.name || '',
      genericName: med.genericName || '',
      spec: med.spec || '',
      unit: doseUnit,
      category: med.category || '内服薬',
      doseNum,
      doseUnit,
      dailyDose: `${doseNum}${doseUnit}`,
      divisionCount,
      timingSet: parsedMethod.timingSet,
      mealRadio: parsedMethod.mealRadio,
      administrationMethod: composeMethod(parsedMethod),
      prescriptionDays: isPrn ? 5 : isExt ? 1 : defaultDays,
      dayUnit: isPrn ? '回分' : isExt ? (doseUnit === '枚' ? '枚' : '本') : '日分',
      note: '',
      suspensionOk: med.suspensionOk || '',
      crushOk: med.crushOk || ''
    };

    if (itemsState.length === 1 && !itemsState[0].drugName.trim()) {
      itemsState[0] = newItem;
    } else {
      itemsState.push(newItem);
    }

    renderItemsTable();
    showStatus(
      `「${med.name}」を追加（DB初期値: ${newItem.dailyDose} / 分${newItem.divisionCount} / ${newItem.administrationMethod}）`,
      false
    );
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
        suggestBody.innerHTML = '<tr><td colspan="4" class="empty-msg">該当薬剤なし</td></tr>';
      } else {
        suggestBody.innerHTML = lastSuggestions
          .map(
            (m, i) => `
            <tr class="suggest-row" data-sug-idx="${i}">
              <td><strong>${esc(m.name)}</strong></td>
              <td style="color:#64748b;">${esc(m.genericName || '')}</td>
              <td style="white-space:nowrap;">${esc(m.defaultDailyDoseNum || '')}${esc(m.defaultDailyDoseUnit || '')} / 分${esc(m.defaultDivisionCount || '')} / ${esc(m.defaultAdministrationMethod || '')}</td>
              <td style="white-space:nowrap;">懸:${okSpan(m.suspensionOk)} 粉:${okSpan(m.crushOk)}</td>
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

  document.getElementById('rxCategoryTree')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.tree-leaf');
    if (!btn) return;
    document.querySelectorAll('#rxCategoryTree .tree-leaf').forEach((el) => el.classList.remove('is-selected'));
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

    if (t.classList.contains('js-item-name')) itemsState[idx].drugName = t.value;
    else if (t.classList.contains('js-item-dose-num')) {
      itemsState[idx].doseNum = t.value;
      itemsState[idx].dailyDose = composeDailyDose(itemsState[idx]);
    } else if (t.classList.contains('js-item-days')) {
      itemsState[idx].prescriptionDays = Number(t.value) || 1;
    } else if (t.classList.contains('js-item-note')) {
      itemsState[idx].note = t.value;
    }
  });

  itemsBody.addEventListener('change', (event) => {
    const t = event.target;
    const idx = Number(t.dataset.idx);
    if (Number.isNaN(idx) || !itemsState[idx]) return;

    if (t.classList.contains('js-item-dose-unit')) {
      itemsState[idx].doseUnit = t.value;
      itemsState[idx].unit = t.value;
      itemsState[idx].dailyDose = composeDailyDose(itemsState[idx]);
    } else if (t.classList.contains('js-item-div')) {
      itemsState[idx].divisionCount = t.value;
    } else if (t.classList.contains('js-item-day-unit')) {
      itemsState[idx].dayUnit = t.value;
    } else if (t.classList.contains('js-item-timing-chk')) {
      const val = t.value;
      const set = new Set(itemsState[idx].timingSet || []);
      if (t.checked) set.add(val);
      else set.delete(val);
      itemsState[idx].timingSet = TIMING_CHECKS.filter((k) => set.has(k));

      if (itemsState[idx].timingSet.length > 0 && itemsState[idx].mealRadio === '屯用') {
        itemsState[idx].mealRadio = '食後';
        if (itemsState[idx].dayUnit === '回分') itemsState[idx].dayUnit = '日分';
      }
      if (itemsState[idx].timingSet.length > 0) {
        itemsState[idx].divisionCount = String(itemsState[idx].timingSet.length);
      }
      itemsState[idx].administrationMethod = composeMethod(itemsState[idx]);
      renderItemsTable();
    } else if (t.classList.contains('js-item-meal')) {
      const val = t.value;
      itemsState[idx].mealRadio = val;
      if (val === '屯用') {
        itemsState[idx].timingSet = [];
        itemsState[idx].divisionCount = '頓用';
        if (itemsState[idx].dayUnit === '日分') itemsState[idx].dayUnit = '回分';
      } else if ((itemsState[idx].timingSet || []).length === 0) {
        itemsState[idx].timingSet = ['朝', '昼', '夕'];
        itemsState[idx].divisionCount = '3';
        if (itemsState[idx].dayUnit === '回分') itemsState[idx].dayUnit = '日分';
      }
      itemsState[idx].administrationMethod = composeMethod(itemsState[idx]);
      renderItemsTable();
    }
  });

  itemsBody.addEventListener('click', (event) => {
    const delBtn = event.target.closest('.js-del-row');
    if (!delBtn) return;
    const idx = Number(delBtn.dataset.idx);
    itemsState.splice(idx, 1);
    if (itemsState.length === 0) itemsState.push(createBlankItem());
    renderItemsTable();
  });

  document.getElementById('btnAddBlankRow')?.addEventListener('click', () => {
    itemsState.push(createBlankItem());
    renderItemsTable();
  });

  function clearRevisionMode() {
    fParent.value = '';
    if (fRevNote) fRevNote.value = '';
    if (fRevBanner) fRevBanner.hidden = true;
  }

  document.getElementById('btnRxCancelRevision')?.addEventListener('click', clearRevisionMode);

  if (patientPicker) {
    patientPicker.addEventListener('change', () => {
      const pid = patientPicker.value;
      window.location.href = pid
        ? `${rxPath}?patientId=${encodeURIComponent(pid)}`
        : `${rxPath}?patientId=`;
    });
  }

  function mapStoredItemToState(it) {
    const parsedDose = parseDailyDose(it.dailyDose, it.unit);
    const parsedMethod = parseMethodToControls(it.administrationMethod);
    return {
      ...createBlankItem(),
      ...it,
      doseNum: parsedDose.doseNum,
      doseUnit: parsedDose.doseUnit,
      timingSet: parsedMethod.timingSet,
      mealRadio: parsedMethod.mealRadio,
      administrationMethod: composeMethod(parsedMethod)
    };
  }

  async function loadPrescriptionForRevision(orderNumber) {
    try {
      const { prescription } = await apiFetch(`/api/prescriptions/${encodeURIComponent(orderNumber)}`);
      fParent.value = prescription.orderNumber;
      if (fDoSource) fDoSource.value = '';
      if (fPrescriptionType && prescription.prescriptionType) {
        fPrescriptionType.value = prescription.prescriptionType;
      }
      fRevParentLabel.textContent = prescription.orderNumber;
      fRevBanner.hidden = false;

      fPatientId.value = prescription.patientId || '';
      fPatientName.value = prescription.patientName || '';
      fPatientKana.value = prescription.patientKana || '';
      fAge.value = prescription.age != null ? String(prescription.age) : '';
      fGender.value = prescription.gender || '不明';
      fBirthDate.value = prescription.birthDate || '';
      fStartDate.value = prescription.startDate || '';
      fDispenseType.value = prescription.dispenseType || '院内処方';
      fWard.value = prescription.ward === '病棟' ? '医療病棟' : (prescription.ward || '外来');
      fRoom.value = prescription.room || '';
      fRemarks.value = prescription.remarks || '';

      itemsState =
        Array.isArray(prescription.items) && prescription.items.length > 0
          ? prescription.items.map(mapStoredItemToState)
          : [createBlankItem()];
      renderItemsTable();
      showStatus(`処方箋 ${prescription.orderNumber} を訂正再発行用に読み込みました。`, false);
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  async function loadPrescriptionForDo(orderNumber) {
    try {
      const { prescription } = await apiFetch(`/api/prescriptions/${encodeURIComponent(orderNumber)}`);
      clearRevisionMode();
      if (fDoSource) fDoSource.value = prescription.orderNumber;

      if (!fPatientId.value.trim()) {
        fPatientId.value = prescription.patientId || '';
        fPatientName.value = prescription.patientName || '';
        fPatientKana.value = prescription.patientKana || '';
        fAge.value = prescription.age != null ? String(prescription.age) : '';
        fGender.value = prescription.gender || '不明';
        fBirthDate.value = prescription.birthDate || '';
        if (prescription.room) fRoom.value = prescription.room;
      }

      // Do処方は本日の日付で新規作成（処方種別は現在開いている臨時/定期/外来を維持）
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      if (fStartDate) fStartDate.value = `${y}-${m}-${d}`;
      if (fRemarks && !fRemarks.value.trim() && prescription.remarks) {
        fRemarks.value = prescription.remarks;
      }

      const quotedItems =
        Array.isArray(prescription.items) && prescription.items.length > 0
          ? prescription.items.map(mapStoredItemToState)
          : [];

      if (quotedItems.length > 0) {
        if (itemsState.length === 1 && !itemsState[0].drugName.trim()) {
          itemsState = quotedItems;
        } else {
          itemsState = itemsState.concat(quotedItems);
        }
      }
      renderItemsTable();
      showStatus(
        `処方箋 ${prescription.orderNumber}（${prescription.prescriptionType}）から ${quotedItems.length} 件を Do処方引用しました。`,
        false
      );
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  document.getElementById('pastRxList')?.addEventListener('click', async (event) => {
    const doBtn = event.target.closest('.js-rx-do');
    if (doBtn) {
      await loadPrescriptionForDo(doBtn.dataset.order);
      return;
    }

    const revBtn = event.target.closest('.js-rx-revise');
    if (revBtn) {
      await loadPrescriptionForRevision(revBtn.dataset.order);
      return;
    }

    const cancelBtn = event.target.closest('.js-rx-cancel');
    if (cancelBtn) {
      const orderNum = cancelBtn.dataset.order;
      const reason = window.prompt(`処方箋 ${orderNum} に中止フラグを設定します。理由を入力してください:`, '医師指示により中止');
      if (reason === null) return;
      try {
        await apiFetch(`/api/prescriptions/${encodeURIComponent(orderNum)}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });
        window.location.reload();
      } catch (err) {
        showStatus(err.message, true);
      }
    }
  });

  async function submitPrescription(openPrint) {
    const validItems = itemsState
      .filter((it) => it.drugName.trim())
      .map((it) => ({
        ...it,
        dailyDose: composeDailyDose(it),
        unit: it.doseUnit,
        administrationMethod: composeMethod(it)
      }));

    const payload = {
      prescriptionType: fPrescriptionType ? fPrescriptionType.value : '臨時処方',
      parentOrderNumber: fParent.value.trim(),
      doSourceOrderNumber: fDoSource ? fDoSource.value.trim() : '',
      revisionNote: fRevNote ? fRevNote.value.trim() : '',
      dispenseType: fDispenseType.value,
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

    const btnSave = document.getElementById('btnSubmitRx');
    const btnPrint = document.getElementById('btnSubmitRxPrint');
    if (btnSave) btnSave.disabled = true;
    if (btnPrint) btnPrint.disabled = true;

    try {
      const { prescription } = await apiFetch('/api/prescriptions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (openPrint && prescription && prescription.orderNumber) {
        window.open(`/prescriptions/print/${encodeURIComponent(prescription.orderNumber)}?autoprint=1`, '_blank');
      }

      if (isEmbed && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'PRESCRIPTION_SAVED', prescription }, window.location.origin);
        itemsState = [createBlankItem()];
        clearRevisionMode();
        if (fDoSource) fDoSource.value = '';
        renderItemsTable();
        showStatus(`${rxTitle} ${prescription.orderNumber} を発行しました。`, false);
        if (btnSave) btnSave.disabled = false;
        if (btnPrint) btnPrint.disabled = false;
        return;
      }

      window.location.href = `${rxPath}?patientId=${encodeURIComponent(prescription.patientId)}`;
    } catch (err) {
      showStatus(err.message, true);
      if (btnSave) btnSave.disabled = false;
      if (btnPrint) btnPrint.disabled = false;
    }
  }

  document.getElementById('btnSubmitRx')?.addEventListener('click', () => submitPrescription(false));
  document.getElementById('btnSubmitRxPrint')?.addEventListener('click', () => submitPrescription(true));

  document.querySelectorAll('[data-col-toggle], [data-hist-toggle], #chkRxShowFlagged').forEach((cb) => {
    cb.addEventListener('change', applyVisibilityCheckboxes);
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'DO_PRESCRIPTION' && event.data.orderNumber) {
      loadPrescriptionForDo(event.data.orderNumber);
    }
  });

  setTodayIfEmpty();
  renderItemsTable();
  if (initialRevise) {
    loadPrescriptionForRevision(initialRevise);
  } else if (initialDo) {
    loadPrescriptionForDo(initialDo);
  }
})();
