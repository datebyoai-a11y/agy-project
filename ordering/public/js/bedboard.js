'use strict';

(function initBedboardScreen() {
  const deptCode = document.body.dataset.deptCode || 'ward';
  const deptName = document.body.dataset.deptName || '';

  const filterInput = document.getElementById('bbFilterInput');
  const chkShowEmpty = document.getElementById('chkShowEmpty');
  const chkShowHistory = document.getElementById('chkShowHistory');
  const historyPanel = document.getElementById('bbHistoryPanel');
  const statusMsg = document.getElementById('bbStatusMsg');

  // モーダル要素
  const modal = document.getElementById('bbMoveModal');
  const modalTitle = document.getElementById('bbModalTitle');
  const modalError = document.getElementById('bbModalError');
  const modalSummary = document.getElementById('bbModalSummary');
  const moveForm = document.getElementById('bbMoveForm');
  const btnCloseModal = document.getElementById('btnCloseBbModal');
  const btnCancelModal = document.getElementById('btnCancelBbModal');
  const btnSubmitModal = document.getElementById('btnSubmitBbModal');

  const grpAdmitPatient = document.getElementById('grpAdmitPatient');
  const selAdmitPatient = document.getElementById('selAdmitPatient');
  const grpTargetDept = document.getElementById('grpTargetDept');
  const selTargetDept = document.getElementById('selTargetDept');
  const grpTargetBed = document.getElementById('grpTargetBed');
  const selTargetBed = document.getElementById('selTargetBed');
  const inpMoveReason = document.getElementById('inpMoveReason');

  const localEmptyBeds = (() => {
    try {
      const el = document.getElementById('bbEmptyBedsData');
      return JSON.parse((el && el.textContent) || '[]');
    } catch (_) {
      return [];
    }
  })();

  let modalState = {
    mode: '', // 'admit' | 'move' | 'transfer' | 'discharge'
    patientId: '',
    patientName: '',
    bedCode: ''
  };

  function showStatus(msg, isErr) {
    if (!statusMsg) return;
    statusMsg.textContent = msg || '';
    statusMsg.className = `bb-status-msg ${msg ? (isErr ? 'is-err' : 'is-ok') : ''}`;
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

  function applyToggles() {
    document.querySelectorAll('[data-bb-toggle]').forEach((cb) => {
      const grp = cb.getAttribute('data-bb-toggle');
      document.querySelectorAll(`[data-bb-group="${grp}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    });
    if (historyPanel && chkShowHistory) {
      historyPanel.classList.toggle('is-hidden', !chkShowHistory.checked);
    }
  }

  function applyFilters() {
    const kw = (filterInput ? filterInput.value : '').trim().toLowerCase();
    const showEmpty = chkShowEmpty ? chkShowEmpty.checked : true;

    document.querySelectorAll('.bb-room').forEach((roomEl) => {
      let visibleBeds = 0;
      roomEl.querySelectorAll('.bb-bed').forEach((bedEl) => {
        const occupied = bedEl.getAttribute('data-occupied') === '1';
        const search = bedEl.getAttribute('data-search') || '';
        const matchKw = !kw || search.includes(kw);
        const matchEmpty = occupied || (showEmpty && !kw);
        const visible = matchKw && matchEmpty;
        bedEl.classList.toggle('is-hidden', !visible);
        if (visible) visibleBeds += 1;
      });
      roomEl.classList.toggle('is-hidden', visibleBeds === 0);
    });
  }

  document.querySelectorAll('[data-bb-toggle]').forEach((cb) => {
    cb.addEventListener('change', applyToggles);
  });
  if (chkShowHistory) chkShowHistory.addEventListener('change', applyToggles);
  if (chkShowEmpty) chkShowEmpty.addEventListener('change', applyFilters);
  if (filterInput) filterInput.addEventListener('input', applyFilters);

  function populateBedSelect(beds) {
    if (!selTargetBed) return;
    if (!Array.isArray(beds) || beds.length === 0) {
      selTargetBed.innerHTML = '<option value="">空床がありません</option>';
      return;
    }
    selTargetBed.innerHTML = beds
      .map((b) => `<option value="${b.bedCode}">${b.bedCode}（${b.roomNo}号室・${b.roomType}）</option>`)
      .join('');
  }

  async function loadTargetDeptEmptyBeds(targetDept) {
    if (!selTargetBed) return;
    selTargetBed.innerHTML = '<option value="">読み込み中...</option>';
    try {
      const res = await fetch(`/api/bedboard/available-beds?departmentCode=${encodeURIComponent(targetDept)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || '空床一覧の取得に失敗しました。');
      }
      populateBedSelect(data.emptyBeds || []);
    } catch (err) {
      showModalError(err.message);
      selTargetBed.innerHTML = '<option value="">取得エラー</option>';
    }
  }

  if (selTargetDept) {
    selTargetDept.addEventListener('change', () => {
      if (modalState.mode === 'transfer') {
        loadTargetDeptEmptyBeds(selTargetDept.value);
      }
    });
  }

  function closeModal() {
    if (modal) modal.hidden = true;
    showModalError('');
  }

  function openModal(mode, info) {
    modalState = {
      mode,
      patientId: info.patientId || '',
      patientName: info.patientName || '',
      bedCode: info.bedCode || ''
    };
    showModalError('');

    grpAdmitPatient.hidden = mode !== 'admit';
    grpTargetDept.hidden = mode !== 'transfer';
    grpTargetBed.hidden = mode !== 'move' && mode !== 'transfer';

    if (mode === 'admit') {
      modalTitle.textContent = `入床登録（${deptName} ${info.bedCode}）`;
      modalSummary.textContent = `入床先: ${deptName} ベッド ${info.bedCode}`;
      if (selAdmitPatient) selAdmitPatient.value = '';
      inpMoveReason.value = '入床';
      btnSubmitModal.textContent = '入床確定';
      btnSubmitModal.className = 'bb-btn bb-btn--primary';
    } else if (mode === 'move') {
      modalTitle.textContent = `同病棟内 移動（${info.patientName}）`;
      modalSummary.textContent = `対象: [${info.patientId}] ${info.patientName}（現在: ${deptName} ${info.bedCode}）`;
      populateBedSelect(localEmptyBeds);
      inpMoveReason.value = '転床・転室';
      btnSubmitModal.textContent = '移動確定';
      btnSubmitModal.className = 'bb-btn bb-btn--primary';
    } else if (mode === 'transfer') {
      modalTitle.textContent = `他病棟移動（${info.patientName}）`;
      modalSummary.textContent = `対象: [${info.patientId}] ${info.patientName}（現在: ${deptName} ${info.bedCode}）`;
      inpMoveReason.value = '他病棟移動';
      btnSubmitModal.textContent = '他病棟へ移動';
      btnSubmitModal.className = 'bb-btn bb-btn--primary';
      if (selTargetDept && selTargetDept.value) {
        loadTargetDeptEmptyBeds(selTargetDept.value);
      }
    } else if (mode === 'discharge') {
      modalTitle.textContent = `退床処理（${info.patientName}）`;
      modalSummary.textContent = `対象: [${info.patientId}] ${info.patientName}（現在: ${deptName} ${info.bedCode}）→ 外来区分へ変更しベッドを空床にします。`;
      inpMoveReason.value = '退院';
      btnSubmitModal.textContent = '退床確定';
      btnSubmitModal.className = 'bb-btn bb-btn--danger';
    }

    modal.hidden = false;
  }

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

  // 各ベッドの操作ボタンクリック
  document.addEventListener('click', (event) => {
    const admitBtn = event.target.closest('.js-bb-admit');
    if (admitBtn) {
      openModal('admit', { bedCode: admitBtn.dataset.bedCode });
      return;
    }

    const moveBtn = event.target.closest('.js-bb-move');
    if (moveBtn) {
      openModal('move', {
        patientId: moveBtn.dataset.patientId,
        patientName: moveBtn.dataset.patientName,
        bedCode: moveBtn.dataset.bedCode
      });
      return;
    }

    const transferBtn = event.target.closest('.js-bb-transfer');
    if (transferBtn) {
      openModal('transfer', {
        patientId: transferBtn.dataset.patientId,
        patientName: transferBtn.dataset.patientName,
        bedCode: transferBtn.dataset.bedCode
      });
      return;
    }

    const disBtn = event.target.closest('.js-bb-discharge');
    if (disBtn) {
      openModal('discharge', {
        patientId: disBtn.dataset.patientId,
        patientName: disBtn.dataset.patientName,
        bedCode: disBtn.dataset.bedCode
      });
    }
  });

  // モーダル送信
  if (moveForm) {
    moveForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      showModalError('');

      let url = '';
      let payload = {};
      const reason = inpMoveReason ? inpMoveReason.value.trim() : '';

      if (modalState.mode === 'admit') {
        const pid = selAdmitPatient ? selAdmitPatient.value : '';
        if (!pid) {
          showModalError('入床する患者を選択してください。');
          return;
        }
        url = '/api/bedboard/admit';
        payload = { patientId: pid, departmentCode: deptCode, bedCode: modalState.bedCode, reason };
      } else if (modalState.mode === 'move') {
        const targetBed = selTargetBed ? selTargetBed.value : '';
        if (!targetBed) {
          showModalError('移動先ベッドを選択してください。');
          return;
        }
        url = '/api/bedboard/move';
        payload = {
          patientId: modalState.patientId,
          departmentCode: deptCode,
          targetBedCode: targetBed,
          reason
        };
      } else if (modalState.mode === 'transfer') {
        const targetDept = selTargetDept ? selTargetDept.value : '';
        const targetBed = selTargetBed ? selTargetBed.value : '';
        if (!targetDept || !targetBed) {
          showModalError('移動先の病棟と空床ベッドを選択してください。');
          return;
        }
        url = '/api/bedboard/transfer';
        payload = {
          patientId: modalState.patientId,
          targetDepartmentCode: targetDept,
          targetBedCode: targetBed,
          reason
        };
      } else if (modalState.mode === 'discharge') {
        url = '/api/bedboard/discharge';
        payload = { patientId: modalState.patientId, reason };
      } else {
        return;
      }

      btnSubmitModal.disabled = true;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || '移動処理に失敗しました。');
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

  // ドラッグ＆ドロップによる同病棟内ベッド移動
  let dragPatient = null;
  document.querySelectorAll('.bb-bed--occupied[draggable="true"]').forEach((bedEl) => {
    bedEl.addEventListener('dragstart', (event) => {
      dragPatient = {
        patientId: bedEl.dataset.patientId,
        patientName: bedEl.dataset.patientName,
        bedCode: bedEl.dataset.bedCode
      };
      bedEl.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragPatient.patientId);
      }
    });
    bedEl.addEventListener('dragend', () => {
      bedEl.classList.remove('is-dragging');
      dragPatient = null;
      document.querySelectorAll('.bb-bed--empty.is-drop-target').forEach((el) => {
        el.classList.remove('is-drop-target');
      });
    });
  });

  document.querySelectorAll('.bb-bed--empty').forEach((emptyEl) => {
    emptyEl.addEventListener('dragover', (event) => {
      if (!dragPatient) return;
      event.preventDefault();
      emptyEl.classList.add('is-drop-target');
    });
    emptyEl.addEventListener('dragleave', () => {
      emptyEl.classList.remove('is-drop-target');
    });
    emptyEl.addEventListener('drop', async (event) => {
      event.preventDefault();
      emptyEl.classList.remove('is-drop-target');
      if (!dragPatient) return;
      const targetBed = emptyEl.dataset.bedCode;
      if (!targetBed) return;
      const ok = window.confirm(
        `[${dragPatient.patientId}] ${dragPatient.patientName} さんを ${dragPatient.bedCode} → ${targetBed} へ移動しますか？`
      );
      if (!ok) return;
      try {
        const res = await fetch('/api/bedboard/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            patientId: dragPatient.patientId,
            departmentCode: deptCode,
            targetBedCode: targetBed,
            reason: 'ベッドボード移動'
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          showStatus(data.error || '移動に失敗しました。', true);
          return;
        }
        window.location.reload();
      } catch (err) {
        showStatus(err.message || '移動エラーが発生しました。', true);
      }
    });
  });

  applyToggles();
  applyFilters();
})();
