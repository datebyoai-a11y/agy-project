'use strict';

const { getDB } = require('../db/connection');

/**
 * 放射線科オーダーリポジトリ（MongoDB実装）
 * - 将来の MySQL 移行を見据えたフラットなスネークケース構造
 * - AGENTS.md ルール準拠: 物理削除・直接上書きは行わず、
 *   中止・訂正時は元レコードへフラグ (is_cancelled / is_superseded) を立て、
 *   訂正時は新レコードを追記 (parent_order_number) する。
 */
const COLLECTION_NAME = 'radiology_orders';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function classifyModality(doc) {
  const formType = String(doc.form_type || '').toUpperCase();
  const mod = String(doc.modality || '').toUpperCase();
  const exam = String(doc.exam_type || '').toUpperCase();
  if (formType === 'CT' || mod.includes('CT') || exam.includes('CT')) return 'ct';
  if (
    formType === 'FLUORO' ||
    mod.includes('透視') ||
    mod.includes('FLUORO') ||
    exam.includes('透視') ||
    exam.includes('PEG') ||
    exam.includes('VF') ||
    exam.includes('嚥下')
  ) {
    return 'fluoro';
  }
  return 'xray';
}

function toDomainOrder(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    orderNumber: doc.order_number,
    orderDate: doc.order_date,
    scheduledDate: doc.scheduled_date,
    patientId: doc.patient_id,
    patientName: doc.patient_name,
    patientKana: doc.patient_kana || '',
    gender: doc.gender || '不明',
    age: doc.age != null ? doc.age : null,
    birthDate: doc.birth_date || '',
    ward: doc.ward || '外来',
    room: doc.room || '',
    sourceDepartment: doc.source_department || '',
    requestDepartment: doc.request_department || '内科',
    mobility: doc.mobility || '徒歩',
    infection: doc.infection || '無',
    height: doc.height || '',
    weight: doc.weight || '',
    doctorName: doc.doctor_name || '',
    orderedByStaffId: doc.ordered_by_staff_id || '',
    formType: doc.form_type || 'CT',
    formName: doc.form_name || 'ＣＴ検査依頼書',
    modality: doc.modality || 'CT',
    modalityKey: classifyModality(doc),
    examType: doc.exam_type || '',
    contrast: doc.contrast || '単純',
    dynamicPhase: doc.dynamic_phase || '',
    isPortable: Boolean(doc.is_portable),
    portableRoom: doc.portable_room || '',
    isUrgent: Boolean(doc.is_urgent),
    parts: Array.isArray(doc.parts) ? doc.parts : [],
    partsDetail: doc.parts_detail || '',
    medications: doc.medications || '',
    materials: doc.materials || '',
    conditionKv: doc.condition_kv || '',
    conditionMa: doc.condition_ma || '',
    conditionSec: doc.condition_sec || '',
    purpose: doc.purpose || '',
    remarks: doc.remarks || '',
    mediaDvd: doc.media_dvd || '未',
    elecImgAdd: Boolean(doc.elec_img_add),
    orderStatus: doc.order_status || 'ORDERED',
    acceptedAt: doc.accepted_at || null,
    acceptedBy: doc.accepted_by || '',
    completedAt: doc.completed_at || null,
    completedBy: doc.completed_by || '',
    technicianNotes: doc.technician_notes || '',
    // 追記・フラグ管理（物理削除・上書き禁止）
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
  const prefix = `RAD-${y}${m}${d}-`;

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

async function createOrder(record) {
  const now = new Date();
  const orderNumber = record.order_number || (await generateOrderNumber());
  const doc = {
    order_number: orderNumber,
    order_date: record.order_date || now,
    scheduled_date: record.scheduled_date || now,
    patient_id: record.patient_id,
    patient_name: record.patient_name,
    patient_kana: record.patient_kana || '',
    gender: record.gender || '不明',
    age: record.age != null ? record.age : null,
    birth_date: record.birth_date || '',
    ward: record.ward || '外来',
    room: record.room || '',
    source_department: record.source_department || '',
    request_department: record.request_department || '内科',
    mobility: record.mobility || '徒歩',
    infection: record.infection || '無',
    height: record.height || '',
    weight: record.weight || '',
    doctor_name: record.doctor_name || '',
    ordered_by_staff_id: record.ordered_by_staff_id || '',
    elevated_doctor_staff_id: record.elevated_doctor_staff_id || '',
    elevated_doctor_name: record.elevated_doctor_name || '',
    operator_staff_id: record.operator_staff_id || '',
    operator_name: record.operator_name || '',
    operator_role_name: record.operator_role_name || '',
    form_type: record.form_type || 'CT',
    form_name: record.form_name || 'ＣＴ検査依頼書',
    modality: record.modality || 'CT',
    exam_type: record.exam_type || '',
    contrast: record.contrast || '単純',
    dynamic_phase: record.dynamic_phase || '',
    is_portable: Boolean(record.is_portable),
    portable_room: record.portable_room || '',
    is_urgent: Boolean(record.is_urgent),
    parts: Array.isArray(record.parts) ? record.parts : [],
    parts_detail: record.parts_detail || '',
    medications: record.medications || '',
    materials: record.materials || '',
    condition_kv: record.condition_kv || '',
    condition_ma: record.condition_ma || '',
    condition_sec: record.condition_sec || '',
    purpose: record.purpose || '',
    remarks: record.remarks || '',
    media_dvd: record.media_dvd || '未',
    elec_img_add: record.elec_img_add !== false,
    order_status: record.order_status || 'ORDERED',
    accepted_at: record.accepted_at || null,
    accepted_by: record.accepted_by || '',
    completed_at: record.completed_at || null,
    completed_by: record.completed_by || '',
    technician_notes: record.technician_notes || '',
    is_cancelled: Boolean(record.is_cancelled),
    cancelled_at: record.cancelled_at || null,
    cancelled_by: record.cancelled_by || '',
    cancel_reason: record.cancel_reason || '',
    is_superseded: Boolean(record.is_superseded),
    superseded_by: record.superseded_by || '',
    superseded_at: record.superseded_at || null,
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
  return toDomainOrder(doc);
}

async function upsertSeedOrder(record) {
  const existing = await getCollection().findOne({ order_number: record.order_number });
  if (existing) return toDomainOrder(existing);
  return createOrder(record);
}

async function findByOrderNumber(orderNumber) {
  const doc = await getCollection().findOne({ order_number: String(orderNumber || '').trim() });
  return toDomainOrder(doc);
}

async function findByPatientId(patientId, limit = 50) {
  const docs = await getCollection()
    .find({ patient_id: String(patientId || '').trim() })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainOrder);
}

async function findOrders({ status, search, includeInactive = false } = {}) {
  const filter = {};

  if (!includeInactive) {
    filter.is_superseded = { $ne: true };
    if (status !== 'ALL' && status !== 'CANCELLED') {
      filter.is_cancelled = { $ne: true };
    }
  }

  if (status && status !== 'ALL') {
    if (status === 'ACTIVE') {
      filter.order_status = { $in: ['ORDERED', 'ACCEPTED'] };
    } else {
      filter.order_status = status;
    }
  }

  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [
      { order_number: regex },
      { patient_id: regex },
      { patient_name: regex },
      { patient_kana: regex },
      { exam_type: regex },
      { parts_detail: regex },
      { purpose: regex },
      { ward: regex },
      { room: regex },
      { doctor_name: regex }
    ];
  }

  const docs = await getCollection()
    .find(filter)
    .sort({ created_at: -1 })
    .limit(300)
    .toArray();

  return docs.map(toDomainOrder);
}

