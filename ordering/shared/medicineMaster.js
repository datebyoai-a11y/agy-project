/**
 * 薬剤マスタ管理モジュール (medicineMaster.js)
 * 薬品集マスタ.xlsx からインポートされた medicines.json を読み込み、
 * 検索・サジェスト・詳細取得機能を提供します。
 */

const fs = require('fs');
const path = require('path');

const MEDICINES_FILE = path.join(__dirname, 'medicines.json');

let medicinesList = [];
let medicinesMap = new Map();

function loadMedicines() {
  try {
    if (fs.existsSync(MEDICINES_FILE)) {
      const data = fs.readFileSync(MEDICINES_FILE, 'utf8');
      medicinesList = JSON.parse(data);
      medicinesMap.clear();
      medicinesList.forEach(m => {
        medicinesMap.set(m.id, m);
      });
      console.log(`[MedicineMaster] 薬剤マスタ読み込み完了: ${medicinesList.length} 件`);
      return;
    }
  } catch (err) {
    console.error('[MedicineMaster] 薬剤マスタ読み込みエラー:', err.message);
  }
  medicinesList = [];
}

// 初期ロード
loadMedicines();

// ひらがな -> カタカナ変換
function hiraToKata(str) {
  if (!str) return '';
  return str.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

// 全角英数字記号 -> 半角変換
function zenToHan(str) {
  if (!str) return '';
  return str
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

// 検索用正規化文字列
function normalizeSearchText(str) {
  if (!str) return '';
  return zenToHan(hiraToKata(String(str).toLowerCase().trim()));
}

/**
 * 薬剤検索
 * @param {Object} options
 * @param {string} options.q - 検索キーワード（薬品名、カナ、成分名、ID）
 * @param {string} options.category - 区分（内服薬, 注射剤, 外用薬）
 * @param {string} options.adoptType - 採用区分フィルタ（省略時は削除以外）
 * @param {number} options.limit - 上限件数 (デフォルト: 50)
 */
function searchMedicines({ q = '', category = '', adoptType = '', limit = 50 } = {}) {
  const normQuery = normalizeSearchText(q);
  const targetCategory = category ? category.trim() : '';

  let results = medicinesList;

  // 1. 区分フィルタ
  if (targetCategory) {
    if (targetCategory === '内服・外用') {
      results = results.filter(m => m.category === '内服薬' || m.category === '外用薬');
    } else {
      results = results.filter(m => m.category === targetCategory);
    }
  }

  // 2. 採用区分フィルタ (デフォルトは削除除外)
  if (adoptType) {
    results = results.filter(m => m.adoptType === adoptType);
  } else {
    results = results.filter(m => m.adoptType !== '削除' && m.displayFlag !== '0');
  }

  // 3. キーワード検索
  if (normQuery) {
    const queryParts = normQuery.split(/\s+/).filter(Boolean);

    results = results.filter(m => {
      const nameNorm = normalizeSearchText(m.name);
      const kanaNorm = normalizeSearchText(m.kana);
      const genericNorm = normalizeSearchText(m.genericName);
      const idNorm = normalizeSearchText(m.id);
      const catMajorNorm = normalizeSearchText(m.therapeuticCategoryMajor);
      const catMiddleNorm = normalizeSearchText(m.therapeuticCategoryMiddle);

      const targetText = `${nameNorm} ${kanaNorm} ${genericNorm} ${idNorm} ${catMajorNorm} ${catMiddleNorm}`;

      return queryParts.every(p => targetText.includes(p));
    });
  }

  return limit ? results.slice(0, limit) : results;
}

/**
 * IDによる薬剤取得
 */
function getMedicineById(id) {
  if (!id) return null;
  return medicinesMap.get(id) || medicinesList.find(m => m.id === id) || null;
}

/**
 * 薬品名による薬剤取得（完全一致〜部分一致で柔軟に特定）
 */
function getMedicineByName(name) {
  if (!name) return null;
  const norm = normalizeSearchText(name);
  if (!norm) return null;

  // 1. 完全一致
  let found = medicinesList.find(m => normalizeSearchText(m.name) === norm);
  if (found) return found;

  // 2. カナ・一般名の完全一致
  found = medicinesList.find(m => normalizeSearchText(m.kana) === norm || normalizeSearchText(m.genericName) === norm);
  if (found) return found;

  // 3. 前方一致
  found = medicinesList.find(m => normalizeSearchText(m.name).startsWith(norm) || norm.startsWith(normalizeSearchText(m.name)));
  if (found) return found;

  // 4. 複数薬剤混合（+ や ＋ や ・）の場合、第一薬剤を解決
  if (name.includes('+') || name.includes('＋') || name.includes('・')) {
    const parts = name.split(/[+＋・]/).map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
      const match = getMedicineByName(p);
      if (match) return match;
    }
  }

  // 5. 部分一致
  if (norm.length >= 3) {
    found = medicinesList.find(m => normalizeSearchText(m.name).includes(norm) || norm.includes(normalizeSearchText(m.name)));
    if (found) return found;
  }

  return null;
}

/**
 * 全薬剤件数 & 区分別件数集計
 */
function getMedicineStats() {
  const stats = {
    total: medicinesList.length,
    byCategory: {},
    byAdoptType: {}
  };
  medicinesList.forEach(m => {
    stats.byCategory[m.category] = (stats.byCategory[m.category] || 0) + 1;
    stats.byAdoptType[m.adoptType] = (stats.byAdoptType[m.adoptType] || 0) + 1;
  });
  return stats;
}

module.exports = {
  loadMedicines,
  searchMedicines,
  getMedicineById,
  getMedicineByName,
  getMedicineStats,
  getAllMedicines: () => medicinesList
};

