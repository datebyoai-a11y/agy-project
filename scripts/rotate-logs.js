#!/usr/bin/env node
/**
 * 📦 ログ日次ローテーション＆.gz圧縮アーカイブスクリプト (rotate-logs.js)
 * 
 * 使い方:
 *   node scripts/rotate-logs.js [オプション]
 * 
 * オプション:
 *   --date=<YYYY-MM-DD> : 特定の日付のログをローテート・圧縮
 *   --force             : 当日分のログも含めて強制的に圧縮ローテート
 *   --migrate           : 単一の operations.jsonl / operations.readable.log を日付別に分割して過去分を圧縮
 *   --help              : ヘルプ表示
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const {
  LOGS_DIR,
  compressFileToGz,
  getJstDateString
} = require('../support/common/operationLogger');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📦 ログ日次ローテーション＆.gz圧縮アーカイブツール

使い方:
  node scripts/rotate-logs.js [オプション]

オプション:
  --force             : 当日分のログも含めて即時圧縮アーカイブ
  --date=<YYYY-MM-DD> : 指定日付のログのみを圧縮アーカイブ
  --migrate           : 既存の operations.jsonl / .log を日付ごとに分割して過去分を圧縮
  --help              : このヘルプを表示
  `);
  process.exit(0);
}

const isForce = args.includes('--force');
const isMigrate = args.includes('--migrate');
const dateArg = args.find(a => a.startsWith('--date='));
const targetDate = dateArg ? dateArg.split('=')[1] : null;

async function migrateSingleFile() {
  console.log('🔄 既存ログファイルの日付別分割・マイグレーションを開始します...');
  const mainJsonl = path.join(LOGS_DIR, 'operations.jsonl');
  const mainReadable = path.join(LOGS_DIR, 'operations.readable.log');

  if (fs.existsSync(mainJsonl) && !fs.lstatSync(mainJsonl).isSymbolicLink()) {
    const fileStream = fs.createReadStream(mainJsonl, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const dateBuckets = {};

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        const dateStr = entry.timestampJst ? entry.timestampJst.slice(0, 10) : getJstDateString(entry.timestamp);
        if (!dateBuckets[dateStr]) dateBuckets[dateStr] = [];
        dateBuckets[dateStr].push(trimmed);
      } catch (_) {}
    }

    for (const [dStr, lines] of Object.entries(dateBuckets)) {
      const destFile = path.join(LOGS_DIR, `operations_${dStr}.jsonl`);
      fs.writeFileSync(destFile, lines.join('\n') + '\n', 'utf8');
      console.log(`  📄 [${dStr}] ${lines.length} 行を operations_${dStr}.jsonl に保存`);
    }

    // 元の非シンボリックリンクファイルを退避して削除
    const backupPath = mainJsonl + '.bak';
    fs.renameSync(mainJsonl, backupPath);
  }

  // readable.log の移行
  if (fs.existsSync(mainReadable) && !fs.lstatSync(mainReadable).isSymbolicLink()) {
    const todayStr = getJstDateString();
    const destFile = path.join(LOGS_DIR, `operations_${todayStr}.readable.log`);
    if (!fs.existsSync(destFile)) {
      fs.copyFileSync(mainReadable, destFile);
    }
    const backupReadable = mainReadable + '.bak';
    fs.renameSync(mainReadable, backupReadable);
  }
}

async function runRotation() {
  console.log('================================================================');
  console.log('📦 ログ日次ローテーション＆ .gz 圧縮アーカイブ');
  console.log('================================================================');
  console.log(`📁 ログディレクトリ: ${LOGS_DIR}`);
  const todayStr = getJstDateString();
  console.log(`📅 本日の日付 (JST): ${todayStr}`);
  console.log('----------------------------------------------------------------');

  if (isMigrate) {
    await migrateSingleFile();
  }

  const files = fs.readdirSync(LOGS_DIR);
  let compressedCount = 0;

  for (const file of files) {
    const match = file.match(/^operations_(\d{4}-\d{2}-\d{2})\.(jsonl|readable\.log)$/);
    if (!match) continue;

    const fileDate = match[1];

    if (targetDate && fileDate !== targetDate) continue;

    // 通常は今日以外の日付のファイルを圧縮 (force の場合は今日でも圧縮)
    if (fileDate !== todayStr || isForce) {
      const fullPath = path.join(LOGS_DIR, file);
      const statBefore = fs.statSync(fullPath);
      console.log(`🗜️ 圧縮中: ${file} (${(statBefore.size / 1024).toFixed(1)} KB)...`);

      try {
        await compressFileToGz(fullPath);
        const gzPath = fullPath + '.gz';
        const statAfter = fs.statSync(gzPath);
        const ratio = ((1 - statAfter.size / statBefore.size) * 100).toFixed(1);
        console.log(`  ✅ 完了: ${file}.gz (${(statAfter.size / 1024).toFixed(1)} KB / 圧縮率: ${ratio}%)`);
        compressedCount++;
      } catch (err) {
        console.error(`  ❌ 圧縮失敗 [${file}]:`, err.message);
      }
    }
  }

  // 最新シンボリックリンクの再確認
  const curJsonl = path.join(LOGS_DIR, `operations_${todayStr}.jsonl`);
  const curReadable = path.join(LOGS_DIR, `operations_${todayStr}.readable.log`);
  const linkJsonl = path.join(LOGS_DIR, 'operations.jsonl');
  const linkReadable = path.join(LOGS_DIR, 'operations.readable.log');

  if (fs.existsSync(curJsonl)) {
    try {
      if (fs.existsSync(linkJsonl) || fs.lstatSync(linkJsonl).isSymbolicLink()) fs.unlinkSync(linkJsonl);
    } catch (_) {}
    try { fs.symlinkSync(`operations_${todayStr}.jsonl`, linkJsonl); } catch (_) {}
  }
  if (fs.existsSync(curReadable)) {
    try {
      if (fs.existsSync(linkReadable) || fs.lstatSync(linkReadable).isSymbolicLink()) fs.unlinkSync(linkReadable);
    } catch (_) {}
    try { fs.symlinkSync(`operations_${todayStr}.readable.log`, linkReadable); } catch (_) {}
  }

  console.log('----------------------------------------------------------------');
  console.log(`🎉 ローテーション完了: 合計 ${compressedCount} 件のログファイルを .gz に圧縮・保存しました。`);
  console.log('================================================================');
}

runRotation().catch(err => {
  console.error('❌ ローテーション処理エラー:', err);
  process.exit(1);
});
