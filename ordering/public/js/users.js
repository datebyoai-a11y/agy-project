'use strict';

(function initUsersPage() {
  const statusEl = document.getElementById('statusMessage');
  const usersTable = document.getElementById('usersTable');
  const usersBody = document.getElementById('usersTableBody');
  const filterKeyword = document.getElementById('filterKeyword');
  const filterRole = document.getElementById('filterRole');
  const filterDept = document.getElementById('filterDept');
  const toggleInactive = document.getElementById('toggleInactive');
  const countBadge = document.getElementById('userCountBadge');

  const currentStaffId = usersTable ? usersTable.dataset.currentStaffId : '';

  function showStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `compact-bar__status ${isError ? 'is-err' : 'is-ok'}`;
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

  // 表示・非表示チェックボックス（列）
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

  // 表示・非表示チェックボックス（セクション）
  document.querySelectorAll('[data-section-toggle]').forEach((cb) => {
    const secKey = cb.getAttribute('data-section-toggle');
    const apply = () => {
      document.querySelectorAll(`[data-section="${secKey}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    };
    cb.addEventListener('change', apply);
    apply();
  });

  // 職種別オーダー表の「発」「実」表示切替
  document.querySelectorAll('[data-perm-col]').forEach((cb) => {
    const permType = cb.getAttribute('data-perm-col');
    const apply = () => {
      document.querySelectorAll(`[data-perm-item="${permType}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    };
    cb.addEventListener('change', apply);
    apply();
  });

  // フィルタリング
  function applyFilters() {
    const kw = (filterKeyword ? filterKeyword.value : '').trim().toLowerCase();
    const role = filterRole ? filterRole.value : '';
    const dept = filterDept ? filterDept.value : '';
    const includeInactive = toggleInactive ? toggleInactive.checked : true;

    let visibleCount = 0;
    usersBody.querySelectorAll('tr.user-row').forEach((row) => {
      const staffId = (row.dataset.staffId || '').toLowerCase();
      const fullName = (row.querySelector('.js-full-name')?.value || '').toLowerCase();
      const rowRole = row.querySelector('.js-role-code')?.value || '';
      const rowDefaultDept = row.querySelector('.js-default-dept')?.value || '';
      const allowedDepts = Array.from(row.querySelectorAll('.js-allowed-dept:checked')).map((i) => i.value);
      const isActive = row.dataset.active === 'true';

      const matchKw = !kw || staffId.includes(kw) || fullName.includes(kw);
      const matchRole = !role || rowRole === role;
      const matchDept = !dept || rowDefaultDept === dept || allowedDepts.includes(dept);
      const matchActive = includeInactive || isActive;

      const visible = matchKw && matchRole && matchDept && matchActive;
      row.classList.toggle('is-hidden', !visible);
      if (visible) visibleCount += 1;
    });

    if (countBadge) {
      countBadge.textContent = `${visibleCount}件`;
    }
  }

  [filterKeyword, filterRole, filterDept, toggleInactive].forEach((el) => {
    if (!el) return;
    el.addEventListener(el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change', applyFilters);
  });

  // 新規行：主所属部署変更時に許可部署へ自動チェック
  const newDefaultDept = document.getElementById('newDefaultDept');
  const newAllowedWrap = document.getElementById('newAllowedDepts');
  if (newDefaultDept && newAllowedWrap) {
    newDefaultDept.addEventListener('change', () => {
      const target = newAllowedWrap.querySelector(`input[value="${newDefaultDept.value}"]`);
      if (target) target.checked = true;
    });
  }

  // 新規ユーザー作成
  const btnCreate = document.getElementById('btnCreateUser');
  if (btnCreate) {
    btnCreate.addEventListener('click', async () => {
      const staffId = document.getElementById('newStaffId')?.value.trim() || '';
      const fullName = document.getElementById('newFullName')?.value.trim() || '';
      const roleCode = document.getElementById('newRoleCode')?.value || '';
      const defaultDepartmentCode = newDefaultDept?.value || '';
      const password = document.getElementById('newPassword')?.value || '';
      const allowedDepartmentCodes = Array.from(
        newAllowedWrap.querySelectorAll('input[type="checkbox"]:checked')
      ).map((cb) => cb.value);

      btnCreate.disabled = true;
      try {
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            staffId,
            fullName,
            roleCode,
            defaultDepartmentCode,
            allowedDepartmentCodes,
            password,
            isActive: true
          })
        });
        showStatus(`ユーザー「${staffId}」を登録しました。再読込します...`, false);
        window.location.reload();
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        btnCreate.disabled = false;
      }
    });
  }

  // 既存行の変更検知・保存・有効/無効切替
  usersBody.addEventListener('change', (event) => {
    const row = event.target.closest('tr.user-row');
    if (!row) return;
    row.classList.add('is-dirty');

    if (event.target.classList.contains('js-default-dept')) {
      const deptVal = event.target.value;
      const matchingCb = row.querySelector(`.js-allowed-dept[value="${deptVal}"]`);
      if (matchingCb) matchingCb.checked = true;
    }
  });

  usersBody.addEventListener('input', (event) => {
    const row = event.target.closest('tr.user-row');
    if (row) row.classList.add('is-dirty');
  });

  usersBody.addEventListener('click', async (event) => {
    const saveBtn = event.target.closest('.js-save-user');
    if (saveBtn) {
      const row = saveBtn.closest('tr.user-row');
      if (!row) return;
      const staffId = row.dataset.staffId;
      const fullName = row.querySelector('.js-full-name')?.value.trim() || '';
      const roleCode = row.querySelector('.js-role-code')?.value || '';
      const defaultDepartmentCode = row.querySelector('.js-default-dept')?.value || '';
      const passwordInput = row.querySelector('.js-password');
      const password = passwordInput ? passwordInput.value : '';
      const allowedDepartmentCodes = Array.from(row.querySelectorAll('.js-allowed-dept:checked')).map((cb) => cb.value);
      const isActive = row.dataset.active === 'true';

      saveBtn.disabled = true;
      try {
        const result = await apiFetch(`/api/users/${encodeURIComponent(staffId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            fullName,
            roleCode,
            defaultDepartmentCode,
            allowedDepartmentCodes,
            password,
            isActive
          })
        });
        // サーバー正規化後の許可部署を反映
        const synced = new Set(result.user.allowedDepartmentCodes || []);
        row.querySelectorAll('.js-allowed-dept').forEach((cb) => {
          cb.checked = synced.has(cb.value);
        });
        if (passwordInput) passwordInput.value = '';
        row.classList.remove('is-dirty');
        showStatus(`ユーザー「${staffId}」を保存しました。`, false);
        applyFilters();
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        saveBtn.disabled = false;
      }
      return;
    }

    const toggleBtn = event.target.closest('.js-toggle-active');
    if (toggleBtn) {
      const row = toggleBtn.closest('tr.user-row');
      if (!row) return;
      const staffId = row.dataset.staffId;
      const nextActive = row.dataset.active !== 'true';

      toggleBtn.disabled = true;
      try {
        const result = await apiFetch(`/api/users/${encodeURIComponent(staffId)}/active`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive })
        });
        const active = Boolean(result.user.isActive);
        row.dataset.active = String(active);
        row.classList.toggle('is-inactive', !active);

        const tag = row.querySelector('.js-state-tag');
        if (tag) {
          tag.textContent = active ? '有効' : '無効';
          tag.className = `state-tag ${active ? 'state-tag--active' : 'state-tag--inactive'} js-state-tag`;
        }
        toggleBtn.textContent = active ? '無効化' : '有効化';
        toggleBtn.className = `btn-cell ${active ? 'btn-cell--warn' : 'btn-cell--sub'} js-toggle-active`;
        if (staffId === currentStaffId && active) {
          toggleBtn.disabled = true;
        }
        showStatus(`ユーザー「${staffId}」を${active ? '有効化' : '無効化'}しました。`, false);
        applyFilters();
      } catch (err) {
        showStatus(err.message, true);
        toggleBtn.disabled = false;
      }
    }
  });

  // 職種別 可能オーダーマトリクス保存
  const matrixTable = document.getElementById('roleOrdersTable');
  const btnSaveMatrix = document.getElementById('btnSaveRoleOrders');
  const btnResetMatrix = document.getElementById('btnResetRoleOrders');

  function applyMatrixToDom(permissions) {
    const map = new Map(permissions.map((p) => [`${p.roleCode}:${p.orderTypeCode}`, p]));
    matrixTable.querySelectorAll('td.matrix-cell').forEach((cell) => {
      const key = `${cell.dataset.roleCode}:${cell.dataset.orderTypeCode}`;
      const p = map.get(key) || { canCreate: false, canExecute: false };
      const c = cell.querySelector('.js-perm-create');
      const e = cell.querySelector('.js-perm-execute');
      if (c) c.checked = Boolean(p.canCreate);
      if (e) e.checked = Boolean(p.canExecute);
    });
  }

  if (matrixTable && btnSaveMatrix) {
    btnSaveMatrix.addEventListener('click', async () => {
      const permissions = Array.from(matrixTable.querySelectorAll('td.matrix-cell')).map((cell) => ({
        roleCode: cell.dataset.roleCode,
        orderTypeCode: cell.dataset.orderTypeCode,
        canCreate: Boolean(cell.querySelector('.js-perm-create')?.checked),
        canExecute: Boolean(cell.querySelector('.js-perm-execute')?.checked)
      }));

      btnSaveMatrix.disabled = true;
      try {
        const result = await apiFetch('/api/role-orders', {
          method: 'PUT',
          body: JSON.stringify({ permissions })
        });
        applyMatrixToDom(result.permissions);
        showStatus('職種別の可能オーダー権限を保存しました。', false);
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        btnSaveMatrix.disabled = false;
      }
    });
  }

  if (matrixTable && btnResetMatrix) {
    btnResetMatrix.addEventListener('click', async () => {
      btnResetMatrix.disabled = true;
      try {
        const result = await apiFetch('/api/role-orders/reset', {
          method: 'POST',
          body: JSON.stringify({})
        });
        applyMatrixToDom(result.permissions);
        showStatus('職種別の可能オーダー権限を初期値に戻しました。', false);
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        btnResetMatrix.disabled = false;
      }
    });
  }

  applyFilters();
})();
