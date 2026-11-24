'use strict';

const { getDB } = require('../db/connection');

/**
 * 職種別可能オーダー権限リポジトリ（MongoDB実装）
 * MySQL 移行を見据え、(role_code, order_type_code) を複合ユニークキーとする
 * フラットなテーブル構造で保持する。
 */
const COLLECTION_NAME = 'role_order_permissions';

function getCollection() {
  return getDB().collection(COLLECTION_NAME);
}

function toDomainPermission(doc) {
  if (!doc) return null;
  return {
    roleCode: doc.role_code,
    orderTypeCode: doc.order_type_code,
    canCreate: Boolean(doc.can_create),
    canExecute: Boolean(doc.can_execute),
    updatedAt: doc.updated_at || null,
    updatedBy: doc.updated_by || null
  };
}

async function ensureIndexes() {
  await getCollection().createIndex(
    { role_code: 1, order_type_code: 1 },
    { unique: true }
  );
}

async function seedDefaults(defaults) {
  await ensureIndexes();
  const now = new Date();
  const ops = defaults.map((entry) => ({
    updateOne: {
      filter: {
        role_code: entry.role_code,
        order_type_code: entry.order_type_code
      },
      update: {
        $setOnInsert: {
          role_code: entry.role_code,
          order_type_code: entry.order_type_code,
          can_create: Boolean(entry.can_create),
          can_execute: Boolean(entry.can_execute),
          created_at: now,
          updated_at: now,
          updated_by: 'system'
        }
      },
      upsert: true
    }
  }));

  if (ops.length > 0) {
    await getCollection().bulkWrite(ops, { ordered: false });
  }
}

async function findAll() {
  const docs = await getCollection()
    .find({})
    .sort({ role_code: 1, order_type_code: 1 })
    .toArray();
  return docs.map(toDomainPermission);
}

async function saveMatrix(entries, updatedBy) {
  const now = new Date();
  const ops = entries.map((entry) => ({
    updateOne: {
      filter: {
        role_code: entry.roleCode,
        order_type_code: entry.orderTypeCode
      },
      update: {
        $set: {
          can_create: Boolean(entry.canCreate),
          can_execute: Boolean(entry.canExecute),
          updated_at: now,
          updated_by: updatedBy || 'system'
        },
        $setOnInsert: {
          created_at: now
        }
      },
      upsert: true
    }
  }));

  if (ops.length > 0) {
    await getCollection().bulkWrite(ops, { ordered: false });
  }
  return findAll();
}

module.exports = {
  ensureIndexes,
  seedDefaults,
  findAll,
  saveMatrix
};
