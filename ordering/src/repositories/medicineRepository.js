'use strict';

const { getDB } = require('../db/connection');

/**
 * 薬剤マスタリポジトリ（MongoDB実装）
 * 将来的な MySQL 移行を見据えたフラットなスネークケース構造。
 */
const COLLECTION_NAME = 'medicines';

// 代表的な通称・先発・後発エイリアスマッピング
const MEDICINE_ALIASES = {
  'ロキソニン': 'ロキソプロフェン',
  'カロナール': 'アセトアミノフェン',
  'ボルタレン': 'ジクロフェナク',
  'プロプレス': 'カンデサルタン',
  'アムロジン': 'アムロジピン',
  'ノルバスク': 'アムロジピン',
  'リピトール': 'アトルバスタチン',
  'クレストール': 'ロスバスタチン',
  'ムコスタ': 'レバミピド',
  'ガスター': 'ファモチジン',
  'タケプロン': 'ランソプラゾール',
  'ネキシウム': 'エソメプラゾール',
  'マグラックス': '酸化マグネシウム',
  'マグミット': '酸化マグネシウム',
  'メジコン': 'デキストロメトルファン',
  'ムコダイン': 'カルボシステイン',
  'アレグラ': 'フェキソフェナジン',
  'アレロック': 'オロパタジン',
  'クラビット': 'レボフロキサシン',
  'メイアクト': 'セフジトレン',
  'フロモックス': 'セフカペン',
  'ヒルドイド': 'ヘパリン類似物質',
  'モーラステープ': 'ケトプロフェン',
  'ロコアテープ': 'エスフルルビプロフェン',
  'リンデロン': 'ベタメタゾン',
  'ゲンタシン': 'ゲンタマイシン',
  'プロペト': '白色ワセリン',
  'デパス': 'エチゾラム',
  'マイスリー': 'ゾルピデム',
  'ハルシオン': 'トリアゾラム',
  'ラシックス': 'フロセミド',
  'バイアスピリン': 'アスピリン',
  'プラビックス': 'クロピドグレル',
  'ワーファリン': 'ワルファリン',
  'メトグルコ': 'メトホルミン',
  'ジャヌビア': 'シタグリプチン'
};

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

/**
 * 検索用テキスト正規化（全角英数→半角、ひらがな→カタカナ、小文字化）
 */
function normalizeSearchText(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFKC')
    .replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .toLowerCase()
    .trim();
}

function parseCategoryOrder(label) {
  const m = String(label || '').match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : 9999;
}

/**
 * 薬剤マスタの標準用法・規格・単位から、臨時処方箋用デフォルト値を算出
 * - 1日量（数値 + 単位: 錠 / カプセル / g 等）
 * - 分割回数（1 / 2 / 3 / 4 / 頓用 / 外用）
 * - 服用方法（timing: 朝/昼/夕/朝夕/朝昼夕/眠前/屯用, meal: 食前/食後/""）
 */
