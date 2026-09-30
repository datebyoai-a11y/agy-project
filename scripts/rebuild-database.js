#!/usr/bin/env node
/**
 * 🔄 交雄会だて病院 医療統合システム ログ駆動型 データベース再構築ツール (rebuild-database.js)
 * 
 * 使い方:
 *   node scripts/rebuild-database.js [オプション]
 * 
 * オプション:
 *   --dry-run             : 実際の書き込みを行わず、復元シミュレーションとサマリーのみ表示
 *   --drop                : 復元前に対象コレクションを削除（drop）し、まっさらな状態から完全復元
 *   --target=<collection> : 特定のコレクションのみ再構築（例: --target=radiologyorders）
 *   --log=<file_path>     : 再構築に使用するログファイル（デフォルト: logs/operations/operations.jsonl）
 *   --verbose             : 各操作の詳細をコンソールに出力
 *   --help                : ヘルプを表示
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

// 引数パース
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🏥 交雄会だて病院 データベース再構築ツール (Rebuild Database from Audit Logs)

使い方:
  node scripts/rebuild-database.js [オプション]

オプション:
  --dry-run             : 実際の書き込みを行わず、復元シミュレーションのみ実行
  --drop                : 復元前に対象コレクションを削除し、完全ゼロベースで再構築
  --target=<collection> : 特定のコレクションのみを復元 (例: --target=radiologyorders)
  --log=<path>          : 読み込むログファイルパス (デフォルト: logs/operations/operations.jsonl)
  --verbose             : 操作ごとのログを詳細出力
  --help                : このヘルプを表示
  `);
  process.exit(0);
}

const isDryRun = args.includes('--dry-run');
const isDrop = args.includes('--drop');
const isVerbose = args.includes('--verbose');

const targetArg = args.find(a => a.startsWith('--target='));
const targetCollection = targetArg ? targetArg.split('=')[1].toLowerCase() : null;

const logArg = args.find(a => a.startsWith('--log='));
const logFilePath = logArg 
  ? path.resolve(process.cwd(), logArg.split('=')[1])
  : path.resolve(__dirname, '../logs/operations/operations.jsonl');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'incident_db';

/**
 * ISO 8601 日付文字列かどうか判定
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/;
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * JSONから復元したオブジェクト内の ObjectId / Date 型を再帰的に復元
 */
function restoreTypes(obj, keyName = '') {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // _id や特定のIDフィールドで24桁16進数の場合は ObjectId に変換
    if ((keyName === '_id' || keyName.endsWith('Id') || keyName.endsWith('_id')) && OBJECT_ID_REGEX.test(obj)) {
      try {
        return new ObjectId(obj);
      } catch (_) {
        return obj;
      }
    }
    // 日付フィールドまたはISO文字列の場合は Date に変換
    if (ISO_DATE_REGEX.test(obj)) {
      const parsed = new Date(obj);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, idx) => restoreTypes(item, `${keyName}[${idx}]`));
  }

  if (typeof obj === 'object') {
    const newObj = {};
    for (const [k, v] of Object.entries(obj)) {
      newObj[k] = restoreTypes(v, k);
    }
    return newObj;
  }

  return obj;
}

