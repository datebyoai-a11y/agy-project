'use strict';

(function initOutpatientReceptionPage() {
  const dateInput = document.getElementById('rcpDateInput');
  const statusFilter = document.getElementById('rcpStatusFilter');
  const keywordInput = document.getElementById('rcpKeywordInput');
  const chkShowCancelled = document.getElementById('chkShowCancelled');
  const tableBody = document.getElementById('receptionTableBody');
  const statusMsg = document.getElementById('rcpStatusMsg');

  // モーダル
  const modal = document.getElementById('receptionModal');
  const modalError = document.getElementById('rcpModalError');
  const form = document.getElementById('receptionForm');
  const btnOpenNew = document.getElementById('btnOpenNewReception');
  const btnCloseModal = document.getElementById('btnCloseRcpModal');
  const btnCancelModal = document.getElementById('btnCancelRcpModal');
  const btnSubmitModal = document.getElementById('btnSubmitRcpModal');

  const fPatientId = document.getElementById('mRcpPatientId');
  const fDate = document.getElementById('mRcpDate');
  const fVisitType = document.getElementById('mRcpVisitType');
  const fClinicDept = document.getElementById('mRcpClinicDept');
  const fDoctor = document.getElementById('mRcpDoctor');
  const fComplaint = document.getElementById('mRcpComplaint');

  function showStatus(msg, isError) {
    if (!statusMsg) return;
    statusMsg.textContent = msg || '';
    statusMsg.className = `rcp-status ${msg ? (isError ? 'is-err' : 'is-ok') : ''}`;
  }

  function showModalError(msg) {
    if (!modalError) return;
    if (!msg) {
      modalError.hidden = true;
      modalError.textContent = '';
    } else {
      modalError.textContent = msg;
      modalError.hidden = false;
    }
  }

  // 日付変更時は該当日の受付一覧へ遷移
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      if (dateInput.value) {
        window.location.href = `/outpatient/reception?date=${encodeURIComponent(dateInput.value)}`;
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
    if (!tableBody) return;
    const kw = (keywordInput ? keywordInput.value : '').trim().toLowerCase();
    const st = statusFilter ? statusFilter.value : '';
    const showCancelled = chkShowCancelled ? chkShowCancelled.checked : true;

    tableBody.querySelectorAll('tr.rcp-row').forEach((row) => {
      const cancelled = row.dataset.cancelled === 'true';
      const rowStatus = row.dataset.status || '';
      const search = row.dataset.search || '';
      const visible =
        (showCancelled || !cancelled) &&
        (!st || rowStatus === st) &&
        (!kw || search.includes(kw));
      row.classList.toggle('is-hidden', !visible);
    });
  }

  if (statusFilter) statusFilter.addEventListener('change', applyFilters);
  if (keywordInput) keywordInput.addEventListener('input', applyFilters);
  if (chkShowCancelled) chkShowCancelled.addEventListener('change', applyFilters);

  // モーダル制御
  function openModal() {
    showModalError('');
    if (form) form.reset();
    if (fDate && dateInput && dateInput.value) fDate.value = dateInput.value;
    modal.hidden = false;
    if (fPatientId) fPatientId.focus();
  }

  function closeModal() {
    modal.hidden = true;
    showModalError('');
  }

  if (btnOpenNew) btnOpenNew.addEventListener('click', openModal);
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) closeModal();
  });

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showModalError('');
      const payload = {
        patientId: fPatientId.value,
        visitDate: fDate.value,
        visitType: fVisitType.value,
        clinicDepartment: fClinicDept.value,
        assignedDoctor: fDoctor.value,
        chiefComplaint: fComplaint.value.trim()
      };
      if (!payload.patientId) {
        showModalError('対象患者を選択してください。');
        return;
      }

      btnSubmitModal.disabled = true;
      try {
        const res = await fetch('/api/outpatient-receptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || '外来受付登録に失敗しました。');
        }
        closeModal();
        window.location.href = `/outpatient/reception?date=${encodeURIComponent(payload.visitDate)}`;
      } catch (err) {
        showModalError(err.message);
      } finally {
        btnSubmitModal.disabled = false;
      }
    });
  }

  // 行内アクション（ステータス遷移・取消）
  if (tableBody) {
    tableBody.addEventListener('click', async (event) => {
      const row = event.target.closest('tr.rcp-row');
      if (!row) return;
      const receptionNumber = row.dataset.receptionNumber;

      const statusBtn = event.target.closest('.js-rcp-status');
      if (statusBtn) {
        const nextStatus = statusBtn.dataset.next;
        statusBtn.disabled = true;
        try {
          const res = await fetch(`/api/outpatient-receptions/${encodeURIComponent(receptionNumber)}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ status: nextStatus })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) {
            throw new Error(data.error || 'ステータス更新に失敗しました。');
          }
          window.location.reload();
        } catch (err) {
          showStatus(err.message, true);
          statusBtn.disabled = false;
        }
        return;
      }

      const cancelBtn = event.target.closest('.js-rcp-cancel');
      if (cancelBtn) {
        const reason = window.prompt(`受付 ${receptionNumber} に取消フラグを設定します。理由を入力してください:`, '患者都合によりキャンセル');
        if (reason === null) return;
        cancelBtn.disabled = true;
        try {
          const res = await fetch(`/api/outpatient-receptions/${encodeURIComponent(receptionNumber)}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ reason })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) {
            throw new Error(data.error || '取消処理に失敗しました。');
          }
          window.location.reload();
        } catch (err) {
          showStatus(err.message, true);
          cancelBtn.disabled = false;
        }
      }
    });
  }

  applyFilters();
})();