function computeMedicineDefaults(raw) {
  const name = String(raw.name || '');
  const spec = String(raw.spec || '').normalize('NFKC');
  const rawUnit = String(raw.unit || '').trim();
  const category = String(raw.category || '内服薬').trim();
  const text = String(raw.standardUsage || raw.standard_usage || raw.dosage || '').normalize('NFKC');

  // 単位の正規化（錠 / カプセル / g 優先）
  let doseUnit = '錠';
  if (rawUnit === 'Cap' || /カプセル/.test(name)) {
    doseUnit = 'カプセル';
  } else if (rawUnit === '錠' || /錠/.test(name)) {
    doseUnit = '錠';
  } else if (/散|細粒|顆粒|ドライシロップ|末/.test(name) && /\d+(?:\.\d+)?\s*g\b/i.test(text)) {
    doseUnit = 'g';
  } else if (rawUnit === '包') {
    doseUnit = /\d+(?:\.\d+)?\s*g\b/i.test(text) ? 'g' : '包';
  } else if (rawUnit) {
    doseUnit = rawUnit;
  }

  if (category === '外用薬') {
    return {
      default_daily_dose_num: '1',
      default_daily_dose_unit: doseUnit,
      default_division_count: '外用',
      default_method_timing: '朝夕',
      default_method_meal: '食後',
      default_administration_method: doseUnit === '枚' ? '朝夕 貼付' : '朝夕 塗布'
    };
  }

  // 屯用判定
  const isPrn = /頓用|屯用|疼痛時|発熱時|不眠時|発作時|投与間隔/.test(text);
  // 眠前判定
  const isBedtime = !isPrn && /就寝前|眠前/.test(text);

  // 分割回数
  let divCount = '3';
  if (isPrn) {
    divCount = '頓用';
  } else if (isBedtime) {
    divCount = '1';
  } else {
    const mDiv =
      text.match(/1日\s*(?:\d+[～~\-])?(\d+)\s*回/) ||
      text.match(/(?:\d+[～~\-])?(\d+)\s*回\s*(?:分服|に分割|に分ける)/) ||
      text.match(/分\s*(\d+)/);
    if (mDiv) {
      const n = Math.min(4, Math.max(1, parseInt(mDiv[1], 10)));
      divCount = String(n);
    } else if (/1日1回|朝食後|夕食後|起床時/.test(text)) {
      divCount = '1';
    } else if (/朝夕|1日2回/.test(text)) {
      divCount = '2';
    }
  }

  // 1日量数値の推定
  let doseNum = '';
  // 1) 明示的な「1日X錠/カプセル/g/包」
  const mDailyUnit = text.match(/1日(?:量)?\s*(\d+(?:\.\d+)?)(?:[～~\-](\d+(?:\.\d+)?))?\s*(錠|カプセル|ｶﾌﾟｾﾙ|Cap|g|包)/i);
  // 2) 「1回X錠/カプセル/g/包」× 分割回数
  const mPerUnit = text.match(/1回\s*(\d+(?:\.\d+)?)(?:[～~\-](\d+(?:\.\d+)?))?\s*(錠|カプセル|ｶﾌﾟｾﾙ|Cap|g|包)/i);
  // 3) mg 指定と規格(mg)からの換算
  const mSpecMg = spec.match(/(\d+(?:\.\d+)?)\s*mg/i);
  const mDailyMg = text.match(/1日(?:量)?\s*(\d+(?:\.\d+)?)\s*mg/i);
  const mPerMg = text.match(/1回\s*(\d+(?:\.\d+)?)\s*mg/i);

  const normalizeMatchedUnit = (u) => {
    if (/カプセル|ｶﾌﾟｾﾙ|cap/i.test(u)) return 'カプセル';
    if (u === 'g' || u === 'G') return 'g';
    return u;
  };

  if (mDailyUnit) {
    doseNum = mDailyUnit[1];
    doseUnit = normalizeMatchedUnit(mDailyUnit[3]);
  } else if (mPerUnit) {
    const perVal = Number(mPerUnit[1]);
    doseUnit = normalizeMatchedUnit(mPerUnit[3]);
    const mult = /^\d+$/.test(divCount) ? Number(divCount) : 1;
    const total = Math.round(perVal * mult * 100) / 100;
    doseNum = String(total);
  } else if (mSpecMg && Number(mSpecMg[1]) > 0) {
    const unitMg = Number(mSpecMg[1]);
    if (mPerMg) {
      const perTabs = Number(mPerMg[1]) / unitMg;
      const mult = /^\d+$/.test(divCount) ? Number(divCount) : 1;
      const total = Math.round(perTabs * mult * 100) / 100;
      if (total >= 0.25 && total <= 20) doseNum = String(total);
    } else if (mDailyMg) {
      const total = Math.round((Number(mDailyMg[1]) / unitMg) * 100) / 100;
      if (total >= 0.25 && total <= 20) doseNum = String(total);
    }
  }

  if (!doseNum) {
    doseNum = /^\d+$/.test(divCount) ? divCount : '1';
  }

  // 服用方法（ラジオボタン用: timing + meal）
  let timing = '朝昼夕';
  let meal = '食後';

  if (isPrn) {
    timing = '屯用';
    meal = '';
  } else if (isBedtime) {
    timing = '眠前';
    meal = '';
  } else {
    if (/夕食/.test(text) && !/朝食/.test(text)) timing = '夕';
    else if (/昼食/.test(text) && !/朝食|夕食/.test(text)) timing = '昼';
    else if (/朝食|起床/.test(text) && !/夕食/.test(text)) timing = '朝';
    else if (divCount === '1') timing = '朝';
    else if (divCount === '2') timing = '朝夕';
    else timing = '朝昼夕';

    if (/食前|空腹時/.test(text)) meal = '食前';
    else meal = '食後';
  }

  const combined = meal ? `${timing} ${meal}` : timing;

  return {
    default_daily_dose_num: doseNum,
    default_daily_dose_unit: doseUnit,
    default_division_count: divCount,
    default_method_timing: timing,
    default_method_meal: meal,
    default_administration_method: combined
  };
}

