'use strict';

const { getDB } = require('../db/connection');

/**
 * 臨時処方箋リポジトリ（MongoDB実装）
 * - 将来の MySQL 移行を見据えたフラットなスネークケース構造
 * - 薬剤項目: 薬剤名・1日量・分割回数・服用方法・処方日数・備考欄
 * - AGENTS.md ルール準拠: 物理削除・直接上書きは行わず、
 *   中止・訂正時は元レコードへフラグ (is_cancelled / is_superseded) を立て、
 *   訂正時は新レコードを追記 (parent_order_number) する。
 */
const COLLECTION_NAME = 'prescriptions';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function normalizeStoredItems(doc) {
  if (Array.isArray(doc.items) && doc.items.length > 0) {
    return doc.items.map((it, idx) => ({
      lineNo: it.line_no || idx + 1,
      drugId: it.drug_id || '',
      drugName: it.drug_name || '',
      genericName: it.generic_name || '',
      spec: it.spec || '',
      unit: it.unit || '',
      category: it.category || '内服薬',
      dailyDose: it.daily_dose || '',
      divisionCount: it.division_count || '',
      administrationMethod: it.administration_method || '',
      prescriptionDays: it.prescription_days != null ? Number(it.prescription_days) : 1,
      dayUnit: it.day_unit || '日分',
      note: it.note || '',
      suspensionOk: it.suspension_ok || '',
      crushOk: it.crush_ok || ''
    }));
  }

  // 旧 rp_items 形式からの互換変換
  if (Array.isArray(doc.rp_items) && doc.rp_items.length > 0) {
    const flat = [];
    let lineNo = 1;
    for (const rp of doc.rp_items) {
      for (const m of rp.medicines || []) {
        flat.push({
          lineNo: lineNo++,
          drugId: m.drugId || '',
          drugName: m.name || '',
          genericName: m.genericName || '',
          spec: m.spec || '',
          unit: m.unit || '',
          category: m.category || '内服薬',
          dailyDose: m.dose || '',
          divisionCount: '',
          administrationMethod: rp.usage || '',
          prescriptionDays: rp.days != null ? Number(rp.days) : 1,
          dayUnit: rp.dayUnit || '日分',
          note: rp.note || '',
          suspensionOk: m.suspensionOk || '',
          crushOk: m.crushOk || ''
        });
      }
    }
    return flat;
  }

  return [];
}

function toCompatRpItems(items) {
  return items.map((it, idx) => {
    const divStr = it.divisionCount ? `分${it.divisionCount}` : '';
    const usageStr = [divStr, it.administrationMethod].filter(Boolean).join(' ');
    return {
      rpNo: idx + 1,
      medicines: [
        {
          drugId: it.drugId,
          name: it.drugName,
          genericName: it.genericName,
          spec: it.spec,
          unit: it.unit,
          dose: it.dailyDose
        }
      ],
      usage: usageStr || '-',
      days: it.prescriptionDays,
      dayUnit: it.dayUnit,
      note: it.note
    };
  });
}

function toDomainPrescription(doc) {
  if (!doc) return null;
  const items = normalizeStoredItems(doc);
  return {
    id: String(doc._id),
    orderNumber: doc.order_number,
    prescriptionType: doc.prescription_type || '臨時処方',
    dispenseType: doc.dispense_type || '院内処方',
    startDate: doc.start_date || '',
    patientId: doc.patient_id,
    patientName: doc.patient_name,
    patientKana: doc.patient_kana || '',
    gender: doc.gender || '不明',
    age: doc.age != null ? doc.age : null,
    birthDate: doc.birth_date || '',
    ward: doc.ward || '外来',
    room: doc.room || '',
    sourceDepartment: doc.source_department || '',
    doctorName: doc.doctor_name || '',
    orderedByStaffId: doc.ordered_by_staff_id || '',
    items,
    rpItems: toCompatRpItems(items),
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
    doSourceOrderNumber: doc.do_source_order_number || '',
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
  const prefix = `RX-${y}${m}${d}-`;

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

async function createPrescription(record) {
  const now = new Date();
  const orderNumber = record.order_number || (await generateOrderNumber());
  const doc = {
    order_number: orderNumber,
    prescription_type: record.prescription_type || '臨時処方',
    dispense_type: record.dispense_type || '院内処方',
    start_date: record.start_date || now.toISOString().slice(0, 10),
    patient_id: record.patient_id,
    patient_name: record.patient_name,
    patient_kana: record.patient_kana || '',
    gender: record.gender || '不明',
    age: record.age != null ? record.age : null,
    birth_date: record.birth_date || '',
    ward: record.ward || '外来',
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
    do_source_order_number: record.do_source_order_number || '',
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
  return toDomainPrescription(doc);
}

async function findByOrderNumber(orderNumber) {
  const doc = await getCollection().findOne({ order_number: String(orderNumber || '').trim() });
  return toDomainPrescription(doc);
}

async function findByPatientId(patientId, limit = 50) {
  const docs = await getCollection()
    .find({ patient_id: String(patientId || '').trim() })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainPrescription);
}

async function findAll({ includeInactive = true, limit = 100 } = {}) {
  const filter = includeInactive ? {} : { is_cancelled: { $ne: true }, is_superseded: { $ne: true } };
  const docs = await getCollection()
    .find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toDomainPrescription);
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
        cancel_reason: reason || '処方中止',
        order_status: 'CANCELLED',
        updated_at: now
      },
      $push: {
        status_history: {
          action: 'CANCELLED',
          status: 'CANCELLED',
          actor: actorName,
          note: reason || '処方中止',
          at: now
        }
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainPrescription(updated);
}

async function supersedeAndAppend(originalOrderNumber, newRecord, actorName, revisionNote) {
  const now = new Date();
  const created = await createPrescription({
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
  createPrescription,
  findByOrderNumber,
  findByPatientId,
  findAll,
  flagCancelled,
  supersedeAndAppend
};
