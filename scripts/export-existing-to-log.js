#!/usr/bin/env node
/**
 * 📦 既存データベースの初期状態を操作ログとしてエクスポート (export-existing-to-log.js)
 * 
 * 目的:
 *   すでにDB内に存在する放射線オーダーや電子カルテ、患者マスタ等の既存データを
 *   【可読性のあるログ】および【再構築用イベントログ】として初期登録（スナップショット化）します。
 */

const { MongoClient } = require('mongodb');
const { logOperation, JSONL_LOG_PATH } = require('../support/common/operationLogger');
const fs = require('fs');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'incident_db';

const COLLECTIONS_TO_EXPORT = [
  { name: 'radiologyorders', label: '放射線オーダー', idField: 'orderNumber' },
  { name: 'articles', label: '電子カルテ記事', idField: 'title' },
  { name: 'targetpeople', label: '患者・対象者マスタ', idField: 'name' },
  { name: 'patients', label: '患者マスタ', idField: 'name' },
  { name: 'users', label: 'スタッフマスタ', idField: 'userName' }
];

async function exportExisting() {
  console.log('================================================================');
  console.log('📦 既存データベースの初期スナップショットを操作ログへエクスポート');
  console.log('================================================================');
  console.log(`🌐 接続先: ${MONGO_URI}/${DB_NAME}`);
  console.log(`📄 出力先: ${JSONL_LOG_PATH}`);
  console.log('----------------------------------------------------------------');

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  let totalExported = 0;

  for (const item of COLLECTIONS_TO_EXPORT) {
    const colName = item.name;
    const colLabel = item.label;

    try {
      const cursor = db.collection(colName).find({});
      const count = await db.collection(colName).countDocuments();
      console.log(`🔍 [${colName}] (${colLabel}) : ${count} 件をスキャン中...`);

      let colExported = 0;
      while (await cursor.hasNext()) {
        const doc = await cursor.next();

        let summary = `【${colLabel} 初期データ】ID: ${doc._id}`;
        let details = {};

        if (colName === 'radiologyorders') {
          summary = `【放射線オーダー 初期登録】${doc.orderNumber || '--'} 患者: ${doc.patientName || '不明'} (${doc.examType || doc.modality || ''})`;
          details = {
            伝票番号: doc.orderNumber,
            患者氏名: doc.patientName,
            患者ID: doc.patientId,
            モダリティ: doc.modality,
            検査種別: doc.examType,
            検査目的: doc.purpose,
            ステータス: doc.orderStatus,
            PGP署名: doc.pgp?.keyId ? `保証済 (KeyID: ${doc.pgp.keyId})` : '未署名'
          };
        } else if (colName === 'articles') {
          summary = `【電子カルテ 初期登録】${doc.title || '記事'} (対象: ${doc.targetPersonName || doc.targetPersonId || '--'})`;
          details = {
            タイトル: doc.title,
            対象者: doc.targetPersonName,
            種別: doc.category,
            記録者: doc.authorName
          };
        } else if (colName === 'targetpeople' || colName === 'patients') {
          summary = `【患者マスタ 初期登録】${doc.name || '--'} (ID: ${doc.customId || doc.patientId || doc._id})`;
          details = {
            患者氏名: doc.name,
            患者ID: doc.customId || doc.patientId,
            所属: doc.department || doc.ward
          };
        } else if (colName === 'users') {
          summary = `【スタッフマスタ 初期登録】${doc.userName || '--'} (${doc.role || 'user'})`;
          details = {
            氏名: doc.userName,
            ログインID: doc.loginId,
            権限: doc.role,
            部署: doc.department
          };
        }

        await logOperation({
          system: 'migration',
          opType: 'INITIAL_SNAPSHOT',
          action: 'INSERT',
          collection: colName,
          documentId: String(doc._id),
          operator: {
            name: 'システム初期化 (Migration)',
            role: 'system',
            department: '情報システム'
          },
          summary,
          details,
          snapshot: doc,
          meta: { initialExport: true }
        });

        colExported++;
        totalExported++;
      }

      console.log(`  ✅ [${colName}]: ${colExported} 件のエクスポート完了`);
    } catch (colErr) {
      console.warn(`  ⚠️ [${colName}] エクスポート失敗 (スキップ):`, colErr.message);
    }
  }

  console.log('----------------------------------------------------------------');
  console.log(`🎉 合計 ${totalExported} 件の初期ドキュメントを操作ログに永続化しました！`);
  console.log('================================================================');

  await client.close();
}

exportExisting().catch(err => {
  console.error('❌ エクスポート中にエラーが発生しました:', err);
  process.exit(1);
});