async function runRebuild() {
  console.log('================================================================');
  console.log('🔄 交雄会だて病院 ログ駆動型データベース再構築 (Rebuild Database)');
  console.log('================================================================');
  console.log(`📄 ログファイル: ${logFilePath}`);
  console.log(`🌐 接続先: ${MONGO_URI}/${DB_NAME}`);
  console.log(`⚙️ モード: ${isDryRun ? '🟡 DRY-RUN (書き込みなし・シミュレーション)' : '🟢 通常実行 (DB書き込み)'}`);
  if (isDrop) console.log('⚠️ --drop 指定: 復元前に対象コレクションを削除します');
  if (targetCollection) console.log(`🎯 復元対象コレクション: ${targetCollection}`);
  console.log('----------------------------------------------------------------');

  if (!fs.existsSync(logFilePath)) {
    console.error(`❌ エラー: ログファイルが見つかりません: ${logFilePath}`);
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const fileStream = fs.createReadStream(logFilePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const droppedCollections = new Set();
  const stats = {
    totalLines: 0,
    parsedOps: 0,
    appliedOps: 0,
    skippedOps: 0,
    errors: 0,
    collections: {}
  };

  const startTime = Date.now();

  for await (const line of rl) {
    stats.totalLines++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (e) {
      console.warn(`⚠️ [Line ${stats.totalLines}] JSONパース失敗:`, e.message);
      stats.errors++;
      continue;
    }

    stats.parsedOps++;

    const colName = (entry.collection || 'general').toLowerCase();

    // フィルタリング対象か確認
    if (targetCollection && colName !== targetCollection) {
      stats.skippedOps++;
      continue;
    }

    if (!stats.collections[colName]) {
      stats.collections[colName] = { insert: 0, update: 0, delete: 0, total: 0 };
    }

    // --drop オプションが指定され、まだ該当コレクションをドロップしていない場合
    if (isDrop && !isDryRun && !droppedCollections.has(colName)) {
      try {
        await db.collection(colName).drop();
        console.log(`🗑️ コレクション [${colName}] をドロップしました（完全再構築用）。`);
      } catch (err) {
        // コレクションが存在しない場合は無視
      }
      droppedCollections.add(colName);
    }

    const action = (entry.action || 'UPDATE').toUpperCase();

    try {
      if (action === 'DELETE') {
        stats.collections[colName].delete++;
        stats.collections[colName].total++;
        stats.appliedOps++;

        if (!isDryRun) {
          const docId = entry.documentId;
          const filter = OBJECT_ID_REGEX.test(docId) ? { _id: new ObjectId(docId) } : { _id: docId };
          await db.collection(colName).deleteOne(filter);
        }
        if (isVerbose) {
          console.log(`[DELETE] ${colName}: ID=${entry.documentId} (${entry.summary || ''})`);
        }
      } else {
        // INSERT または UPDATE
        if (!entry.snapshot) {
          console.warn(`⚠️ [${entry.logId}] snapshot が存在しないためスキップします`);
          stats.skippedOps++;
          continue;
        }

        const fixedDoc = restoreTypes(entry.snapshot);

        if (!fixedDoc._id) {
          if (entry.documentId && OBJECT_ID_REGEX.test(entry.documentId)) {
            fixedDoc._id = new ObjectId(entry.documentId);
          } else if (entry.documentId) {
            fixedDoc._id = entry.documentId;
          } else {
            fixedDoc._id = new ObjectId();
          }
        }

        if (action === 'INSERT') {
          stats.collections[colName].insert++;
        } else {
          stats.collections[colName].update++;
        }
        stats.collections[colName].total++;
        stats.appliedOps++;

        if (!isDryRun) {
          // upsert: true でドキュメントを完全同期
          await db.collection(colName).replaceOne(
            { _id: fixedDoc._id },
            fixedDoc,
            { upsert: true }
          );
        }

        if (isVerbose) {
          console.log(`[${action}] ${colName}: ID=${fixedDoc._id} (${entry.summary || ''})`);
        }
      }
    } catch (opErr) {
      console.error(`❌ 操作適用エラー [${entry.logId}]:`, opErr.message);
      stats.errors++;
    }
  }

  const durationMs = Date.now() - startTime;

  console.log('----------------------------------------------------------------');
  console.log('🎉 データベース再構築が完了しました！');
  console.log('----------------------------------------------------------------');
  console.log(`⏱️ 処理時間: ${durationMs} ms`);
  console.log(`📖 読み込み行数: ${stats.totalLines} 行`);
  console.log(`🔍 解析操作数: ${stats.parsedOps} 件`);
  console.log(`✅ 適用操作数: ${stats.appliedOps} 件`);
  console.log(`⏭️ スキップ: ${stats.skippedOps} 件`);
  console.log(`⚠️ エラー件数: ${stats.errors} 件`);
  console.log('\n📊 コレクション別 復元統計:');

  for (const [col, colStat] of Object.entries(stats.collections)) {
    let currentDbCount = 0;
    if (!isDryRun) {
      try {
        currentDbCount = await db.collection(col).countDocuments();
      } catch (_) {}
    }
    console.log(`  ・[${col}]: 適用 ${colStat.total}件 (INSERT: ${colStat.insert}, UPDATE: ${colStat.update}, DELETE: ${colStat.delete}) ${!isDryRun ? `➔ DB現在件数: ${currentDbCount}件` : ''}`);
  }

  console.log('================================================================');

  await client.close();
}

runRebuild().catch(err => {
  console.error('❌ 再構築処理中に致命的なエラーが発生しました:', err);
  process.exit(1);
});
