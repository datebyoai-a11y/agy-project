'use strict';

(function initMealOrderScreen() {
  const isEmbed = document.body.dataset.embed === '1';
  const sourceDept = document.body.dataset.sourceDept || '';
  const initialRevise = document.body.dataset.revise || '';
  const defaultDoctor = document.body.dataset.defaultDoctor || '';

  const form = document.getElementById('mealOrderForm');
  const statusMsg = document.getElementById('mealStatusMessage');
  const parentOrderEl = document.getElementById('mealParentOrderNumber');
  const revBanner = document.getElementById('mealRevisionBanner');
  const revParentLabel = document.getElementById('mealRevisionParentLabel');
  const revNoteEl = document.getElementById('mealRevisionNote');
  const btnCancelRev = document.getElementById('btnCancelMealRevision');

  const patientPicker = document.getElementById('mealPatientPicker');
  const inlinePatientSelect = document.getElementById('mealInlinePatientSelect');

  const fields = {
    patientId: document.getElementById('mealPatientId'),
    patientName: document.getElementById('mealPatientName'),
    patientKana: document.getElementById('mealPatientKana'),
    gender: document.getElementById('mealGender'),
    age: document.getElementById('mealAge'),
    birthDate: document.getElementById('mealBirthDate'),
    ward: document.getElementById('mealWard'),
    room: document.getElementById('mealRoom'),
    doctorName: document.getElementById('mealDoctorName'),
    startDate: document.getElementById('mealStartDate'),
    startMeal: document.getElementById('mealStartMeal'),
    dietType: document.getElementById('mealDietType'),
    stapleType: document.getElementById('mealStapleType'),
    stapleAmount: document.getElementById('mealStapleAmount'),
    sideTexture: document.getElementById('mealSideTexture'),
    thickener: document.getElementById('mealThickener'),
    calories: document.getElementById('mealCalories'),
    saltLimit: document.getElementById('mealSaltLimit'),
    proteinLimit: document.getElementById('mealProteinLimit'),
    waterLimit: document.getElementById('mealWaterLimit'),
    supplement: document.getElementById('mealSupplement'),
    prohibitedFoods: document.getElementById('mealProhibitedFoods'),
    remarks: document.getElementById('mealRemarks')
  };

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  if (fields.startDate && !fields.startDate.value) {
    fields.startDate.value = todayIso();
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

  function getSelectedEatingAid() {
    return Array.from(document.querySelectorAll('input[name="eatingAid"]:checked')).map((el) => el.value);
  }

  function setSelectedEatingAid(list) {
    const set = new Set(Array.isArray(list) ? list : []);
    document.querySelectorAll('input[name="eatingAid"]').forEach((el) => {
      el.checked = set.has(el.value);
    });
  }

  // 表示・非表示チェックボックス（右列セクション）
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

  // 中列フィルタチェックボックス
  const chkShowFlagged = document.getElementById('chkMealShowFlagged');
  const chkShowNutrition = document.getElementById('chkMealShowNutrition');
  const chkShowAid = document.getElementById('chkMealShowAid');

  function applyHistoryFilters() {
    const showFlagged = chkShowFlagged ? chkShowFlagged.checked : true;
    const showNutr = chkShowNutrition ? chkShowNutrition.checked : true;
    const showAid = chkShowAid ? chkShowAid.checked : true;

    document.querySelectorAll('#mealHistoryList .hist-card').forEach((card) => {
      const flagged = card.getAttribute('data-flagged') === 'true';
      card.classList.toggle('is-hidden', flagged && !showFlagged);
    });
    document.querySelectorAll('#mealHistoryList .js-meal-nutr').forEach((el) => {
      el.classList.toggle('is-hidden', !showNutr);
    });
    document.querySelectorAll('#mealHistoryList .js-meal-aid').forEach((el) => {
      el.classList.toggle('is-hidden', !showAid);
    });
  }

  [chkShowFlagged, chkShowNutrition, chkShowAid].forEach((el) => {
    if (el) el.addEventListener('change', applyHistoryFilters);
  });

  // 左列患者選択
  if (patientPicker) {
    patientPicker.addEventListener('change', () => {
      const pid = patientPicker.value;
      window.location.href = pid ? `/meals?patientId=${encodeURIComponent(pid)}` : '/meals?patientId=';
    });
  }

  // 右列インライン患者選択
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
      if (!fields.prohibitedFoods.value && opt.dataset.allergies) {
        fields.prohibitedFoods.value = opt.dataset.allergies;
      }
    });
  }

  // 左列プリセット反映
  document.querySelectorAll('.js-meal-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.js-meal-preset').forEach((b) => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      if (btn.dataset.diet) setSelectValue(fields.dietType, btn.dataset.diet);
      if (btn.dataset.staple) setSelectValue(fields.stapleType, btn.dataset.staple);
      if (btn.dataset.amount) setSelectValue(fields.stapleAmount, btn.dataset.amount);
      if (btn.dataset.side) setSelectValue(fields.sideTexture, btn.dataset.side);
      if (btn.dataset.thick) setSelectValue(fields.thickener, btn.dataset.thick);
      if (btn.dataset.cal) setSelectValue(fields.calories, btn.dataset.cal);
      if (btn.dataset.salt) setSelectValue(fields.saltLimit, btn.dataset.salt);
      if (btn.dataset.protein != null) fields.proteinLimit.value = btn.dataset.protein;
      setStatus(`プリセット「${btn.textContent.trim()}」を反映しました。`, false);
    });
  });

  // 食種が絶食・経管栄養の場合は主食・副食を自動で「なし」に寄せる
  if (fields.dietType) {
    fields.dietType.addEventListener('change', () => {
      const v = fields.dietType.value;
      if (v === '絶食（禁食）' || v === '経管栄養') {
        setSelectValue(fields.stapleType, 'なし');
        setSelectValue(fields.stapleAmount, 'なし');
        setSelectValue(fields.sideTexture, 'なし');
        setSelectValue(fields.thickener, 'なし');
      }
    });
  }

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
      const res = await fetch(`/api/meals/${encodeURIComponent(orderNumber)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.meal) {
        setStatus(data.error || '訂正元オーダーの取得に失敗しました。', true);
        return;
      }
      const m = data.meal;
      parentOrderEl.value = m.orderNumber;
      revParentLabel.textContent = m.orderNumber;
      revBanner.hidden = false;

      fields.patientId.value = m.patientId || '';
      fields.patientName.value = m.patientName || '';
      fields.patientKana.value = m.patientKana || '';
      fields.gender.value = m.gender || '不明';
      fields.age.value = m.age != null ? String(m.age) : '';
      fields.birthDate.value = m.birthDate || '';
      fields.ward.value = m.ward === '病棟' ? '医療病棟' : (m.ward || '医療病棟');
      fields.room.value = m.room || '';
      fields.doctorName.value = defaultDoctor || m.doctorName || '';

      fields.startDate.value = m.startDate || todayIso();
      setSelectValue(fields.startMeal, m.startMeal || '昼食');
      setSelectValue(fields.dietType, m.dietType || '常食');
      setSelectValue(fields.stapleType, m.stapleType || '米飯');
      setSelectValue(fields.stapleAmount, m.stapleAmount || '全量');
      setSelectValue(fields.sideTexture, m.sideTexture || '常菜');
      setSelectValue(fields.thickener, m.thickener || 'なし');
      setSelectValue(fields.calories, m.calories || '標準');
      setSelectValue(fields.saltLimit, m.saltLimit || '制限なし');
      fields.proteinLimit.value = m.proteinLimit || '';
      fields.waterLimit.value = m.waterLimit || '';
      fields.supplement.value = m.supplement || '';
      fields.prohibitedFoods.value = m.prohibitedFoods || '';
      setSelectedEatingAid(m.eatingAid || []);
      fields.remarks.value = m.remarks || '';

      setStatus(`オーダー ${m.orderNumber} を訂正再発行モードで読み込みました。`, false);
    } catch (err) {
      setStatus(err.message || '読み込みエラーが発生しました。', true);
    }
  }

  // 中列ボタン（訂正再発行 / 中止）
  document.addEventListener('click', async (event) => {
    const revBtn = event.target.closest('.js-meal-revise');
    if (revBtn) {
      loadOrderForRevision(revBtn.getAttribute('data-order'));
      return;
    }

    const cancelBtn = event.target.closest('.js-meal-cancel');
    if (cancelBtn) {
      const orderNum = cancelBtn.getAttribute('data-order');
      const reason = window.prompt(`食事オーダー ${orderNum} に中止フラグを設定します。理由を入力してください:`, '指示変更により中止');
      if (reason === null) return;
      try {
        const res = await fetch(`/api/meals/${encodeURIComponent(orderNum)}/cancel`, {
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

  // クリアボタン
  const btnReset = document.getElementById('btnResetMeal');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      clearRevisionMode();
      fields.startDate.value = todayIso();
      setSelectValue(fields.startMeal, '昼食');
      setSelectValue(fields.dietType, '常食');
      setSelectValue(fields.stapleType, '米飯');
      setSelectValue(fields.stapleAmount, '全量');
      setSelectValue(fields.sideTexture, '常菜');
      setSelectValue(fields.thickener, 'なし');
      setSelectValue(fields.calories, '標準');
      setSelectValue(fields.saltLimit, '制限なし');
      fields.proteinLimit.value = '';
      fields.waterLimit.value = '';
      fields.supplement.value = '';
      setSelectedEatingAid([]);
      fields.remarks.value = '';
      setStatus('入力内容を初期化しました。', false);
    });
  }

  async function submitMeal(openPrint) {
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
      startDate: fields.startDate.value.trim(),
      startMeal: fields.startMeal.value,
      dietType: fields.dietType.value,
      stapleType: fields.stapleType.value,
      stapleAmount: fields.stapleAmount.value,
      sideTexture: fields.sideTexture.value,
      thickener: fields.thickener.value,
      calories: fields.calories.value,
      saltLimit: fields.saltLimit.value,
      proteinLimit: fields.proteinLimit.value.trim(),
      waterLimit: fields.waterLimit.value.trim(),
      supplement: fields.supplement.value.trim(),
      prohibitedFoods: fields.prohibitedFoods.value.trim(),
      eatingAid: getSelectedEatingAid(),
      remarks: fields.remarks.value.trim(),
      parentOrderNumber: parentOrderEl.value.trim(),
      revisionNote: revNoteEl.value.trim()
    };

    if (!payload.patientId || !payload.patientName) {
      setStatus('対象患者を選択または入力してください。', true);
      return;
    }

    setStatus('発行処理中...', false);
    try {
      const res = await fetch('/api/meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.meal) {
        setStatus(data.error || '食事オーダーの発行に失敗しました。', true);
        return;
      }

      const saved = data.meal;
      clearRevisionMode();
      setStatus(`食事オーダー ${saved.orderNumber} を発行しました。`, false);

      if (openPrint) {
        window.open(`/meals/print/${encodeURIComponent(saved.orderNumber)}?autoprint=1`, '_blank');
      }

      if (isEmbed && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'MEAL_ORDER_SAVED', meal: saved }, window.location.origin);
      } else {
        window.location.href = `/meals?patientId=${encodeURIComponent(saved.patientId)}`;
      }
    } catch (err) {
      setStatus(err.message || '通信エラーが発生しました。', true);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitMeal(false);
  });

  const btnPrint = document.getElementById('btnSubmitMealPrint');
  if (btnPrint) {
    btnPrint.addEventListener('click', () => submitMeal(true));
  }

  if (initialRevise) {
    loadOrderForRevision(initialRevise);
  }
})();
