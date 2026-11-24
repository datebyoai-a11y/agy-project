'use strict';

(function initMedicinesPage() {
  const grid = document.getElementById('medGrid');
  const searchInput = document.getElementById('medSearchInput');
  const filterCategory = document.getElementById('filterCategory');
  const filterBrand = document.getElementById('filterBrand');
  const filterAdopt = document.getElementById('filterAdopt');
  const filterSuspension = document.getElementById('filterSuspension');
  const filterCrush = document.getElementById('filterCrush');
  const btnReset = document.getElementById('btnResetFilters');
  const btnTreeAll = document.getElementById('btnTreeAll');
  const treeList = document.getElementById('categoryTreeList');
  const activeTreeCrumb = document.getElementById('activeTreeCrumb');
  const countBadge = document.getElementById('medCountBadge');
  const statusEl = document.getElementById('medStatusMsg');
  const tableBody = document.getElementById('medicinesTableBody');
  const detailHeader = document.getElementById('detailHeaderLabel');
  const detailBody = document.getElementById('drugDetailBody');
  const btnCopyDrug = document.getElementById('btnCopyDrug');

  let selectedMajor = '';
  let selectedMiddle = '';
  let selectedDrugId = '';
  let selectedMedicine = null;
  let currentMedicines = [];
  let sortKey = 'drugId';
  let sortOrder = 'asc';
  let debounceTimer = null;

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

  function okMarkHtml(val) {
    const cls = val === '〇' ? 'ok' : val === '△' ? 'tri' : val === '×' ? 'ng' : 'none';
    return `<span class="ok-mark ok-mark--${cls}">${esc(val || '-')}</span>`;
  }

  function applyVisibilityToggles() {
    document.querySelectorAll('[data-pane-toggle]').forEach((cb) => {
      const key = cb.getAttribute('data-pane-toggle');
      const pane = document.querySelector(`[data-pane="${key}"]`);
      if (pane) pane.classList.toggle('is-hidden', !cb.checked);
      if (grid) grid.classList.toggle(`hide-${key}`, !cb.checked);
    });

    document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
      const colKey = cb.getAttribute('data-col-toggle');
      document.querySelectorAll(`[data-col="${colKey}"]`).forEach((el) => {
        el.classList.toggle('is-hidden', !cb.checked);
      });
    });
  }

  function renderTable(list) {
    if (!tableBody) return;
    if (!list || list.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="11" class="empty-msg">該当する薬剤が見つかりません。</td></tr>';
      applyVisibilityToggles();
      return;
    }

    const sorted = [...list].sort((a, b) => {
      const va = String(a[sortKey] || '');
      const vb = String(b[sortKey] || '');
      const cmp = va.localeCompare(vb, 'ja');
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    tableBody.innerHTML = sorted
      .map((m) => {
        const catCls = m.category === '内服薬' ? 'oral' : m.category === '注射剤' ? 'inj' : 'ext';
        const catShort = m.category === '内服薬' ? '内服' : m.category === '注射剤' ? '注射' : '外用';
        const brandCls = m.brandType === '先発' ? 'orig' : 'gen';
        const adoptCls = m.adoptType === '採用' ? 'ok' : m.adoptType === '限定' ? 'lim' : 'del';
        const isSel = m.drugId === selectedDrugId;

        return `
          <tr class="med-row ${m.adoptType === '削除' ? 'is-deleted' : ''} ${isSel ? 'is-selected' : ''}" data-drug-id="${esc(m.drugId)}">
            <td class="cell-id"><code>${esc(m.drugId)}</code></td>
            <td class="cell-center"><span class="cat-tag cat-tag--${catCls}">${catShort}</span></td>
            <td class="cell-name">${esc(m.name)}</td>
            <td class="cell-generic" data-col="generic">${esc(m.genericName || '-')}</td>
            <td class="cell-nowrap">${esc(m.spec || '-')}${m.unit ? ` / ${esc(m.unit)}` : ''}</td>
            <td class="cell-usage" data-col="usage">${esc(m.standardUsage || m.dosage || '-')}</td>
            <td class="cell-flag" data-col="handling">${okMarkHtml(m.suspensionOk)}</td>
            <td class="cell-flag" data-col="handling">${okMarkHtml(m.crushOk)}</td>
            <td class="cell-flag" data-col="handling">${okMarkHtml(m.uncapsuleOk)}</td>
            <td class="cell-center" data-col="brand"><span class="brand-tag brand-tag--${brandCls}">${esc(m.brandType || '-')}</span></td>
            <td class="cell-center" data-col="adopt"><span class="adopt-tag adopt-tag--${adoptCls}">${esc(m.adoptType || '-')}</span></td>
          </tr>`;
      })
      .join('');

    applyVisibilityToggles();
  }

  async function fetchMedicines() {
    try {
      const params = new URLSearchParams({
        q: searchInput ? searchInput.value.trim() : '',
        category: filterCategory ? filterCategory.value : '',
        majorCategory: selectedMajor,
        middleCategory: selectedMiddle,
        brandType: filterBrand ? filterBrand.value : '',
        adoptType: filterAdopt ? filterAdopt.value : 'ACTIVE',
        suspensionOk: filterSuspension ? filterSuspension.value : '',
        crushOk: filterCrush ? filterCrush.value : ''
      });

      const res = await fetch(`/api/medicines?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '検索エラー');

      currentMedicines = data.medicines || [];
      renderTable(currentMedicines);
      if (countBadge) {
        const totalText = countBadge.textContent.split('/')[1] || '';
        countBadge.textContent = `${data.count}件${totalText ? ' /' + totalText : ''}`;
      }
      showStatus('', false);
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  function renderRelatedSection(title, items) {
    if (!items || items.length === 0) return '';
    return `
      <div class="related-box">
        <div class="related-box__head">${esc(title)}（${items.length}件）</div>
        <ul class="related-list">
          ${items
            .map(
              (r) => `
            <li>
              <button type="button" class="related-btn js-pick-related" data-drug-id="${esc(r.drugId)}">
                <span><strong>${esc(r.name)}</strong></span>
                <span>
                  <span class="brand-tag brand-tag--${r.brandType === '先発' ? 'orig' : 'gen'}">${esc(r.brandType || '-')}</span>
                  <span class="adopt-tag adopt-tag--${r.adoptType === '採用' ? 'ok' : r.adoptType === '限定' ? 'lim' : 'del'}">${esc(r.adoptType || '-')}</span>
                </span>
              </button>
            </li>`
            )
            .join('')}
        </ul>
      </div>`;
  }

  async function loadDetail(drugId) {
    if (!drugId) return;
    selectedDrugId = drugId;
    tableBody.querySelectorAll('tr.med-row').forEach((tr) => {
      tr.classList.toggle('is-selected', tr.dataset.drugId === drugId);
    });

    try {
      const res = await fetch(`/api/medicines/${encodeURIComponent(drugId)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '詳細取得に失敗');

      const m = data.medicine;
      selectedMedicine = m;
      if (detailHeader) detailHeader.textContent = `薬剤詳細（${m.drugId}）`;
      if (btnCopyDrug) btnCopyDrug.disabled = false;

      const classPath = [m.majorCategory, m.middleCategory, m.smallCategory].filter(Boolean).join(' ＞ ') || '-';

      detailBody.innerHTML = `
        <table class="detail-table">
          <tr><th>薬品名</th><td class="detail-name">${esc(m.name)}</td></tr>
          <tr><th>フリガナ</th><td>${esc(m.kana || '-')}</td></tr>
          <tr><th>一般名</th><td>${esc(m.genericName || '-')}</td></tr>
          <tr><th>区分 / 先後</th><td>${esc(m.category)} / ${esc(m.brandType || '-')} / 採用: <strong>${esc(m.adoptType || '-')}</strong></td></tr>
          <tr><th>規格 / 単位</th><td>${esc(m.spec || '-')} / ${esc(m.unit || '-')}</td></tr>
          <tr><th>薬効分類</th><td>${esc(classPath)}</td></tr>
          <tr><th>標準用法</th><td><strong>${esc(m.standardUsage || '-')}</strong></td></tr>
          <tr><th>用法・用量</th><td>${esc(m.dosage || '-')}</td></tr>
          <tr><th>調剤可否</th><td>簡易懸濁: ${okMarkHtml(m.suspensionOk)}　粉砕: ${okMarkHtml(m.crushOk)}　脱カプセル: ${okMarkHtml(m.uncapsuleOk)}</td></tr>
          <tr><th>先発/後発名</th><td>先発: ${esc(m.originalBrandName || '-')} / 後発: ${esc(m.genericBrandName || '-')}</td></tr>
          <tr><th>改定日/切替</th><td>${esc(m.revisionDate || '-')}${m.replacedFromId ? `（旧ID: ${esc(m.replacedFromId)}）` : ''}</td></tr>
          <tr><th>備考</th><td>${esc(m.remarks || '-')}</td></tr>
          <tr><th>薬剤部メモ</th><td>${esc(m.pharmacyComment || '-')}</td></tr>
        </table>
        ${renderRelatedSection('同一一般名（先発・後発比較）', data.sameGeneric)}
        ${renderRelatedSection('同効薬（同一中分類）', data.sameClass)}
      `;
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  function updateTreeSelection() {
    treeList.querySelectorAll('.tree-major-btn, .tree-leaf').forEach((el) => {
      const m = el.dataset.major || '';
      const mid = el.dataset.middle || '';
      const isMatch =
        selectedMajor &&
        m === selectedMajor &&
        ((selectedMiddle && mid === selectedMiddle) || (!selectedMiddle && !mid));
      el.classList.toggle('is-selected', Boolean(isMatch));
    });
    if (activeTreeCrumb) {
      if (!selectedMajor) activeTreeCrumb.textContent = '分類: すべて';
      else if (!selectedMiddle) activeTreeCrumb.textContent = `分類: ${selectedMajor}`;
      else activeTreeCrumb.textContent = `分類: ${selectedMajor} ＞ ${selectedMiddle}`;
    }
  }

  // イベント登録
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchMedicines, 160);
    });
  }

  [filterCategory, filterBrand, filterAdopt, filterSuspension, filterCrush].forEach((sel) => {
    if (sel) sel.addEventListener('change', fetchMedicines);
  });

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (filterCategory) filterCategory.value = '';
      if (filterBrand) filterBrand.value = '';
      if (filterAdopt) filterAdopt.value = 'ACTIVE';
      if (filterSuspension) filterSuspension.value = '';
      if (filterCrush) filterCrush.value = '';
      selectedMajor = '';
      selectedMiddle = '';
      updateTreeSelection();
      fetchMedicines();
      if (searchInput) searchInput.focus();
    });
  }

  if (btnTreeAll) {
    btnTreeAll.addEventListener('click', () => {
      selectedMajor = '';
      selectedMiddle = '';
      updateTreeSelection();
      fetchMedicines();
    });
  }

  if (treeList) {
    treeList.addEventListener('click', (event) => {
      const majorBtn = event.target.closest('.tree-major-btn');
      if (majorBtn) {
        event.preventDefault();
        selectedMajor = majorBtn.dataset.major || '';
        selectedMiddle = '';
        updateTreeSelection();
        fetchMedicines();
        return;
      }

      const leafBtn = event.target.closest('.tree-leaf');
      if (leafBtn) {
        selectedMajor = leafBtn.dataset.major || '';
        selectedMiddle = leafBtn.dataset.middle || '';
        updateTreeSelection();
        fetchMedicines();
      }
    });
  }

  tableBody.addEventListener('click', (event) => {
    const row = event.target.closest('tr.med-row');
    if (row && row.dataset.drugId) {
      loadDetail(row.dataset.drugId);
    }
  });

  detailBody.addEventListener('click', (event) => {
    const relBtn = event.target.closest('.js-pick-related');
    if (relBtn && relBtn.dataset.drugId) {
      loadDetail(relBtn.dataset.drugId);
    }
  });

  if (btnCopyDrug) {
    btnCopyDrug.addEventListener('click', async () => {
      if (!selectedMedicine) return;
      const text = `${selectedMedicine.name}（${selectedMedicine.standardUsage || selectedMedicine.dosage || ''}）`;
      try {
        await navigator.clipboard.writeText(text);
        showStatus(`コピーしました: ${selectedMedicine.name}`, false);
      } catch (_) {
        showStatus('クリップボードへのコピーに失敗しました。', true);
      }
    });
  }

  // ソート
  document.querySelectorAll('.th-sort').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (sortKey === key) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortOrder = 'asc';
      }
      document.querySelectorAll('.th-sort span').forEach((s) => (s.textContent = '↕'));
      const icon = th.querySelector('span');
      if (icon) icon.textContent = sortOrder === 'asc' ? '▲' : '▼';
      if (currentMedicines.length === 0) {
        fetchMedicines();
      } else {
        renderTable(currentMedicines);
      }
    });
  });

  // 表示項目チェックボックス
  document.querySelectorAll('[data-pane-toggle], [data-col-toggle]').forEach((cb) => {
    cb.addEventListener('change', applyVisibilityToggles);
  });

  // キーボード操作（/ で検索フォーカス、↑↓ で行移動）
  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (event.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      event.preventDefault();
      if (searchInput) searchInput.focus();
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && tag !== 'SELECT') {
      const rows = Array.from(tableBody.querySelectorAll('tr.med-row'));
      if (rows.length === 0) return;
      const idx = rows.findIndex((r) => r.dataset.drugId === selectedDrugId);
      const nextIdx =
        event.key === 'ArrowDown'
          ? Math.min(rows.length - 1, idx + 1)
          : Math.max(0, idx <= 0 ? 0 : idx - 1);
      const nextRow = rows[nextIdx];
      if (nextRow && nextRow.dataset.drugId !== selectedDrugId) {
        event.preventDefault();
        loadDetail(nextRow.dataset.drugId);
        nextRow.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  // 初期データ取得（ソート・検索用キャッシュ同期）
  applyVisibilityToggles();
  fetchMedicines();
})();
