'use strict';

const { getDB } = require('../db/connection');

/**
 * 外来受付リポジトリ（MongoDB実装・追記専用）
 * 将来の MySQL 移行を見据え、フラットな snake_case カラム構成。
 * 取消時も物理削除せず is_cancelled フラグと status_history への追記で管理する。
 */
const COLLECTION_NAME = 'outpatient_receptions';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

const STATUS_LABEL_MAP = {
  WAITING: '診察待',
  IN_EXAM: '診察中',
  ACCOUNTING: '会計待',
  DONE: '完了',
  CANCELLED: '取消'
};

function toDomainReception(doc) {
  if (!doc) return null;
  const status = doc.is_cancelled ? 'CANCELLED' : doc.status || 'WAITING';
  return {
    id: String(doc._id),
    receptionNumber: doc.reception_number,
    visitDate: doc.visit_date || '',
    receptionNo: doc.reception_no || 1,
    patientId: doc.patient_id,
    patientName: doc.patient_name || '',
    patientKana: doc.patient_kana || '',
    gender: doc.gender || '不明',
    age: doc.age != null ? doc.age : null,
    birthDate: doc.birth_date || '',
    visitType: doc.visit_type || '再診',
    clinicDepartment: doc.clinic_department || '内科',
    assignedDoctor: doc.assigned_doctor || '',
    chiefComplaint: doc.chief_complaint || '',
    status,
    statusLabel: STATUS_LABEL_MAP[status] || status,
    isCancelled: Boolean(doc.is_cancelled),
    cancelledAt: doc.cancelled_at || null,
    cancelledBy: doc.cancelled_by || '',
    cancelReason: doc.cancel_reason || '',
    statusHistory: Array.isArray(doc.status_history) ? doc.status_history : [],
    createdBy: doc.created_by || '',
    createdAt: doc.created_at || null,
    updatedAt: doc.updated_at || null
  };
}

async function ensureIndexes() {
  const col = getCollection();
  await col.createIndex({ reception_number: 1 }, { unique: true });
  await col.createIndex({ visit_date: 1, reception_no: 1 });
  await col.createIndex({ patient_id: 1, created_at: -1 });
}

async function generateNextNumbers(visitDate) {
  const ymd = String(visitDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const prefix = `RCP-${ymd}-`;

  const latest = await getCollection()
    .find({ visit_date: visitDate })
    .sort({ reception_no: -1 })
    .limit(1)
    .toArray();

  const nextNo = latest.length > 0 ? Number(latest[0].reception_no || 0) + 1 : 1;
  return {
    receptionNo: nextNo,
    receptionNumber: `${prefix}${String(nextNo).padStart(4, '0')}`
  };
}

async function createReception(record, actor) {
  const now = new Date();
  const visitDate = record.visit_date || now.toISOString().slice(0, 10);
  const { receptionNo, receptionNumber } = await generateNextNumbers(visitDate);

  const doc = {
    reception_number: receptionNumber,
    visit_date: visitDate,
    reception_no: receptionNo,
    patient_id: record.patient_id,
    patient_name: record.patient_name || '',
    patient_kana: record.patient_kana || '',
    gender: record.gender || '不明',
    age: record.age != null ? record.age : null,
    birth_date: record.birth_date || '',
    visit_type: record.visit_type || '再診',
    clinic_department: record.clinic_department || '内科',
    assigned_doctor: record.assigned_doctor || '',
    chief_complaint: record.chief_complaint || '',
    status: 'WAITING',
    is_cancelled: false,
    cancelled_at: null,
    cancelled_by: '',
    cancel_reason: '',
    status_history: [
      {
        at: now,
        action: 'WAITING',
        actor: actor || 'system',
        note: `受付登録（${record.visit_type || '再診'} / ${record.clinic_department || '内科'}）`
      }
    ],
    created_by: actor || 'system',
    created_at: now,
    updated_at: now
  };

  await getCollection().insertOne(doc);
  return toDomainReception(doc);
}

async function findByDate(visitDate, { includeCancelled = true } = {}) {
  const query = { visit_date: visitDate };
  if (!includeCancelled) {
    query.is_cancelled = { $ne: true };
  }
  const docs = await getCollection()
    .find(query)
    .sort({ reception_no: 1 })
    .toArray();
  return docs.map(toDomainReception);
}

async function findByReceptionNumber(receptionNumber) {
  const doc = await getCollection().findOne({ reception_number: String(receptionNumber || '').trim() });
  return toDomainReception(doc);
}

async function updateStatus(receptionNumber, nextStatus, actor, note) {
  const now = new Date();
  const result = await getCollection().findOneAndUpdate(
    { reception_number: receptionNumber, is_cancelled: { $ne: true } },
    {
      $set: {
        status: nextStatus,
        updated_at: now
      },
      $push: {
        status_history: {
          at: now,
          action: nextStatus,
          actor: actor || 'system',
          note: note || `状態変更: ${STATUS_LABEL_MAP[nextStatus] || nextStatus}`
        }
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainReception(result);
}

async function flagCancelled(receptionNumber, reason, actor) {
  const now = new Date();
  const result = await getCollection().findOneAndUpdate(
    { reception_number: receptionNumber },
    {
      $set: {
        status: 'CANCELLED',
        is_cancelled: true,
        cancelled_at: now,
        cancelled_by: actor || 'system',
        cancel_reason: reason || '受付取消',
        updated_at: now
      },
      $push: {
        status_history: {
          at: now,
          action: 'CANCELLED',
          actor: actor || 'system',
          note: reason || '受付取消'
        }
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainReception(result);
}

async function seedInitialIfEmpty(patients) {
  const count = await getCollection().countDocuments();
  if (count > 0) return;
  const outpatient = (patients || []).find((p) => p.careCategory === 'outpatient' && p.isActive);
  if (!outpatient) return;
  const today = new Date().toISOString().slice(0, 10);
  await createReception(
    {
      visit_date: today,
      patient_id: outpatient.patientId,
      patient_name: outpatient.fullName,
      patient_kana: outpatient.kana || '',
      gender: outpatient.gender || '不明',
      age: outpatient.age,
      birth_date: outpatient.birthDate || '',
      visit_type: '再診',
      clinic_department: '内科',
      assigned_doctor: '山田 太郎',
      chief_complaint: '高血圧定期受診'
    },
    'system'
  );
}

module.exports = {
  STATUS_LABEL_MAP,
  ensureIndexes,
  createReception,
  findByDate,
  findByReceptionNumber,
  updateStatus,
  flagCancelled,
  seedInitialIfEmpty
};