function toDomainMedicine(doc) {
  if (!doc) return null;
  const fallback =
    doc.default_daily_dose_num != null && doc.default_method_timing
      ? null
      : computeMedicineDefaults(doc);

  return {
    drugId: doc.drug_id,
    name: doc.name || '',
    genericName: doc.generic_name || '',
    kana: doc.kana || '',
    category: doc.category || '',
    spec: doc.spec || '',
    unit: doc.unit || '',
    dosage: doc.dosage || '',
    standardUsage: doc.standard_usage || '',
    suspensionOk: doc.suspension_ok || '',
    crushOk: doc.crush_ok || '',
    uncapsuleOk: doc.uncapsule_ok || '',
    majorCategory: doc.major_category || '',
    middleCategory: doc.middle_category || '',
    smallCategory: doc.small_category || '',
    brandType: doc.brand_type || '',
    originalBrandName: doc.original_brand_name || '',
    genericBrandName: doc.generic_brand_name || '',
    adoptType: doc.adopt_type || '',
    statusFlag: doc.status_flag || '1',
    displayFlag: doc.display_flag || '1',
    revisionDate: doc.revision_date || '',
    replacedFromId: doc.replaced_from_id || '',
    remarks: doc.remarks || '',
    pharmacyComment: doc.pharmacy_comment || '',
    defaultDailyDoseNum: fallback ? fallback.default_daily_dose_num : doc.default_daily_dose_num,
    defaultDailyDoseUnit: fallback ? fallback.default_daily_dose_unit : doc.default_daily_dose_unit,
    defaultDivisionCount: fallback ? fallback.default_division_count : doc.default_division_count,
    defaultMethodTiming: fallback ? fallback.default_method_timing : doc.default_method_timing,
    defaultMethodMeal: fallback ? fallback.default_method_meal : doc.default_method_meal,
    defaultAdministrationMethod: fallback
      ? fallback.default_administration_method
      : doc.default_administration_method
  };
}

async function ensureIndexes() {
  const col = getCollection();
  await col.createIndex({ drug_id: 1 }, { unique: true });
  await col.createIndex({ category: 1, major_category: 1, middle_category: 1 });
  await col.createIndex({ adopt_type: 1, brand_type: 1 });
  await col.createIndex({ search_text: 1 });
}

async function countAll() {
  return getCollection().countDocuments({});
}

async function bulkSeed(rawItems) {
  await ensureIndexes();
  const now = new Date();
  const ops = rawItems.map((item) => {
    const defaults = computeMedicineDefaults(item);
    const searchTokens = [
      item.id,
      item.name,
      item.genericName,
      item.kana,
      item.originalBrandName,
      item.genericBrandName,
      item.therapeuticCategoryMajor,
      item.therapeuticCategoryMiddle,
      item.therapeuticCategorySmall,
      item.remarks
    ]
      .filter(Boolean)
      .join(' ');

    return {
      updateOne: {
        filter: { drug_id: item.id },
        update: {
          $setOnInsert: {
            drug_id: item.id,
            name: item.name || '',
            generic_name: item.genericName || '',
            kana: item.kana || '',
            search_text: normalizeSearchText(searchTokens),
            category: item.category || '',
            spec: item.spec || '',
            unit: item.unit || '',
            dosage: item.dosage || '',
            standard_usage: item.standardUsage || '',
            suspension_ok: item.suspensionOk || '',
            crush_ok: item.crushOk || '',
            uncapsule_ok: item.uncapsuleOk || '',
            major_category: item.therapeuticCategoryMajor || '',
            middle_category: item.therapeuticCategoryMiddle || '',
            small_category: item.therapeuticCategorySmall || '',
            brand_type: item.brandType || '',
            original_brand_name: item.originalBrandName || '',
            generic_brand_name: item.genericBrandName || '',
            adopt_type: item.adoptType || '',
            status_flag: item.statusFlag || '1',
            display_flag: item.displayFlag || '1',
            revision_date: item.revisionDate || '',
            replaced_from_id: item.replacedFromId || '',
            remarks: item.remarks || '',
            pharmacy_comment: item.pharmacyComment || '',
            ...defaults,
            created_at: now,
            updated_at: now
          }
        },
        upsert: true
      }
    };
  });

  if (ops.length > 0) {
    await getCollection().bulkWrite(ops, { ordered: false });
  }
}

async function backfillPrescriptionDefaults() {
  const col = getCollection();
  const missing = await col
    .find({ default_daily_dose_num: { $exists: false } })
    .toArray();
  if (missing.length === 0) return 0;

  const now = new Date();
  const ops = missing.map((doc) => {
    const defaults = computeMedicineDefaults(doc);
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { ...defaults, updated_at: now } }
      }
    };
  });
  await col.bulkWrite(ops, { ordered: false });
  return ops.length;
}

