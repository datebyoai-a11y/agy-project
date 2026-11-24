'use strict';

const { getDB } = require('../db/connection');

/**
 * 注射箋リポジトリ（MongoDB実装）
 * - 将来の MySQL 移行を見据えたフラットなスネークケース構造
 * - 入院注射箋 / 外来注射箋を injection_type ('入院注射' | '外来注射') で管理
 * - AGENTS.md ルール準拠: 物理削除・直接上書きは行わず、
 *   中止・訂正時は元レコードへフラグ (is_cancelled / is_superseded) を立て、
 *   訂正時は新レコードを追記 (parent_order_number) する。
 */
const COLLECTION_NAME = 'injection_orders';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function normalizeDailySchedule(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')))
    .map((d) => ({
      date: String(d.date),
      status: d.status === 'DELETE' ? 'DELETE' : 'CONTINUE',
      note: String(d.note || '').trim()
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeStoredItems(doc) {
  if (!Array.isArray(doc.items)) return [];
  return doc.items.map((it, idx) => ({
    lineNo: it.line_no || idx + 1,
    rpNo: Number(it.rp_no) || 1,
    drugId: it.drug_id || '',
    drugName: it.drug_name || '',
    genericName: it.generic_name || '',
    spec: it.spec || '',
    unit: it.unit || '',
    category: it.category || '注射剤',
    dose: it.dose || '',
    route: it.route || '点滴静注(DIV)',
    timing: it.timing || '',
    rate: it.rate || '',
    days: it.days != null ? Number(it.days) : 1,
    dayUnit: it.day_unit || '日間',
    note: it.note || '',
    dailySchedule: normalizeDailySchedule(it.daily_schedule)
  }));
}

function toDomainInjection(doc) {
  if (!doc) return null;
  const items = normalizeStoredItems(doc);
  return {
    id: String(doc._id),
    orderNumber: doc.order_number,
    injectionType: doc.injection_type || '入院注射',
    startDate: doc.start_date || '',
    patientId: doc.patient_id,
    patientName: doc.patient_name,
    patientKana: doc.patient_kana || '',
    gender: doc.gender || '不明',
    age: doc.age != null ? doc.age : null,
    birthDate: doc.birth_date || '',
    ward: doc.ward || '医療病棟',
    room: doc.room || '',
    sourceDepartment: doc.source_department || '',
    doctorName: doc.doctor_name || '',
    orderedByStaffId: doc.ordered_by_staff_id || '',
    items,
    remarks: doc.remarks || '',
    orderStatus: doc.order_status || 'ORDERED',
    isCancelled: Boolean(doc.is_cancelled),
    cancelledAt: doc.cancelled_at || null,
    cancelledBy: doc.cancelled_by || '',
    cancelReason: doc.cancel_reason || '',
    isSuperseded: Boolean(doc.is_superseded),
    supersededBy: doc.superseded_by || '',
    supersededAt: doc.superseded_at || null,
    parentOrderNumber: doc.parent_order_number || '',
    revisionNote: doc.revision_note || '',
    statusHistory: Array.isArray(doc.status_history) ? doc.status_history : [],
    createdAt: doc.created_at,
    updatedAt: doc.updated_at
  };
}

async function ensureIndexes() {
  const col = getCollection();
  await col.createIndex({ order_number: 1 }, { unique: true });
  await col.createIndex({ patient_id: 1, created_at: -1 });
  await col.createIndex({ injection_type: 1, created_at: -1 });
  await col.createIndex({ order_status: 1, created_at: -1 });
}

async function generateOrderNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `INJ-${y}${m}${d}-`;

  const latest = await getCollection()
    .find({ order_number: { $regex: `^${prefix}` } })
    .sort({ order_number: -1 })
    .limit(1)
    .toArray();

  let seq = 1;
  if (latest.length > 0) {
    const tail = latest[0].order_number.slice(prefix.length);
    const parsed = parseInt(tail, 10);
    if (!Number.isNaN(parsed)) seq = parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function createInjection(record) {
  const now = new Date();
  const orderNumber = record.order_number || (await generateOrderNumber());
  const doc = {
    order_number: orderNumber,
    injection_type: record.injection_type || '入院注射',
    start_date: record.start_date || now.toISOString().slice(0, 10),
    patient_id: record.patient_id,
    patient_name: record.patient_name,
    patient_kana: record.patient_kana || '',
    gender: record.gender || '不明',
    age: record.age != null ? record.age : null,
    birth_date: record.birth_date || '',
    ward: record.ward || '医療病棟',
    room: record.room || '',
    source_department: record.source_department || '',
    doctor_name: record.doctor_name || '',
    ordered_by_staff_id: record.ordered_by_staff_id || '',
    elevated_doctor_staff_id: record.elevated_doctor_staff_id || '',
    elevated_doctor_name: record.elevated_doctor_name || '',
    operator_staff_id: record.operator_staff_id || '',
    operator_name: record.operator_name || '',
    operator_role_name: record.operator_role_name || '',
    items: Array.isArray(record.items) ? record.items : [],
    remarks: record.remarks || '',
    order_status: record.order_status || 'ORDERED',
    is_cancelled: false,
    cancelled_at: null,
    cancelled_by: '',
    cancel_reason: '',
    is_superseded: false,
    superseded_by: '',
    superseded_at: null,
    parent_order_number: record.parent_order_number || '',
    revision_note: record.revision_note || '',
    status_history: [
      {
        action: record.parent_order_number ? 'REVISED_CREATE' : 'CREATED',
        status: record.order_status || 'ORDERED',
        actor: record.doctor_name || record.ordered_by_staff_id || 'system',
        note: record.revision_note || '',
        at: now
      }
    ],
    created_at: now,
    updated_at: now
  };

  await getCollection().insertOne(doc);
  return toDomainInjection(doc);
}

async function findByOrderNumber(orderNumber) {
  const doc = await getCollection().findOne({ order_number: String(orderNumber || '').trim() });
  return toDomainInjection(doc);
}

async function findByPatientId(patientId, { injectionType = '', limit = 50 } = {}) {
  const filter = { patient_id: String(patientId || '').trim() };
  if (injectionType) filter.injection_type = injectionType;
  const docs = await getCollection()
    .find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainInjection);
}

async function findAll({ includeInactive = true, injectionType = '', limit = 100 } = {}) {
  const filter = {};
  if (!includeInactive) {
    filter.is_cancelled = { $ne: true };
    filter.is_superseded = { $ne: true };
  }
  if (injectionType) {
    filter.injection_type = injectionType;
  }
  const docs = await getCollection()
    .find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainInjection);
}

async function flagCancelled(orderNumber, reason, actorName) {
  const now = new Date();
  const updated = await getCollection().findOneAndUpdate(
    { order_number: orderNumber },
    {
      $set: {
        is_cancelled: true,
        cancelled_at: now,
        cancelled_by: actorName,
        cancel_reason: reason || '注射中止',
        order_status: 'CANCELLED',
        updated_at: now
      },
      $push: {
        status_history: {
          action: 'CANCELLED',
          status: 'CANCELLED',
          actor: actorName,
          note: reason || '注射中止',
          at: now
        }
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainInjection(updated);
}

async function supersedeAndAppend(originalOrderNumber, newRecord, actorName, revisionNote) {
  const now = new Date();
  const created = await createInjection({
    ...newRecord,
    parent_order_number: originalOrderNumber,
    revision_note: revisionNote || '訂正再発行'
  });

  await getCollection().updateOne(
    { order_number: originalOrderNumber },
    {
      $set: {
        is_superseded: true,
        superseded_by: created.orderNumber,
        superseded_at: now,
        updated_at: now
      },
      $push: {
        status_history: {
          action: 'SUPERSEDED',
          status: 'SUPERSEDED',
          actor: actorName,
          note: `訂正再発行 -> ${created.orderNumber}${revisionNote ? ` (${revisionNote})` : ''}`,
          at: now
        }
      }
    }
  );

  return created;
}

module.exports = {
  ensureIndexes,
  generateOrderNumber,
  createInjection,
  findByOrderNumber,
  findByPatientId,
  findAll,
  flagCancelled,
  supersedeAndAppend
};
