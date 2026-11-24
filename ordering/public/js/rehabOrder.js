'use strict';

(function initRehabOrderScreen() {
  const isEmbed = document.body.dataset.embed === '1';
  const sourceDept = document.body.dataset.sourceDept || '';
  const initialRevise = document.body.dataset.revise || '';
  const defaultDoctor = document.body.dataset.defaultDoctor || '';

  const form = document.getElementById('rehabOrderForm');
  const statusMsg = document.getElementById('rehabStatusMessage');
  const parentOrderEl = document.getElementById('rehabParentOrderNumber');
  const revBanner = document.getElementById('rehabRevisionBanner');
  const revParentLabel = document.getElementById('rehabRevisionParentLabel');
  const revNoteEl = document.getElementById('rehabRevisionNote');
  const btnCancelRev = document.getElementById('btnCancelRehabRevision');

  const patientPicker = document.getElementById('rehabPatientPicker');
  const inlinePatientSelect = document.getElementById('rehabInlinePatientSelect');

  const fields = {
    patientId: document.getElementById('rehabPatientId'),
    patientName: document.getElementById('rehabPatientName'),
    patientKana: document.getElementById('rehabPatientKana'),
    gender: document.getElementById('rehabGender'),
    age: document.getElementById('rehabAge'),
    birthDate: document.getElementById('rehabBirthDate'),
    ward: document.getElementById('rehabWard'),
    room: document.getElementById('rehabRoom'),
    doctorName: document.getElementById('rehabDoctorName'),
    orderDate: document.getElementById('rehabOrderDate'),
    onsetDate: document.getElementById('rehabOnsetDate'),
    rehabCategory: document.getElementById('rehabCategory'),
    diagnosisName: document.getElementById('rehabDiagnosisName'),
    frequencyPerWeek: document.getElementById('rehabFrequency'),
    unitsPerDay: document.getElementById('rehabUnits'),
    durationMonths: document.getElementById('rehabDuration'),
    location: document.getElementById('rehabLocation'),
    oxygenFlow: document.getElementById('rehabOxygenFlow'),
    contraindications: document.getElementById('rehabContraindications'),
    necessityReason: document.getElementById('rehabNecessityReason'),
    remarks: document.getElementById('rehabRemarks')
  };

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  if (fields.orderDate && !fields.orderDate.value) {
    fields.orderDate.value = todayIso();
  }

  function setStatus(msg, isError) {
    if (!statusMsg) return;
    statusMsg.textContent = msg || '';
    statusMsg.className = `status-msg ${msg ? (isError ? 'is-err' : 'is-ok') : ''}`;
  }

  function setSelectValue(el, val) {
    if (!el || val == null) return;
    const str = String(val);
    const hasOpt = Array.from(el.options).some((o) => o.value === str);
    if (!hasOpt && str) {
      const opt = document.createElement('option');
      opt.value = str;
      opt.textContent = str;
      el.appendChild(opt);
    }
    el.value = str;
  }

  function getCheckedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
  }

  function setCheckedValues(name, list) {
    const set = new Set(Array.isArray(list) ? list : []);
    document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
      el.checked = set.has(el.value);
    });
  }

  function applySectionToggles() {
    document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
      const grp = cb.getAttribute('data-col-toggle');
      document.querySelectorAll(`[data-col-group="${grp}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    });
  }

  document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
    cb.addEventListener('change', applySectionToggles);
  });
  applySectionToggles();

  const chkShowFlagged = document.getElementById('chkRehabShowFlagged');
  const chkShowItems = document.getElementById('chkRehabShowItems');
  const chkShowRisk = document.getElementById('chkRehabShowRisk');

  function applyHistoryFilters() {
    const showFlagged = chkShowFlagged ? chkShowFlagged.checked : true;
    const showItems = chkShowItems ? chkShowItems.checked : true;
    const showRisk = chkShowRisk ? chkShowRisk.checked : true;

    document.querySelectorAll('#rehabHistoryList .hist-card').forEach((card) => {
      const flagged = card.getAttribute('data-flagged') === 'true';
      card.classList.toggle('is-hidden', flagged && !showFlagged);
    });
    document.querySelectorAll('#rehabHistoryList .js-rehab-items').forEach((el) => {
      el.classList.toggle('is-hidden', !showItems);
    });
    document.querySelectorAll('#rehabHistoryList .js-rehab-risk').forEach((el) => {
      el.classList.toggle('is-hidden', !showRisk);
    });
  }

  [chkShowFlagged, chkShowItems, chkShowRisk].forEach((el) => {
    if (el) el.addEventListener('change', applyHistoryFilters);
  });

  if (patientPicker) {
    patientPicker.addEventListener('change', () => {
      const pid = patientPicker.value;
      window.location.href = pid ? `/rehab?patientId=${encodeURIComponent(pid)}` : '/rehab?patientId=';
    });
  }

  if (inlinePatientSelect) {
    inlinePatientSelect.addEventListener('change', () => {
      const opt = inlinePatientSelect.options[inlinePatientSelect.selectedIndex];
      if (!opt || !opt.value) return;
      fields.patientId.value = opt.value;
      fields.patientName.value = opt.dataset.name || '';
      fields.patientKana.value = opt.dataset.kana || '';
      fields.gender.value = opt.dataset.gender || '不明';
      fields.age.value = opt.dataset.age || '';
      fields.birthDate.value = opt.dataset.birth || '';
      fields.ward.value = opt.dataset.ward || '医療病棟';
      fields.room.value = opt.dataset.room || '';
    });
  }

  // 左列テンプレート反映
  document.querySelectorAll('.js-rehab-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.js-rehab-preset').forEach((b) => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      if (btn.dataset.cat) setSelectValue(fields.rehabCategory, btn.dataset.cat);
      if (btn.dataset.freq) setSelectValue(fields.frequencyPerWeek, btn.dataset.freq);
      if (btn.dataset.units) setSelectValue(fields.unitsPerDay, btn.dataset.units);
      if (btn.dataset.loc) setSelectValue(fields.location, btn.dataset.loc);
      setCheckedValues('ptItems', btn.dataset.pt ? btn.dataset.pt.split(',') : []);
      setCheckedValues('otItems', btn.dataset.ot ? btn.dataset.ot.split(',') : []);
      setCheckedValues('stItems', btn.dataset.st ? btn.dataset.st.split(',') : []);
      setCheckedValues('evalItems', btn.dataset.eval ? btn.dataset.eval.split(',') : []);
      setStatus(`テンプレート「${btn.textContent.trim()}」を反映しました。`, false);
    });
  });

  function clearRevisionMode() {
    parentOrderEl.value = '';
    revParentLabel.textContent = '';
    revNoteEl.value = '';
    revBanner.hidden = true;
  }

  if (btnCancelRev) {
    btnCancelRev.addEventListener('click', clearRevisionMode);
  }

  async function loadOrderForRevision(orderNumber) {
    if (!orderNumber) return;
    try {
      const res = await fetch(`/api/rehab/${encodeURIComponent(orderNumber)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.rehab) {
        setStatus(data.error || '訂正元指示の取得に失敗しました。', true);
        return;
      }
      const r = data.rehab;
      parentOrderEl.value = r.orderNumber;
      revParentLabel.textContent = r.orderNumber;
      revBanner.hidden = false;

      fields.patientId.value = r.patientId || '';
      fields.patientName.value = r.patientName || '';
      fields.patientKana.value = r.patientKana || '';
      fields.gender.value = r.gender || '不明';
      fields.age.value = r.age != null ? String(r.age) : '';
      fields.birthDate.value = r.birthDate || '';
      fields.ward.value = r.ward === '病棟' ? '医療病棟' : (r.ward || '医療病棟');
      fields.room.value = r.room || '';
      fields.doctorName.value = defaultDoctor || r.doctorName || '';

      fields.orderDate.value = r.orderDate || todayIso();
      fields.onsetDate.value = r.onsetDate || '';
      setSelectValue(fields.rehabCategory, r.rehabCategory || '運動器');
      fields.diagnosisName.value = r.diagnosisName || '';
      setSelectValue(fields.frequencyPerWeek, r.frequencyPerWeek || '週3回');
      setSelectValue(fields.unitsPerDay, r.unitsPerDay || '2単位(40分)');
      setSelectValue(fields.durationMonths, r.durationMonths || '3ヶ月間');
      setSelectValue(fields.location, r.location || '病棟内');
      fields.oxygenFlow.value = r.oxygenFlow || '';
      fields.contraindications.value = r.contraindications || '';
      fields.necessityReason.value = r.necessityReason || '';
      setCheckedValues('rehabRisks', r.risks || []);
      setCheckedValues('ptItems', r.ptItems || []);
      setCheckedValues('otItems', r.otItems || []);
      setCheckedValues('stItems', r.stItems || []);
      setCheckedValues('evalItems', r.evalItems || []);
      fields.remarks.value = r.remarks || '';

      setStatus(`リハビリ指示 ${r.orderNumber} を訂正再発行モードで読み込みました。`, false);
    } catch (err) {
      setStatus(err.message || '読み込みエラーが発生しました。', true);
    }
  }

  document.addEventListener('click', async (event) => {
    const revBtn = event.target.closest('.js-rehab-revise');
    if (revBtn) {
      loadOrderForRevision(revBtn.getAttribute('data-order'));
      return;
    }

    const cancelBtn = event.target.closest('.js-rehab-cancel');
    if (cancelBtn) {
      const orderNum = cancelBtn.getAttribute('data-order');
      const reason = window.prompt(`リハビリ指示 ${orderNum} に中止フラグを設定します。理由を入力してください:`, '医師指示により中止');
      if (reason === null) return;
      try {
        const res = await fetch(`/api/rehab/${encodeURIComponent(orderNum)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ reason })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          setStatus(data.error || '中止処理に失敗しました。', true);
          return;
        }
        window.location.reload();
      } catch (err) {
        setStatus(err.message || '中止処理に失敗しました。', true);
      }
    }
  });

  const btnReset = document.getElementById('btnResetRehab');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      clearRevisionMode();
      fields.orderDate.value = todayIso();
      fields.onsetDate.value = '';
      setSelectValue(fields.rehabCategory, '運動器');
      fields.diagnosisName.value = '';
      setSelectValue(fields.frequencyPerWeek, '週3回');
      setSelectValue(fields.unitsPerDay, '2単位(40分)');
      setSelectValue(fields.durationMonths, '3ヶ月間');
      setSelectValue(fields.location, '病棟内');
      fields.oxygenFlow.value = '';
      fields.contraindications.value = '';
      fields.necessityReason.value = '';
      setCheckedValues('rehabRisks', []);
      setCheckedValues('ptItems', []);
      setCheckedValues('otItems', []);
      setCheckedValues('stItems', []);
      setCheckedValues('evalItems', []);
      fields.remarks.value = '';
      setStatus('入力内容を初期化しました。', false);
    });
  }

  async function submitRehab(openPrint) {
    const payload = {
      patientId: fields.patientId.value.trim(),
      patientName: fields.patientName.value.trim(),
      patientKana: fields.patientKana.value.trim(),
      gender: fields.gender.value.trim(),
      age: fields.age.value.trim(),
      birthDate: fields.birthDate.value.trim(),
      ward: fields.ward.value.trim(),
      room: fields.room.value.trim(),
      sourceDepartment: sourceDept,
      doctorName: fields.doctorName.value.trim(),
      orderDate: fields.orderDate.value.trim(),
      onsetDate: fields.onsetDate.value.trim(),
      rehabCategory: fields.rehabCategory.value,
      diagnosisName: fields.diagnosisName.value.trim(),
      frequencyPerWeek: fields.frequencyPerWeek.value,
      unitsPerDay: fields.unitsPerDay.value,
      durationMonths: fields.durationMonths.value,
      location: fields.location.value,
      risks: getCheckedValues('rehabRisks'),
      oxygenFlow: fields.oxygenFlow.value.trim(),
      contraindications: fields.contraindications.value.trim(),
      necessityReason: fields.necessityReason.value.trim(),
      ptItems: getCheckedValues('ptItems'),
      otItems: getCheckedValues('otItems'),
      stItems: getCheckedValues('stItems'),
      evalItems: getCheckedValues('evalItems'),
      remarks: fields.remarks.value.trim(),
      parentOrderNumber: parentOrderEl.value.trim(),
      revisionNote: revNoteEl.value.trim()
    };

    if (!payload.patientId || !payload.patientName) {
      setStatus('対象患者を選択または入力してください。', true);
      return;
    }
    if (!payload.diagnosisName) {
      setStatus('診断名・算定病名を入力してください。', true);
      fields.diagnosisName.focus();
      return;
    }
    if (
      payload.ptItems.length + payload.otItems.length + payload.stItems.length + payload.evalItems.length ===
      0
    ) {
      setStatus('訓練・評価内容（PT/OT/ST/評価）を1つ以上選択してください。', true);
      return;
    }

    setStatus('発行処理中...', false);
    try {
      const res = await fetch('/api/rehab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.rehab) {
        setStatus(data.error || 'リハビリ指示の発行に失敗しました。', true);
        return;
      }

      const saved = data.rehab;
      clearRevisionMode();
      setStatus(`リハビリ指示 ${saved.orderNumber} を発行しました。`, false);

      if (openPrint) {
        window.open(`/rehab/print/${encodeURIComponent(saved.orderNumber)}?autoprint=1`, '_blank');
      }

      if (isEmbed && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'REHAB_ORDER_SAVED', rehab: saved }, window.location.origin);
      } else {
        window.location.href = `/rehab?patientId=${encodeURIComponent(saved.patientId)}`;
      }
    } catch (err) {
      setStatus(err.message || '通信エラーが発生しました。', true);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitRehab(false);
  });

  const btnPrint = document.getElementById('btnSubmitRehabPrint');
  if (btnPrint) {
    btnPrint.addEventListener('click', () => submitRehab(true));
  }

  if (initialRevise) {
    loadOrderForRevision(initialRevise);
  }
})();
