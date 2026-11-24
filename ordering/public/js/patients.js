'use strict';

(function initPatientsPage() {
  const statusEl = document.getElementById('statusMessage');
  const tableBody = document.getElementById('patientsTableBody');
  const filterKeyword = document.getElementById('filterKeyword');
  const filterCategory = document.getElementById('filterCategory');
  const toggleInactive = document.getElementById('toggleInactive');
  const countBadge = document.getElementById('patientCountBadge');

  // モーダル要素
  const modal = document.getElementById('patientModal');
  const modalModeLabel = document.getElementById('modalModeLabel');
  const modalError = document.getElementById('modalError');
  const form = document.getElementById('patientForm');
  const btnOpenCreate = document.getElementById('btnOpenCreateModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnCancelModal = document.getElementById('btnCancelModal');
  const btnSubmitModal = document.getElementById('btnSubmitModal');

  const fPatientId = document.getElementById('mPatientId');
  const fCareCategory = document.getElementById('mCareCategory');
  const fFullName = document.getElementById('mFullName');
  const fKana = document.getElementById('mKana');
  const fBirthDate = document.getElementById('mBirthDate');
  const fAgePreview = document.getElementById('mAgePreview');
  const fGender = document.getElementById('mGender');
  const fWardRoom = document.getElementById('mWardRoom');
  const fBloodType = document.getElementById('mBloodType');
  const fInsuranceType = document.getElementById('mInsuranceType');
  const fPhone = document.getElementById('mPhone');
  const fEmergencyContact = document.getElementById('mEmergencyContact');
  const fAllergies = document.getElementById('mAllergies');
  const fCautions = document.getElementById('mCautions');
  const fNotes = document.getElementById('mNotes');
  const fIsActive = document.getElementById('mIsActive');
  const dxEditorTable = document.getElementById('diagnosisEditorTable');
  const dxEditorBody = document.getElementById('diagnosisEditorBody');
  const btnAddDiagnosisRow = document.getElementById('btnAddDiagnosisRow');

  const DIAGNOSIS_OUTCOMES = (() => {
    try {
      const parsed = JSON.parse((dxEditorTable && dxEditorTable.dataset.outcomes) || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (_) {}
    return ['継続', '治癒', '軽快', '中止', '転院', '死亡'];
  })();

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function appendDiagnosisRow(dx, isPersisted) {
    if (!dxEditorBody) return;
    const item = dx || {};
    const tr = document.createElement('tr');
    tr.className = 'dx-editor-row';
    tr.dataset.diagnosisId = item.diagnosisId || '';
    tr.dataset.persisted = isPersisted ? '1' : '0';

    const outcomeOptions = DIAGNOSIS_OUTCOMES.map(
      (opt) => `<option value="${opt}" ${(item.outcome || '継続') === opt ? 'selected' : ''}>${opt}</option>`
    ).join('');

    tr.innerHTML = `
      <td><input type="text" class="m-input dx-in-name" placeholder="例: 高血圧症"></td>
      <td><input type="date" class="m-input dx-in-start"></td>
      <td><input type="date" class="m-input dx-in-end"></td>
      <td><select class="m-select dx-in-outcome">${outcomeOptions}</select></td>
      <td style="text-align:center;">
        ${
          isPersisted
            ? '<button type="button" class="btn-cell btn-cell--warn js-dx-stop" title="中止日と転帰「中止」を設定">中止</button>'
            : '<button type="button" class="btn-cell btn-cell--sub js-dx-remove">削除</button>'
        }
      </td>`;

    tr.querySelector('.dx-in-name').value = item.name || '';
    tr.querySelector('.dx-in-start').value = item.startDate || (!isPersisted ? todayIso() : '');
    tr.querySelector('.dx-in-end').value = item.endDate || '';
    dxEditorBody.appendChild(tr);
  }

  function renderDiagnosisRows(list) {
    if (!dxEditorBody) return;
    dxEditorBody.innerHTML = '';
    const items = Array.isArray(list) ? list : [];
    items.forEach((dx) => appendDiagnosisRow(dx, true));
  }

  function collectDiagnosisRows() {
    if (!dxEditorBody) return [];
    const rows = Array.from(dxEditorBody.querySelectorAll('tr.dx-editor-row'));
    return rows
      .map((tr) => ({
        diagnosisId: tr.dataset.diagnosisId || '',
        name: (tr.querySelector('.dx-in-name').value || '').trim(),
        startDate: (tr.querySelector('.dx-in-start').value || '').trim(),
        endDate: (tr.querySelector('.dx-in-end').value || '').trim(),
        outcome: (tr.querySelector('.dx-in-outcome').value || '継続').trim()
      }))
      .filter((d) => d.name || d.startDate || d.endDate);
  }

  if (btnAddDiagnosisRow) {
    btnAddDiagnosisRow.addEventListener('click', () => {
      appendDiagnosisRow({ name: '', startDate: todayIso(), endDate: '', outcome: '継続' }, false);
      const inputs = dxEditorBody.querySelectorAll('.dx-in-name');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    });
  }

  if (dxEditorBody) {
    dxEditorBody.addEventListener('click', (event) => {
      const remBtn = event.target.closest('.js-dx-remove');
      if (remBtn) {
        const tr = remBtn.closest('tr.dx-editor-row');
        if (tr) tr.remove();
        return;
      }
      const stopBtn = event.target.closest('.js-dx-stop');
      if (stopBtn) {
        const tr = stopBtn.closest('tr.dx-editor-row');
        if (!tr) return;
        const endInput = tr.querySelector('.dx-in-end');
        const outSelect = tr.querySelector('.dx-in-outcome');
        if (endInput && !endInput.value) endInput.value = todayIso();
        if (outSelect) outSelect.value = '中止';
      }
    });

    dxEditorBody.addEventListener('change', (event) => {
      const outSelect = event.target.closest('.dx-in-outcome');
      if (outSelect) {
        const tr = outSelect.closest('tr.dx-editor-row');
        const endInput = tr ? tr.querySelector('.dx-in-end') : null;
        if (endInput && !endInput.value && ['治癒', '中止', '転院', '死亡'].includes(outSelect.value)) {
          endInput.value = todayIso();
        }
      }
    });
  }

  let modalMode = 'create'; // 'create' | 'edit'
  let editingPatientId = '';

  function showStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `compact-bar__status ${isError ? 'is-err' : 'is-ok'}`;
  }

  function showModalError(msg) {
    if (!modalError) return;
    if (!msg) {
      modalError.hidden = true;
      modalError.textContent = '';
      return;
    }
    modalError.textContent = msg;
    modalError.hidden = false;
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
      throw new Error(data.error || `エラーが発生しました (${res.status})`);
    }
    return data;
  }

  function calcAge(birthDateStr) {
    if (!birthDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(birthDateStr)) return '';
    const [y, m, d] = birthDateStr.split('-').map(Number);
    const today = new Date();
    let age = today.getFullYear() - y;
    const md = today.getMonth() + 1 - m;
    if (md < 0 || (md === 0 && today.getDate() < d)) age -= 1;
    return age >= 0 ? `（${age}歳）` : '';
  }

  function updateAgePreview() {
    if (fAgePreview) {
      fAgePreview.textContent = calcAge(fBirthDate ? fBirthDate.value : '');
    }
  }

  if (fBirthDate) {
    fBirthDate.addEventListener('change', updateAgePreview);
    fBirthDate.addEventListener('input', updateAgePreview);
  }

  function suggestNextPatientId() {
    const ids = Array.from(tableBody.querySelectorAll('tr.patient-row'))
      .map((r) => r.dataset.patientId || '')
      .map((id) => {
        const m = id.match(/^P(\d+)$/i);
        return m ? parseInt(m[1], 10) : 0;
      });
    const maxNum = ids.length > 0 ? Math.max(...ids) : 0;
    return `P${String(maxNum + 1).padStart(4, '0')}`;
  }

  function openCreateModal() {
    modalMode = 'create';
    editingPatientId = '';
    modalModeLabel.textContent = '患者情報 新規登録';
    btnSubmitModal.textContent = '登録';
    showModalError('');

    form.reset();
    fPatientId.readOnly = false;
    fPatientId.value = suggestNextPatientId();
    fCareCategory.value = 'outpatient';
    fGender.value = '男';
    fBloodType.value = '不明';
    fIsActive.checked = true;
    renderDiagnosisRows([]);
    updateAgePreview();

    modal.hidden = false;
    fFullName.focus();
  }

  async function openEditModal(patientId) {
    showModalError('');
    try {
      const { patient } = await apiFetch(`/api/patients/${encodeURIComponent(patientId)}`);
      modalMode = 'edit';
      editingPatientId = patient.patientId;
      modalModeLabel.textContent = `患者情報 編集（${patient.patientId}）`;
      btnSubmitModal.textContent = '更新';

      fPatientId.value = patient.patientId;
      fPatientId.readOnly = true;
      fCareCategory.value = patient.careCategory || 'outpatient';
      fFullName.value = patient.fullName || '';
      fKana.value = patient.kana || '';
      fBirthDate.value = patient.birthDate || '';
      fGender.value = patient.gender || '不明';
      fWardRoom.value = patient.wardRoom || '';
      fBloodType.value = patient.bloodType || '不明';
      fInsuranceType.value = patient.insuranceType || '';
      fPhone.value = patient.phone || '';
      fEmergencyContact.value = patient.emergencyContact || '';
      fAllergies.value = patient.allergies || '';
      if (fCautions) fCautions.value = patient.cautions || '';
      renderDiagnosisRows(patient.diagnoses || []);
      fNotes.value = patient.notes || '';
      fIsActive.checked = patient.isActive !== false;
      updateAgePreview();

      modal.hidden = false;
      fFullName.focus();
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  function closeModal() {
    modal.hidden = true;
    showModalError('');
  }

  if (btnOpenCreate) btnOpenCreate.addEventListener('click', openCreateModal);
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) {
      closeModal();
    }
  });

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showModalError('');

      const payload = {
        patientId: fPatientId.value.trim(),
        careCategory: fCareCategory.value,
        fullName: fFullName.value.trim(),
        kana: fKana.value.trim(),
        birthDate: fBirthDate.value.trim(),
        gender: fGender.value,
        wardRoom: fWardRoom.value.trim(),
        bloodType: fBloodType.value,
        insuranceType: fInsuranceType.value,
        phone: fPhone.value.trim(),
        emergencyContact: fEmergencyContact.value.trim(),
        allergies: fAllergies.value.trim(),
        cautions: fCautions ? fCautions.value.trim() : '',
        diagnoses: collectDiagnosisRows(),
        notes: fNotes.value.trim(),
        isActive: fIsActive.checked
      };

      btnSubmitModal.disabled = true;
      try {
        if (modalMode === 'create') {
          await apiFetch('/api/patients', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        } else {
          await apiFetch(`/api/patients/${encodeURIComponent(editingPatientId)}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
        }
        closeModal();
        window.location.reload();
      } catch (err) {
        showModalError(err.message);
      } finally {
        btnSubmitModal.disabled = false;
      }
    });
  }

  // 列表示・非表示チェックボックス
  document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
    const colKey = cb.getAttribute('data-col-toggle');
    const apply = () => {
      document.querySelectorAll(`[data-col="${colKey}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    };
    cb.addEventListener('change', apply);
    apply();
  });

  // 絞込
  function applyFilters() {
    const kw = (filterKeyword ? filterKeyword.value : '').trim().toLowerCase();
    const cat = filterCategory ? filterCategory.value : '';
    const includeInactive = toggleInactive ? toggleInactive.checked : true;

    let visibleCount = 0;
    tableBody.querySelectorAll('tr.patient-row').forEach((row) => {
      const searchText = row.dataset.search || '';
      const rowCat = row.dataset.category || '';
      const isActive = row.dataset.active === 'true';

      const visible =
        (!kw || searchText.includes(kw)) &&
        (!cat || rowCat === cat) &&
        (includeInactive || isActive);

      row.classList.toggle('is-hidden', !visible);
      if (visible) visibleCount += 1;
    });

    if (countBadge) {
      countBadge.textContent = `${visibleCount}件`;
    }
  }

  [filterKeyword, filterCategory, toggleInactive].forEach((el) => {
    if (!el) return;
    el.addEventListener(el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change', applyFilters);
  });

  // 行アクション（選択 / 編集 / 無効化・有効化 / ダブルクリック編集）
  tableBody.addEventListener('dblclick', (event) => {
    if (event.target.closest('button')) return;
    const row = event.target.closest('tr.patient-row');
    if (row && row.dataset.patientId) {
      openEditModal(row.dataset.patientId);
    }
  });

  tableBody.addEventListener('click', async (event) => {
    const row = event.target.closest('tr.patient-row');
    if (!row) return;
    const patientId = row.dataset.patientId;

    if (event.target.closest('.js-edit-patient')) {
      openEditModal(patientId);
      return;
    }

    const selectBtn = event.target.closest('.js-select-patient');
    if (selectBtn) {
      selectBtn.disabled = true;
      try {
        await apiFetch(`/api/patients/${encodeURIComponent(patientId)}/select`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        window.location.reload();
      } catch (err) {
        showStatus(err.message, true);
        selectBtn.disabled = false;
      }
      return;
    }

    const toggleBtn = event.target.closest('.js-toggle-active');
    if (toggleBtn) {
      const nextActive = row.dataset.active !== 'true';
      toggleBtn.disabled = true;
      try {
        const result = await apiFetch(`/api/patients/${encodeURIComponent(patientId)}/active`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive })
        });
        const active = Boolean(result.patient.isActive);
        row.dataset.active = String(active);
        row.classList.toggle('is-inactive', !active);

        const tag = row.querySelector('.js-state-tag');
        if (tag) {
          tag.textContent = active ? '有効' : '無効';
          tag.className = `state-tag ${active ? 'state-tag--active' : 'state-tag--inactive'} js-state-tag`;
        }
        toggleBtn.textContent = active ? '無効化' : '有効化';
        toggleBtn.className = `btn-cell ${active ? 'btn-cell--warn' : 'btn-cell--sub'} js-toggle-active`;
        showStatus(`患者「${patientId}」を${active ? '有効化' : '無効化'}しました。`, false);
        applyFilters();
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        toggleBtn.disabled = false;
      }
    }
  });

  applyFilters();
})();