async function getCategoryTree() {
  const docs = await getCollection()
    .find({}, { projection: { major_category: 1, middle_category: 1, category: 1, adopt_type: 1 } })
    .toArray();

  const majorMap = new Map();
  for (const d of docs) {
    const major = d.major_category || '未分類';
    const middle = d.middle_category || '';
    if (!majorMap.has(major)) {
      majorMap.set(major, { name: major, count: 0, middles: new Map() });
    }
    const entry = majorMap.get(major);
    entry.count += 1;
    if (middle) {
      entry.middles.set(middle, (entry.middles.get(middle) || 0) + 1);
    }
  }

  return Array.from(majorMap.values())
    .sort((a, b) => parseCategoryOrder(a.name) - parseCategoryOrder(b.name) || a.name.localeCompare(b.name, 'ja'))
    .map((m) => ({
      name: m.name,
      count: m.count,
      middles: Array.from(m.middles.entries())
        .sort((a, b) => parseCategoryOrder(a[0]) - parseCategoryOrder(b[0]) || a[0].localeCompare(b[0], 'ja'))
        .map(([name, count]) => ({ name, count }))
    }));
}

function expandSearchTerms(rawQuery) {
  const norm = normalizeSearchText(rawQuery);
  if (!norm) return [];

  // スペース区切りでAND検索、各語句ごとにエイリアス展開（OR）
  return norm
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const variants = new Set([token]);
      for (const [aliasKey, targetVal] of Object.entries(MEDICINE_ALIASES)) {
        const normAlias = normalizeSearchText(aliasKey);
        const normTarget = normalizeSearchText(targetVal);
        if (normAlias.includes(token) || token.includes(normAlias)) {
          variants.add(normTarget);
        }
      }
      return Array.from(variants);
    });
}

async function searchMedicines({
  q = '',
  category = '',
  majorCategory = '',
  middleCategory = '',
  brandType = '',
  adoptType = 'ACTIVE',
  suspensionOk = '',
  crushOk = '',
  limit = 650
} = {}) {
  const filter = {};

  if (category) filter.category = category;
  if (majorCategory) filter.major_category = majorCategory;
  if (middleCategory) filter.middle_category = middleCategory;
  if (brandType) filter.brand_type = brandType;
  if (suspensionOk) filter.suspension_ok = suspensionOk;
  if (crushOk) filter.crush_ok = crushOk;

  if (adoptType === 'ACTIVE') {
    filter.adopt_type = { $ne: '削除' };
  } else if (adoptType && adoptType !== 'ALL') {
    filter.adopt_type = adoptType;
  }

  const termGroups = expandSearchTerms(q);
  if (termGroups.length > 0) {
    filter.$and = termGroups.map((variants) => ({
      $or: variants.map((v) => ({
        search_text: { $regex: v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
      }))
    }));
  }

  const docs = await getCollection()
    .find(filter)
    .sort({ drug_id: 1 })
    .limit(limit)
    .toArray();

  return docs.map(toDomainMedicine);
}

async function findByDrugId(drugId) {
  const doc = await getCollection().findOne({ drug_id: String(drugId || '').trim() });
  return toDomainMedicine(doc);
}

async function findRelatedMedicines(medicine) {
  if (!medicine) return { sameGeneric: [], sameClass: [] };

  const sameGeneric = medicine.genericName
    ? (
        await getCollection()
          .find({
            generic_name: medicine.genericName,
            drug_id: { $ne: medicine.drugId },
            adopt_type: { $ne: '削除' }
          })
          .sort({ drug_id: 1 })
          .limit(15)
          .toArray()
      ).map(toDomainMedicine)
    : [];

  const sameClass = medicine.middleCategory
    ? (
        await getCollection()
          .find({
            major_category: medicine.majorCategory,
            middle_category: medicine.middleCategory,
            drug_id: { $ne: medicine.drugId },
            adopt_type: { $ne: '削除' }
          })
          .sort({ drug_id: 1 })
          .limit(20)
          .toArray()
      ).map(toDomainMedicine)
    : [];

  return { sameGeneric, sameClass };
}

module.exports = {
  normalizeSearchText,
  computeMedicineDefaults,
  ensureIndexes,
  countAll,
  bulkSeed,
  backfillPrescriptionDefaults,
  getCategoryTree,
  searchMedicines,
  findByDrugId,
  findRelatedMedicines
};
