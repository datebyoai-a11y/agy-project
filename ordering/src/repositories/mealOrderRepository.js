'use strict';

const { getDB } = require('../db/connection');

/**
 * 食事オーダーリポジトリ（MongoDB実装）
 * - 将来の MySQL 移行を見据えたフラットなスネークケース構造
 * - AGENTS.md ルール準拠: 物理削除・直接上書きを行わず、
 *   中止・訂正時は元レコードへフラグ (is_cancelled / is_superseded) を立て追記のみ行う。
 */
const COLLECTION_NAME = 'meal_orders';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function toDomainMealOrder(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    orderNumber: doc.order_number,
    startDate: doc.start_date || '',
    startMeal: doc.start_meal || '昼食',
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
    dietType: doc.diet_type || '常食',
    stapleType: doc.staple_type || '米飯',
    stapleAmount: doc.staple_amount || '全量',
    sideTexture: doc.side_texture || '常菜',
    thickener: doc.thickener || 'なし',
    calories: doc.calories || '',
    saltLimit: doc.salt_limit || '',
    proteinLimit: doc.protein_limit || '',
    waterLimit: doc.water_limit || '',
    supplement: doc.supplement || '',
    prohibitedFoods: doc.prohibited_foods || '',
    eatingAid: Array.isArray(doc.eating_aid) ? doc.eating_aid : [],
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
  const prefix = `MEAL-${y}${m}${d}-`;

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

async function createMealOrder(record) {
  const now = new Date();
  const orderNumber = record.order_number || (await generateOrderNumber());
  const doc = {
    order_number: orderNumber,
    start_date: record.start_date || now.toISOString().slice(0, 10),
    start_meal: record.start_meal || '昼食',
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
    diet_type: record.diet_type || '常食',
    staple_type: record.staple_type || '米飯',
    staple_amount: record.staple_amount || '全量',
    side_texture: record.side_texture || '常菜',
    thickener: record.thickener || 'なし',
    calories: record.calories || '',
    salt_limit: record.salt_limit || '',
    protein_limit: record.protein_limit || '',
    water_limit: record.water_limit || '',
    supplement: record.supplement || '',
    prohibited_foods: record.prohibited_foods || '',
    eating_aid: Array.isArray(record.eating_aid) ? record.eating_aid : [],
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
  return toDomainMealOrder(doc);
}

async function findByOrderNumber(orderNumber) {
  const doc = await getCollection().findOne({ order_number: String(orderNumber || '').trim() });
  return toDomainMealOrder(doc);
}

async function findByPatientId(patientId, limit = 50) {
  const docs = await getCollection()
    .find({ patient_id: String(patientId || '').trim() })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainMealOrder);
}

async function findAll({ includeInactive = true, limit = 100 } = {}) {
  const filter = includeInactive ? {} : { is_cancelled: { $ne: true }, is_superseded: { $ne: true } };
  const docs = await getCollection()
    .find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainMealOrder);
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
        cancel_reason: reason || '食事オーダー中止',
        order_status: 'CANCELLED',
        updated_at: now
      },
      $push: {
        status_history: {
          action: 'CANCELLED',
          status: 'CANCELLED',
          actor: actorName,
          note: reason || '食事オーダー中止',
          at: now
        }
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainMealOrder(updated);
}

async function supersedeAndAppend(originalOrderNumber, newRecord, actorName, revisionNote) {
  const now = new Date();
  const created = await createMealOrder({
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
  createMealOrder,
  findByOrderNumber,
  findByPatientId,
  findAll,
  flagCancelled,
  supersedeAndAppend
};
