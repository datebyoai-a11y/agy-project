'use strict';

const { getDB } = require('../db/connection');

/**
 * 患者情報リポジトリ（MongoDB実装）
 * 将来的な MySQL 移行を見据え、フラットなカラム構成（snake_case）と
 * リポジトリインターフェースでデータアクセス層を分離している。
 */
const COLLECTION_NAME = 'patients';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function calculateAge(birthDateStr) {
  if (!birthDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(birthDateStr)) {
    return null;
  }
  const [y, m, d] = birthDateStr.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function normalizeDiagnosesToDb(diagnoses) {
  if (!Array.isArray(diagnoses)) return [];
  return diagnoses
    .map((d, idx) => ({
      diagnosis_id: String(d.diagnosis_id || d.diagnosisId || `DX-${Date.now()}-${idx + 1}`).trim(),
      name: String(d.name || '').trim(),
      start_date: String(d.start_date || d.startDate || '').trim(),
      end_date: String(d.end_date || d.endDate || '').trim(),
      outcome: String(d.outcome || '継続').trim()
    }))
    .filter((d) => d.name.length > 0);
}

function toDomainDiagnoses(diagnoses) {
  if (!Array.isArray(diagnoses)) return [];
  return diagnoses
    .map((d, idx) => ({
      diagnosisId: d.diagnosis_id || `DX-${idx + 1}`,
      name: d.name || '',
      startDate: d.start_date || '',
      endDate: d.end_date || '',
      outcome: d.outcome || '継続'
    }))
    .filter((d) => d.name.length > 0);
}

function toDomainPatient(doc) {
  if (!doc) return null;
  const birthDate = doc.birth_date || '';
  return {
    id: String(doc._id),
    patientId: doc.patient_id,
    fullName: doc.full_name || '',
    kana: doc.kana || '',
    birthDate,
    age: calculateAge(birthDate),
    gender: doc.gender || '不明',
    careCategory: doc.care_category || 'outpatient',
    wardRoom: doc.ward_room || '',
    bloodType: doc.blood_type || '不明',
    allergies: doc.allergies || '',
    cautions: doc.cautions || '',
    diagnoses: toDomainDiagnoses(doc.diagnoses),
    insuranceType: doc.insurance_type || '',
    phone: doc.phone || '',
    emergencyContact: doc.emergency_contact || '',
    notes: doc.notes || '',
    isActive: doc.is_active !== false,
    updatedBy: doc.updated_by || null,
    createdAt: doc.created_at || null,
    updatedAt: doc.updated_at || null
  };
}

async function ensureIndexes() {
  const col = getCollection();
  await col.createIndex({ patient_id: 1 }, { unique: true });
  await col.createIndex({ care_category: 1, is_active: 1 });
  await col.createIndex({ full_name: 1 });
}

async function findAll() {
  const docs = await getCollection()
    .find({})
    .sort({ patient_id: 1 })
    .toArray();
  return docs.map(toDomainPatient);
}

async function findByPatientId(patientId) {
  const normalized = String(patientId || '').trim();
  if (!normalized) return null;
  const doc = await getCollection().findOne({ patient_id: normalized });
  return toDomainPatient(doc);
}

async function upsertSeedPatient(record) {
  const now = new Date();
  await getCollection().updateOne(
    { patient_id: record.patient_id },
    {
      $setOnInsert: {
        patient_id: record.patient_id,
        full_name: record.full_name,
        kana: record.kana || '',
        birth_date: record.birth_date || '',
        gender: record.gender || '不明',
        care_category: record.care_category || 'outpatient',
        ward_room: record.ward_room || '',
        blood_type: record.blood_type || '不明',
        allergies: record.allergies || '',
        cautions: record.cautions || '',
        diagnoses: normalizeDiagnosesToDb(record.diagnoses),
        insurance_type: record.insurance_type || '',
        phone: record.phone || '',
        emergency_contact: record.emergency_contact || '',
        notes: record.notes || '',
        is_active: record.is_active !== false,
        updated_by: 'system',
        created_at: now,
        updated_at: now
      }
    },
    { upsert: true }
  );
}

async function createPatient(record, updatedBy) {
  const now = new Date();
  const doc = {
    patient_id: record.patient_id,
    full_name: record.full_name,
    kana: record.kana || '',
    birth_date: record.birth_date || '',
    gender: record.gender || '不明',
    care_category: record.care_category || 'outpatient',
    ward_room: record.ward_room || '',
    blood_type: record.blood_type || '不明',
    allergies: record.allergies || '',
    cautions: record.cautions || '',
    diagnoses: normalizeDiagnosesToDb(record.diagnoses),
    insurance_type: record.insurance_type || '',
    phone: record.phone || '',
    emergency_contact: record.emergency_contact || '',
    notes: record.notes || '',
    is_active: record.is_active !== false,
    updated_by: updatedBy || 'system',
    created_at: now,
    updated_at: now
  };
  await getCollection().insertOne(doc);
  return toDomainPatient(doc);
}

async function updatePatient(patientId, updates, updatedBy) {
  const now = new Date();
  const $set = {
    full_name: updates.full_name,
    kana: updates.kana || '',
    birth_date: updates.birth_date || '',
    gender: updates.gender || '不明',
    care_category: updates.care_category || 'outpatient',
    ward_room: updates.ward_room || '',
    blood_type: updates.blood_type || '不明',
    allergies: updates.allergies || '',
    cautions: updates.cautions || '',
    diagnoses: normalizeDiagnosesToDb(updates.diagnoses),
    insurance_type: updates.insurance_type || '',
    phone: updates.phone || '',
    emergency_contact: updates.emergency_contact || '',
    notes: updates.notes || '',
    is_active: updates.is_active !== false,
    updated_by: updatedBy || 'system',
    updated_at: now
  };

  const result = await getCollection().findOneAndUpdate(
    { patient_id: patientId },
    { $set },
    { returnDocument: 'after' }
  );
  return toDomainPatient(result);
}

async function setPatientActive(patientId, isActive, updatedBy) {
  const now = new Date();
  const result = await getCollection().findOneAndUpdate(
    { patient_id: patientId },
    {
      $set: {
        is_active: Boolean(isActive),
        updated_by: updatedBy || 'system',
        updated_at: now
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainPatient(result);
}

async function updatePatientLocation(patientId, careCategory, wardRoom, updatedBy) {
  const now = new Date();
  const result = await getCollection().findOneAndUpdate(
    { patient_id: patientId },
    {
      $set: {
        care_category: careCategory,
        ward_room: String(wardRoom || '').trim(),
        updated_by: updatedBy || 'system',
        updated_at: now
      }
    },
    { returnDocument: 'after' }
  );
  return toDomainPatient(result);
}

async function migrateCareFacilityCategory() {
  await getCollection().updateMany(
    { care_category: 'care_facility' },
    { $set: { care_category: 'care_umikaze', updated_at: new Date() } }
  );
}

async function backfillSeedCautions(items) {
  const col = getCollection();
  for (const item of items) {
    if (!item.cautions) continue;
    await col.updateOne(
      { patient_id: item.patient_id, cautions: { $exists: false } },
      { $set: { cautions: item.cautions, updated_at: new Date() } }
    );
  }
}

async function backfillSeedDiagnoses(items) {
  const col = getCollection();
  for (const item of items) {
    if (!Array.isArray(item.diagnoses) || item.diagnoses.length === 0) continue;
    await col.updateOne(
      { patient_id: item.patient_id, diagnoses: { $exists: false } },
      { $set: { diagnoses: normalizeDiagnosesToDb(item.diagnoses), updated_at: new Date() } }
    );
  }
}

module.exports = {
  calculateAge,
  ensureIndexes,
  findAll,
  findByPatientId,
  upsertSeedPatient,
  createPatient,
  updatePatient,
  setPatientActive,
  updatePatientLocation,
  migrateCareFacilityCategory,
  backfillSeedCautions,
  backfillSeedDiagnoses
};
