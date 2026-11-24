'use strict';

const { getDB } = require('../db/connection');

/**
 * ユーザーリポジトリ（MongoDB実装）
 * 将来的な MySQL 移行を見据え、フラットなカラム構成（snake_case）と
 * リポジトリインターフェースでデータアクセス層を分離している。
 */
const COLLECTION_NAME = 'users';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function toDomainUser(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    staffId: doc.staff_id,
    fullName: doc.full_name,
    passwordHash: doc.password_hash,
    roleCode: doc.role_code,
    defaultDepartmentCode: doc.default_department_code,
    allowedDepartmentCodes: Array.isArray(doc.allowed_department_codes)
      ? doc.allowed_department_codes
      : [doc.default_department_code],
    isActive: doc.is_active !== false,
    lastLoginAt: doc.last_login_at || null,
    lastDepartmentCode: doc.last_department_code || null,
    createdAt: doc.created_at || null,
    updatedAt: doc.updated_at || null
  };
}

async function ensureIndexes() {
  const col = getCollection();
  await col.createIndex({ staff_id: 1 }, { unique: true });
  await col.createIndex({ role_code: 1, default_department_code: 1 });
}

async function findByStaffId(staffId) {
  const normalized = String(staffId || '').trim();
  if (!normalized) return null;
  const doc = await getCollection().findOne({ staff_id: normalized });
  return toDomainUser(doc);
}

async function findAllActive() {
  const docs = await getCollection()
    .find({ is_active: { $ne: false } })
    .sort({ staff_id: 1 })
    .toArray();
  return docs.map(toDomainUser);
}

async function findActiveDoctors() {
  const docs = await getCollection()
    .find({ is_active: { $ne: false }, role_code: 'doctor' })
    .sort({ staff_id: 1 })
    .toArray();
  return docs.map(toDomainUser);
}

async function migrateCareFacilityDepartments() {
  const col = getCollection();
  const docs = await col
    .find({
      $or: [
        { default_department_code: 'care_facility' },
        { allowed_department_codes: 'care_facility' }
      ]
    })
    .toArray();

  for (const doc of docs) {
    const nextDefault =
      doc.default_department_code === 'care_facility'
        ? 'care_umikaze'
        : doc.default_department_code;
    const expanded = [];
    for (const code of Array.isArray(doc.allowed_department_codes) ? doc.allowed_department_codes : []) {
      if (code === 'care_facility') {
        expanded.push('care_umikaze', 'care_shiokaze');
      } else {
        expanded.push(code);
      }
    }
    const nextAllowed = Array.from(new Set(expanded));
    await col.updateOne(
      { _id: doc._id },
      {
        $set: {
          default_department_code: nextDefault,
          allowed_department_codes: nextAllowed,
          updated_at: new Date()
        }
      }
    );
  }
}

async function findAll() {
  const docs = await getCollection()
    .find({})
    .sort({ staff_id: 1 })
    .toArray();
  return docs.map(toDomainUser);
}

async function createUser(userRecord) {
  const now = new Date();
  const doc = {
    staff_id: userRecord.staff_id,
    full_name: userRecord.full_name,
    password_hash: userRecord.password_hash,
    role_code: userRecord.role_code,
    default_department_code: userRecord.default_department_code,
    allowed_department_codes: userRecord.allowed_department_codes,
    is_active: userRecord.is_active !== false,
    last_login_at: null,
    last_department_code: null,
    created_at: now,
    updated_at: now
  };
  await getCollection().insertOne(doc);
  return toDomainUser(doc);
}

async function updateUser(staffId, updates) {
  const now = new Date();
  const $set = {
    full_name: updates.full_name,
    role_code: updates.role_code,
    default_department_code: updates.default_department_code,
    allowed_department_codes: updates.allowed_department_codes,
    is_active: updates.is_active !== false,
    updated_at: now
  };
  if (updates.password_hash) {
    $set.password_hash = updates.password_hash;
  }
  const result = await getCollection().findOneAndUpdate(
    { staff_id: staffId },
    { $set },
    { returnDocument: 'after' }
  );
  return toDomainUser(result);
}

async function setUserActive(staffId, isActive) {
  const now = new Date();
  const result = await getCollection().findOneAndUpdate(
    { staff_id: staffId },
    { $set: { is_active: Boolean(isActive), updated_at: now } },
    { returnDocument: 'after' }
  );
  return toDomainUser(result);
}

async function upsertUser(userRecord) {
  const now = new Date();
  await getCollection().updateOne(
    { staff_id: userRecord.staff_id },
    {
      $setOnInsert: {
        staff_id: userRecord.staff_id,
        full_name: userRecord.full_name,
        password_hash: userRecord.password_hash,
        role_code: userRecord.role_code,
        default_department_code: userRecord.default_department_code,
        allowed_department_codes: userRecord.allowed_department_codes,
        is_active: userRecord.is_active !== false,
        created_at: now,
        updated_at: now
      }
    },
    { upsert: true }
  );
}

async function updateLastLogin(staffId, departmentCode) {
  const now = new Date();
  await getCollection().updateOne(
    { staff_id: staffId },
    {
      $set: {
        last_login_at: now,
        last_department_code: departmentCode,
        updated_at: now
      }
    }
  );
}

module.exports = {
  ensureIndexes,
  findByStaffId,
  findAllActive,
  findActiveDoctors,
  findAll,
  createUser,
  updateUser,
  setUserActive,
  upsertUser,
  updateLastLogin,
  migrateCareFacilityDepartments
};