async function countSummary() {
  const docs = await getCollection()
    .find({ is_superseded: { $ne: true }, is_cancelled: { $ne: true } })
    .toArray();

  const counts = {
    total: docs.length,
    ordered: 0,
    accepted: 0,
    completed: 0,
    portable: 0,
    xray: 0,
    ct: 0,
    fluoro: 0
  };

  for (const d of docs) {
    const st = d.order_status || 'ORDERED';
    if (st === 'ORDERED') counts.ordered += 1;
    else if (st === 'ACCEPTED') counts.accepted += 1;
    else if (st === 'COMPLETED') counts.completed += 1;
    if (d.is_portable) counts.portable += 1;
    const mk = classifyModality(d);
    counts[mk] += 1;
  }

  return counts;
}

/**
 * ステータス更新（受付 / 実施済 / 戻す）＋ 履歴追記
 */
async function updateExecutionStatus(orderNumber, nextStatus, actorName, technicianNotes) {
  const now = new Date();
  const current = await getCollection().findOne({ order_number: orderNumber });
  if (!current) return null;

  const $set = {
    order_status: nextStatus,
    updated_at: now
  };

  if (typeof technicianNotes === 'string') {
    $set.technician_notes = technicianNotes;
  }

  if (nextStatus === 'ACCEPTED') {
    $set.accepted_at = now;
    $set.accepted_by = actorName;
  } else if (nextStatus === 'COMPLETED') {
    if (!current.accepted_at) {
      $set.accepted_at = now;
      $set.accepted_by = actorName;
    }
    $set.completed_at = now;
    $set.completed_by = actorName;
  } else if (nextStatus === 'ORDERED') {
    $set.accepted_at = null;
    $set.accepted_by = '';
    $set.completed_at = null;
    $set.completed_by = '';
  }

  const updated = await getCollection().findOneAndUpdate(
    { order_number: orderNumber },
    {
      $set,
      $push: {
        status_history: {
          action: 'STATUS_CHANGE',
          status: nextStatus,
          actor: actorName,
          note: technicianNotes || '',
          at: now
        }
      }
    },
    { returnDocument: 'after' }
  );

  return toDomainOrder(updated);
}

/**
 * 元オーダーへの「中止」フラグ立て（物理削除禁止）
 */
async function flagCancelled(orderNumber, reason, actorName) {
  const now = new Date();
  const updated = await getCollection().findOneAndUpdate(
    { order_number: orderNumber },
    {
      $set: {
        is_cancelled: true,
        cancelled_at: now,
        cancelled_by: actorName,
        cancel_reason: reason || 'オーダー中止',
        order_status: 'CANCELLED',
        updated_at: now
      },
      $push: {
        status_history: {
          action: 'CANCELLED',
          status: 'CANCELLED',
          actor: actorName,
          note: reason || 'オーダー中止',
          at: now
        }
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainOrder(updated);
}

/**
 * 元オーダーへ「訂正済（置換）」フラグを立て、新オーダーを追記（直接修正禁止）
 */
async function supersedeAndAppend(originalOrderNumber, newRecord, actorName, revisionNote) {
  const now = new Date();
  const created = await createOrder({
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
  createOrder,
  upsertSeedOrder,
  findByOrderNumber,
  findByPatientId,
  findOrders,
  countSummary,
  updateExecutionStatus,
  flagCancelled,
  supersedeAndAppend
};
