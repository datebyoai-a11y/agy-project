'use strict';

const { getDB } = require('../db/connection');

/**
 * リハビリ指示リポジトリ（MongoDB実装）
 * - 将来の MySQL 移行を見据えたフラットなスネークケース構造
 * - AGENTS.md ルール準拠: 物理削除・直接上書きを行わず、
 *   中止・訂正時は元レコードへフラグ (is_cancelled / is_superseded) を立て追記のみ行う。
 */
const COLLECTION_NAME = 'rehab_orders';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function toDomainRehabOrder(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    orderNumber: doc.order_number,
    orderDate: doc.order_date || '',
    onsetDate: doc.onset_date || '',
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
    rehabCategory: doc.rehab_category || '運動器',
    diagnosisName: doc.diagnosis_name || '',
    frequencyPerWeek: doc.frequency_per_week || '',
    unitsPerDay: doc.units_per_day || '',
    durationMonths: doc.duration_months || '',
    location: doc.location || '病棟内',
    risks: Array.isArray(doc.risks) ? doc.risks : [],
    oxygenFlow: doc.oxygen_flow || '',
    contraindications: doc.contraindications || '',
    necessityReason: doc.necessity_reason || '',
    ptItems: Array.isArray(doc.pt_items) ? doc.pt_items : [],
    otItems: Array.isArray(doc.ot_items) ? doc.ot_items : [],
    stItems: Array.isArray(doc.st_items) ? doc.st_items : [],
    evalItems: Array.isArray(doc.eval_items) ? doc.eval_items : [],
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
  await col.createIndex({ order_status: 1, created_at: -1 });
}

async function generateOrderNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `REH-${y}${m}${d}-`;

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

async function createRehabOrder(record) {
  const now = new Date();
  const orderNumber = record.order_number || (await generateOrderNumber());
  const doc = {
    order_number: orderNumber,
    order_date: record.order_date || now.toISOString().slice(0, 10),
    onset_date: record.onset_date || '',
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
    rehab_category: record.rehab_category || '運動器',
    diagnosis_name: record.diagnosis_name || '',
    frequency_per_week: record.frequency_per_week || '',
    units_per_day: record.units_per_day || '',
    duration_months: record.duration_months || '',
    location: record.location || '病棟内',
    risks: Array.isArray(record.risks) ? record.risks : [],
    oxygen_flow: record.oxygen_flow || '',
    contraindications: record.contraindications || '',
    necessity_reason: record.necessity_reason || '',
    pt_items: Array.isArray(record.pt_items) ? record.pt_items : [],
    ot_items: Array.isArray(record.ot_items) ? record.ot_items : [],
    st_items: Array.isArray(record.st_items) ? record.st_items : [],
    eval_items: Array.isArray(record.eval_items) ? record.eval_items : [],
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
  return toDomainRehabOrder(doc);
}

async function findByOrderNumber(orderNumber) {
  const doc = await getCollection().findOne({ order_number: String(orderNumber || '').trim() });
  return toDomainRehabOrder(doc);
}

async function findByPatientId(patientId, limit = 50) {
  const docs = await getCollection()
    .find({ patient_id: String(patientId || '').trim() })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainRehabOrder);
}

async function findAll({ includeInactive = true, limit = 100 } = {}) {
  const filter = includeInactive ? {} : { is_cancelled: { $ne: true }, is_superseded: { $ne: true } };
  const docs = await getCollection()
    .find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainRehabOrder);
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
        cancel_reason: reason || 'リハビリ指示中止',
        order_status: 'CANCELLED',
        updated_at: now
      },
      $push: {
        status_history: {
          action: 'CANCELLED',
          status: 'CANCELLED',
          actor: actorName,
          note: reason || 'リハビリ指示中止',
          at: now
        }
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainRehabOrder(updated);
}

async function supersedeAndAppend(originalOrderNumber, newRecord, actorName, revisionNote) {
  const now = new Date();
  const created = await createRehabOrder({
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
  createRehabOrder,
  findByOrderNumber,
  findByPatientId,
  findAll,
  flagCancelled,
  supersedeAndAppend
};
