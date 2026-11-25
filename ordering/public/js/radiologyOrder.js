'use strict';

(function initRadiologyOrderPage() {
  const statusEl = document.getElementById('statusMessage');
  const grid = document.getElementById('radGrid');
  const form = document.getElementById('radOrderForm');
  const patientPicker = document.getElementById('patientPicker');
  const slipColorbar = document.getElementById('slipColorbar');

  const fFormType = document.getElementById('fFormType');
  const fParentOrderNumber = document.getElementById('fParentOrderNumber');
  const fRevisionNote = document.getElementById('fRevisionNote');
  const revisionBanner = document.getElementById('revisionBanner');
  const revisionParentLabel = document.getElementById('revisionParentLabel');
  const btnCancelRevision = document.getElementById('btnCancelRevision');

  const fPatientId = document.getElementById('fPatientId');
  const fPatientName = document.getElementById('fPatientName');
  const fPatientKana = document.getElementById('fPatientKana');
  const fBirthDate = document.getElementById('fBirthDate');
  const fAge = document.getElementById('fAge');
  const fGender = document.getElementById('fGender');
  const fWard = document.getElementById('fWard');
  const fSourceDept = document.getElementById('fSourceDept');
  const fRoom = document.getElementById('fRoom');
  const isEmbed = document.body.dataset.embed === '1';
  const initialReviseOrder = document.body.dataset.revise || '';
  const initialPreset = document.body.dataset.preset || '';
  const fSchedDate = document.getElementById('fSchedDate');
  const fSchedTime = document.getElementById('fSchedTime');
  const fDoctorName = document.getElementById('fDoctorName');
  const fMobility = document.getElementById('fMobility');
  const fInfection = document.getElementById('fInfection');
  const fInfectionNote = document.getElementById('fInfectionNote');
  const fIsUrgent = document.getElementById('fIsUrgent');
  const fHeight = document.getElementById('fHeight');
  const fWeight = document.getElementById('fWeight');
  const fRequestDept = document.getElementById('fRequestDept');
  const fCtContrast = document.getElementById('fCtContrast');
  const fXrayDvd = document.getElementById('fXrayDvd');

  const ALLERGY_EMPTY_PAT = /^(なし|無し|無|none|-|ー|―|特になし)$/i;
  function syncAllergyPresetStyle(el) {
    if (!el) return;
    const val = String(el.value || '').trim();
    const isAlert = Boolean(val && !ALLERGY_EMPTY_PAT.test(val));
    el.classList.toggle('is-allergy-alert', isAlert);
  }
  function syncAllAllergyPresets() {
    document.querySelectorAll('.js-allergy-preset').forEach(syncAllergyPresetStyle);
  }
  document.querySelectorAll('.js-allergy-preset').forEach((el) => {
    el.addEventListener('input', () => syncAllergyPresetStyle(el));
    syncAllergyPresetStyle(el);
  });

  function showStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `status-msg ${isError ? 'is-err' : 'is-ok'}`;
  }

  async function apiFetch(url, options) {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `エラー (${res.status})`);
    }
    return data;
  }

  function setNowDateTime() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    if (fSchedDate && !fSchedDate.value) fSchedDate.value = `${y}-${m}-${d}`;
    if (fSchedTime && !fSchedTime.value) fSchedTime.value = `${hh}:${mm}`;
  }

  // 丸囲みトグル共通
  function setCircleValue(groupName, value) {
    const group = document.querySelector(`[data-circle-group="${groupName}"]`);
    if (!group) return;
    group.querySelectorAll('.c-opt').forEach((btn) => {
      btn.classList.toggle('is-sel', btn.dataset.val === value);
    });
    if (groupName === 'gender') fGender.value = value;
    if (groupName === 'ward') fWard.value = value;
    if (groupName === 'mobility') fMobility.value = value;
    if (groupName === 'infection') {
      fInfection.value = value;
      if (value === '無' && fInfectionNote) fInfectionNote.value = '';
    }
    if (groupName === 'ctContrast') {
      fCtContrast.value = value;
      const meds = document.getElementById('fCtMedications');
      if (value === '造影' && meds && !meds.value) {
        meds.value = 'イオパミロン注300 (100mL)、生理食塩水';
        const p2 = document.querySelector('input[name="ctDynamic"][value="2phase"]');
        if (p2) p2.checked = true;
      }
    }
    if (groupName === 'xrayDvd') fXrayDvd.value = value;
  }

  document.querySelectorAll('[data-circle-group]').forEach((group) => {
    const name = group.getAttribute('data-circle-group');
    group.addEventListener('click', (event) => {
      const btn = event.target.closest('.c-opt');
      if (!btn) return;
      setCircleValue(name, btn.dataset.val);
    });
  });

  if (fInfectionNote) {
    fInfectionNote.addEventListener('input', () => {
      if (fInfectionNote.value.trim()) {
        setCircleValue('infection', '有');
      }
    });
  }

  // 様式タブ切替
  function switchFormType(type) {
    fFormType.value = type;
    document.querySelectorAll('[data-form-tab]').forEach((btn) => {
      const active = btn.getAttribute('data-form-tab') === type;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-form-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-form-panel') !== type;
    });
    if (slipColorbar) {
      slipColorbar.className = `slip-colorbar slip-colorbar--${type.toLowerCase()}`;
    }
  }

  document.querySelectorAll('[data-form-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchFormType(btn.getAttribute('data-form-tab')));
  });

  // 表示項目チェックボックス（ペイン・入力項目・過去記載項目）
  document.querySelectorAll('[data-pane-toggle]').forEach((cb) => {
    const key = cb.getAttribute('data-pane-toggle');
    const apply = () => {
      const pane = document.querySelector(`[data-pane="${key}"]`);
      if (pane) pane.classList.toggle('is-hidden', !cb.checked);
      if (grid) grid.classList.toggle(`hide-${key}`, !cb.checked);
    };
    cb.addEventListener('change', apply);
    apply();
  });

  document.querySelectorAll('[data-field-toggle]').forEach((cb) => {
    const key = cb.getAttribute('data-field-toggle');
    const apply = () => {
      document.querySelectorAll(`[data-field-group="${key}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    };
    cb.addEventListener('change', apply);
    apply();
  });

  document.querySelectorAll('[data-hist-toggle]').forEach((cb) => {
    const key = cb.getAttribute('data-hist-toggle');
    const apply = () => {
      document.querySelectorAll(`[data-hist-item="${key}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    };
    cb.addEventListener('change', apply);
    apply();
  });

  const toggleHistInactive = document.getElementById('toggleHistoryInactive');
  if (toggleHistInactive) {
    const applyHistFilter = () => {
      document.querySelectorAll('.hist-item[data-flagged="true"]').forEach((el) => {
        el.classList.toggle('is-hidden', !toggleHistInactive.checked);
      });
    };
    toggleHistInactive.addEventListener('change', applyHistFilter);
    applyHistFilter();
  }

  // 患者選択変更時はクエリ付きで再読込（過去履歴＆ステータスバーも連動）
  if (patientPicker) {
    patientPicker.addEventListener('change', () => {
      const pid = patientPicker.value;
      if (pid) {
        window.location.href = `/radiology?patientId=${encodeURIComponent(pid)}`;
      } else {
        window.location.href = '/radiology';
      }
    });
  }

  // ツリーのプリセット適用
  function clearModalityInputs() {
    form.querySelectorAll('input[name="ctParts"], input[name="ctDynamic"], input[name="fluoroExam"], input[name="fluoroMed"], input[name="xrayParts"]').forEach((cb) => {
      cb.checked = false;
    });
    ['fCtPartsDetail', 'fCtMedications', 'fCtPurpose', 'fFluoroOther', 'fFluoroMaterials', 'fFluoroPurpose', 'fXrayFree1', 'fXrayFree2', 'fXrayPurpose'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const portCb = document.getElementById('fIsPortable');
    if (portCb) portCb.checked = false;
  }

  function applyPreset(preset) {
    if (!preset) return;
    clearModalityInputs();
    setNowDateTime();

    if (preset === 'ct:chest') {
      switchFormType('CT');
      setCircleValue('ctContrast', '単純');
      const c = form.querySelector('input[name="ctParts"][value="胸部 (肺・横隔)"]');
      if (c) c.checked = true;
      document.getElementById('fCtPurpose').value = '発熱・咳嗽持続のため肺炎疑い、胸部精査';
    } else if (preset === 'ct:abdo') {
      switchFormType('CT');
      setCircleValue('ctContrast', '造影');
      ['腹部 (肝・胆・膵・腎)', '骨盤腔'].forEach((v) => {
        const c = form.querySelector(`input[name="ctParts"][value="${v}"]`);
        if (c) c.checked = true;
      });
      document.getElementById('fCtPurpose').value = '腹痛・肝胆膵病変精査のため腹部骨盤造影CT';
    } else if (preset === 'ct:head') {
      switchFormType('CT');
      setCircleValue('ctContrast', '単純');
      const c = form.querySelector('input[name="ctParts"][value="頭部"]');
      if (c) c.checked = true;
      document.getElementById('fCtPurpose').value = '転倒・頭部打撲後の頭蓋内出血否定、精査';
    } else if (preset === 'fluoro:peg') {
      switchFormType('FLUORO');
      const e = form.querySelector('input[name="fluoroExam"][value="PEG交換"]');
      if (e) e.checked = true;
      ['ガストログラフィン 20ml', 'キシロカインゼリー2% 10ml'].forEach((v) => {
        const m = form.querySelector(`input[name="fluoroMed"][value="${v}"]`);
        if (m) m.checked = true;
      });
      document.getElementById('fFluoroMaterials').value = 'ガストロボタン 24Fr 3.5cm、交換用シリンジ、滅菌ガーゼ';
      document.getElementById('fFluoroPurpose').value = '定期PEGチューブ交換、胃内留置位置の造影確認';
    } else if (preset === 'fluoro:vf') {
      switchFormType('FLUORO');
      const e = form.querySelector('input[name="fluoroExam"][value="VF検査"]');
      if (e) e.checked = true;
      const m = form.querySelector('input[name="fluoroMed"][value="硫酸バリウム散98.8%ホリイ 300g"]');
      if (m) m.checked = true;
      document.getElementById('fFluoroMaterials').value = '嚥下食、トロミ水、バリウム液';
      document.getElementById('fFluoroPurpose').value = '誤嚥・嚥下障害の評価、嚥下造影検査(VF)';
    } else if (preset === 'fluoro:gi') {
      switchFormType('FLUORO');
      const e = form.querySelector('input[name="fluoroExam"][value="消化管造影検査"]');
      if (e) e.checked = true;
      const m = form.querySelector('input[name="fluoroMed"][value="ガストログラフィン 20ml"]');
      if (m) m.checked = true;
      document.getElementById('fFluoroPurpose').value = '通過障害・消化管造影評価';
    } else if (preset === 'xray:chest') {
      switchFormType('XRAY');
      const p = form.querySelector('input[name="xrayParts"][value="① 胸部 (立位 PA / 側面 R-L)"]');
      if (p) p.checked = true;
      document.getElementById('fXrayPurpose').value = '経過観察、胸水・気胸・心拡大の有無確認';
    } else if (preset === 'xray:portable_chest') {
      switchFormType('XRAY');
      const p = form.querySelector('input[name="xrayParts"][value="① 胸部 (立位 PA / 側面 R-L)"]');
      if (p) p.checked = true;
      document.getElementById('fIsPortable').checked = true;
      document.getElementById('fPortableRoom').value = fRoom.value || '';
      setCircleValue('mobility', 'ベッド');
      document.getElementById('fXrayPurpose').value = '病室ポータブル胸部撮影（肺炎・胸水・チューブ位置確認）';
    } else if (preset === 'xray:abdo') {
      switchFormType('XRAY');
      const p = form.querySelector('input[name="xrayParts"][value="② 腹部 (立位 / 臥位)"]');
      if (p) p.checked = true;
      document.getElementById('fXrayPurpose').value = '腹痛・イレウス疑い、ニボー像・フリーエア確認';
    } else if (preset === 'xray:lumbar') {
      switchFormType('XRAY');
      const p = form.querySelector('input[name="xrayParts"][value="③ 腰椎 (正面 / 側面)"]');
      if (p) p.checked = true;
      document.getElementById('fXrayPurpose').value = '腰痛精査、圧迫骨折・変形性脊椎症の確認';
    }
    showStatus('プリセットを適用しました。', false);
  }

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyPreset(btn.getAttribute('data-preset'));
    });
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'APPLY_RADIOLOGY_PRESET' && event.data.preset) {
      applyPreset(event.data.preset);
    }
  });

  // 訂正再発行モード
  function clearRevisionMode() {
    fParentOrderNumber.value = '';
    if (fRevisionNote) fRevisionNote.value = '';
    if (revisionBanner) revisionBanner.hidden = true;
  }

  if (btnCancelRevision) {
    btnCancelRevision.addEventListener('click', clearRevisionMode);
  }

  async function loadOrderForRevision(orderNum) {
    try {
      const { order } = await apiFetch(`/api/radiology-orders/${encodeURIComponent(orderNum)}`);
      clearModalityInputs();
      switchFormType(order.formType || 'CT');

      fParentOrderNumber.value = order.orderNumber;
      revisionParentLabel.textContent = order.orderNumber;
      revisionBanner.hidden = false;

      fPatientId.value = order.patientId || '';
      fPatientName.value = order.patientName || '';
      fPatientKana.value = order.patientKana || '';
      fBirthDate.value = order.birthDate || '';
      fAge.value = order.age != null ? String(order.age) : '';
      fRoom.value = order.room || '';
      fDoctorName.value = order.doctorName || fDoctorName.value;
      fHeight.value = order.height || '';
      fWeight.value = order.weight || '';
      fRequestDept.value = order.requestDepartment || '内科';
      fIsUrgent.checked = Boolean(order.isUrgent);

      setCircleValue('gender', order.gender || '男');
      setCircleValue('ward', order.ward === '病棟' ? '医療病棟' : (order.ward || '外来'));
      setCircleValue('mobility', order.mobility || '徒歩');
      if (order.infection && order.infection !== '無') {
        setCircleValue('infection', '有');
        fInfectionNote.value = order.infection === '有' ? '' : order.infection;
      } else {
        setCircleValue('infection', '無');
      }

      if (order.formType === 'CT') {
        setCircleValue('ctContrast', order.contrast || '単純');
        (order.parts || []).forEach((pt) => {
          const cb = form.querySelector(`input[name="ctParts"][value="${pt}"]`);
          if (cb) cb.checked = true;
        });
        document.getElementById('fCtPartsDetail').value = order.partsDetail || '';
        document.getElementById('fCtMedications').value = order.medications || '';
        document.getElementById('fCtKv').value = order.conditionKv || '';
        document.getElementById('fCtMa').value = order.conditionMa || '';
        document.getElementById('fCtSec').value = order.conditionSec || '';
        document.getElementById('fCtPurpose').value = order.purpose || '';
        document.getElementById('fCtRemarks').value = order.remarks || '';
      } else if (order.formType === 'FLUORO') {
        (order.parts || []).forEach((pt) => {
          const cb = form.querySelector(`input[name="fluoroExam"][value="${pt}"]`);
          if (cb) cb.checked = true;
        });
        document.getElementById('fFluoroMaterials').value = order.materials || '';
        document.getElementById('fFluoroPurpose').value = order.purpose || '';
        document.getElementById('fFluoroRemarks').value = order.remarks || '';
      } else {
        (order.parts || []).forEach((pt) => {
          const cb = form.querySelector(`input[name="xrayParts"][value="${pt}"]`);
          if (cb) cb.checked = true;
        });
        document.getElementById('fXrayFree1').value = order.partsDetail || '';
        document.getElementById('fIsPortable').checked = Boolean(order.isPortable);
        document.getElementById('fPortableRoom').value = order.portableRoom || order.room || '';
        document.getElementById('fXrayKv').value = order.conditionKv || '';
        document.getElementById('fXrayMa').value = order.conditionMa || '';
        document.getElementById('fXraySec').value = order.conditionSec || '';
        document.getElementById('fXrayPurpose').value = order.purpose || '';
        document.getElementById('fXrayRemarks').value = order.remarks || '';
        setCircleValue('xrayDvd', order.mediaDvd || '未');
      }

      syncAllAllergyPresets();
      showStatus(`オーダー ${order.orderNumber} を訂正再発行用に読み込みました。`, false);
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  document.getElementById('pastOrdersList')?.addEventListener('click', async (event) => {
    const revBtn = event.target.closest('.js-revise-order');
    if (revBtn) {
      await loadOrderForRevision(revBtn.dataset.orderNumber);
      return;
    }

    const cancelBtn = event.target.closest('.js-cancel-order');
    if (cancelBtn) {
      const orderNum = cancelBtn.dataset.orderNumber;
      const reason = window.prompt(`オーダー ${orderNum} に中止フラグを設定します。理由を入力してください:`, '医師指示により中止');
      if (reason === null) return;
      try {
        await apiFetch(`/api/radiology-orders/${encodeURIComponent(orderNum)}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });
        window.location.reload();
      } catch (err) {
        showStatus(err.message, true);
      }
    }
  });

  // フォーム送信ペイロード構築
  function collectPayload() {
    const type = fFormType.value;
    const schedStr = fSchedDate.value
      ? `${fSchedDate.value}T${fSchedTime.value || '09:00'}`
      : new Date().toISOString();

    const infectionVal =
      fInfection.value === '有'
        ? (fInfectionNote.value.trim() || '有')
        : '無';

    const base = {
      formType: type,
      parentOrderNumber: fParentOrderNumber.value.trim(),
      revisionNote: fRevisionNote ? fRevisionNote.value.trim() : '',
      scheduledDate: schedStr,
      patientId: fPatientId.value.trim(),
      patientName: fPatientName.value.trim(),
      patientKana: fPatientKana.value.trim(),
      birthDate: fBirthDate.value.trim(),
      age: fAge.value,
      gender: fGender.value,
      ward: fWard.value,
      sourceDepartment: fSourceDept ? fSourceDept.value : '',
      room: fRoom.value.trim(),
      doctorName: fDoctorName.value.trim(),
      mobility: fMobility.value,
      infection: infectionVal,
      isUrgent: fIsUrgent.checked,
      height: fHeight.value.trim(),
      weight: fWeight.value.trim(),
      requestDepartment: fRequestDept.value.trim()
    };

    if (type === 'CT') {
      const parts = Array.from(form.querySelectorAll('input[name="ctParts"]:checked')).map((c) => c.value);
      const partNotes = Array.from(form.querySelectorAll('.js-ct-part-note'))
        .map((inp) => (inp.value.trim() ? `${inp.dataset.part}:${inp.value.trim()}` : ''))
        .filter(Boolean);
      const otherDetail = document.getElementById('fCtPartsDetail')?.value.trim() || '';
      if (otherDetail) partNotes.push(otherDetail);
      const dynamicPhase = Array.from(form.querySelectorAll('input[name="ctDynamic"]:checked')).map((c) => c.value).join(', ');
      return {
        ...base,
        contrast: fCtContrast.value,
        dynamicPhase,
        parts,
        partsDetail: partNotes.join(' / '),
        medications: document.getElementById('fCtMedications')?.value.trim() || '',
        conditionKv: document.getElementById('fCtKv')?.value.trim() || '',
        conditionMa: document.getElementById('fCtMa')?.value.trim() || '',
        conditionSec: document.getElementById('fCtSec')?.value.trim() || '',
        elecImgAdd: Boolean(document.getElementById('fCtElecImg')?.checked),
        purpose: document.getElementById('fCtPurpose')?.value.trim() || '',
        remarks: document.getElementById('fCtRemarks')?.value.trim() || ''
      };
    }

    if (type === 'FLUORO') {
      const parts = Array.from(form.querySelectorAll('input[name="fluoroExam"]:checked')).map((c) => c.value);
      const other = document.getElementById('fFluoroOther')?.value.trim() || '';
      const meds = Array.from(form.querySelectorAll('input[name="fluoroMed"]:checked')).map((c) => c.value);
      return {
        ...base,
        contrast: '造影',
        parts,
        partsDetail: other,
        medications: meds.join(', '),
        materials: document.getElementById('fFluoroMaterials')?.value.trim() || '',
        purpose: document.getElementById('fFluoroPurpose')?.value.trim() || '',
        remarks: document.getElementById('fFluoroRemarks')?.value.trim() || ''
      };
    }

    // XRAY
    const parts = Array.from(form.querySelectorAll('input[name="xrayParts"]:checked')).map((c) => c.value);
    const freeParts = [
      document.getElementById('fXrayFree1')?.value.trim() || '',
      document.getElementById('fXrayFree2')?.value.trim() || ''
    ].filter(Boolean);
    return {
      ...base,
      contrast: '単純',
      parts,
      partsDetail: freeParts.join(' / '),
      isPortable: Boolean(document.getElementById('fIsPortable')?.checked),
      portableRoom: document.getElementById('fPortableRoom')?.value.trim() || '',
      conditionKv: document.getElementById('fXrayKv')?.value.trim() || '',
      conditionMa: document.getElementById('fXrayMa')?.value.trim() || '',
      conditionSec: document.getElementById('fXraySec')?.value.trim() || '',
      mediaDvd: fXrayDvd.value,
      elecImgAdd: Boolean(document.getElementById('fXrayElecImg')?.checked),
      purpose: document.getElementById('fXrayPurpose')?.value.trim() || '',
      remarks: document.getElementById('fXrayRemarks')?.value.trim() || ''
    };
  }

  async function submitOrder(openPrint) {
    const payload = collectPayload();
    if (!payload.patientId || !payload.patientName) {
      showStatus('対象患者（ID・氏名）を入力または選択してください。', true);
      fPatientId.focus();
      return;
    }

    const btnSave = document.getElementById('btnSubmitSave');
    const btnPrint = document.getElementById('btnSubmitPrint');
    if (btnSave) btnSave.disabled = true;
    if (btnPrint) btnPrint.disabled = true;

    try {
      const { order } = await apiFetch('/api/radiology-orders', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (openPrint && order && order.orderNumber) {
        window.open(`/radiology/print/${encodeURIComponent(order.orderNumber)}?autoprint=1`, '_blank');
      }
      if (isEmbed && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'RADIOLOGY_ORDER_SAVED', order }, window.location.origin);
        clearModalityInputs();
        clearRevisionMode();
        showStatus(`オーダー ${order.orderNumber} を発行しました。`, false);
        if (btnSave) btnSave.disabled = false;
        if (btnPrint) btnPrint.disabled = false;
        return;
      }
      window.location.href = `/radiology?patientId=${encodeURIComponent(order.patientId)}`;
    } catch (err) {
      showStatus(err.message, true);
      if (btnSave) btnSave.disabled = false;
      if (btnPrint) btnPrint.disabled = false;
    }
  }

  document.getElementById('btnSubmitSave')?.addEventListener('click', () => submitOrder(false));
  document.getElementById('btnSubmitPrint')?.addEventListener('click', () => submitOrder(true));
  document.getElementById('btnResetOrder')?.addEventListener('click', () => {
    clearModalityInputs();
    clearRevisionMode();
    showStatus('入力内容をクリアしました。', false);
  });

  setNowDateTime();
  if (initialReviseOrder) {
    loadOrderForRevision(initialReviseOrder);
  } else if (initialPreset) {
    applyPreset(initialPreset);
  }
})();
