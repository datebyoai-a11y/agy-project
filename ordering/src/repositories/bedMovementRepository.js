'use strict';

const { getDB } = require('../db/connection');

/**
 * ベッド移動履歴リポジトリ（MongoDB実装・追記専用）
 * 入床・退床・同病棟内移動・他病棟移動の監査ログを保持する。
 * 将来のMySQL移行を見据えフラットなsnake_caseスキーマで保存。
 */
const COLLECTION_NAME = 'bed_movements';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function toDomainMovement(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    movementId: doc.movement_id,
    action: doc.action,
    actionLabel: doc.action_label || doc.action,
    patientId: doc.patient_id,
    patientName: doc.patient_name || '',
    fromDepartment: doc.from_department || '',
    fromDepartmentName: doc.from_department_name || '',
    fromRoom: doc.from_room || '',
    toDepartment: doc.to_department || '',
    toDepartmentName: doc.to_department_name || '',
    toRoom: doc.to_room || '',
    reason: doc.reason || '',
    actor: doc.actor || '',
    actorStaffId: doc.actor_staff_id || '',
    movedAt: doc.moved_at || doc.created_at
  };
}

async function ensureIndexes() {
  const col = getCollection();
  await col.createIndex({ movement_id: 1 }, { unique: true });
  await col.createIndex({ patient_id: 1, moved_at: -1 });
  await col.createIndex({ moved_at: -1 });
}

async function generateMovementId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `MOV-${y}${m}${d}-`;

  const latest = await getCollection()
    .find({ movement_id: { $regex: `^${prefix}` } })
    .sort({ movement_id: -1 })
    .limit(1)
    .toArray();

  let seq = 1;
  if (latest.length > 0) {
    const tail = latest[0].movement_id.slice(prefix.length);
    const parsed = parseInt(tail, 10);
    if (!Number.isNaN(parsed)) seq = parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function appendMovement(record) {
  const now = new Date();
  const movementId = record.movement_id || (await generateMovementId());
  const doc = {
    movement_id: movementId,
    action: record.action,
    action_label: record.action_label || record.action,
    patient_id: record.patient_id,
    patient_name: record.patient_name || '',
    from_department: record.from_department || '',
    from_department_name: record.from_department_name || '',
    from_room: record.from_room || '',
    to_department: record.to_department || '',
    to_department_name: record.to_department_name || '',
    to_room: record.to_room || '',
    reason: record.reason || '',
    actor: record.actor || '',
    actor_staff_id: record.actor_staff_id || '',
    moved_at: now,
    created_at: now
  };
  await getCollection().insertOne(doc);
  return toDomainMovement(doc);
}

async function findRecent({ departmentCode, limit = 30 } = {}) {
  const query = departmentCode
    ? { $or: [{ from_department: departmentCode }, { to_department: departmentCode }] }
    : {};
  const docs = await getCollection()
    .find(query)
    .sort({ moved_at: -1 })
    .limit(Math.min(Math.max(Number(limit) || 30, 1), 100))
    .toArray();
  return docs.map(toDomainMovement);
}

module.exports = {
  ensureIndexes,
  appendMovement,
  findRecent
};
