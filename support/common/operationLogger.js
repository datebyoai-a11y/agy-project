/**
 * 🏥 交雄会だて病院 医療統合システム 統一操作・監査ロガー (operationLogger.js)
 * 
 * 目的:
 *  1. 各システム（放射線科オーダー、指示受けモニタ、電子カルテ等）で行われる「それぞれの操作」に対し、
 *     人間が直接読んで理解できる【可読性のあるログ】を生成・記録。
 *  2. 同時に、ログからデータベースを 100% 正確に再構築（Replay/Restore）できる
 *     完全な【構造化イベントログ (JSON Lines)】を永続化。
 *  3. 【日次ローテーション & .gz 自動圧縮保存】:
 *     ログは一日ごとに日別ファイル（operations_YYYY-MM-DD.jsonl / .readable.log）として記録され、
 *     過去日付分は自動的に .gz（gzip形式）に圧縮アーカイブ保存。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// ログ保存先ディレクトリ
const LOGS_DIR = path.resolve(__dirname, '../../logs/operations');
const ACTIVE_JSONL_PATH = path.join(LOGS_DIR, 'operations.jsonl');
const ACTIVE_READABLE_PATH = path.join(LOGS_DIR, 'operations.readable.log');

// ディレクトリ確保
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * 日本時間 (JST) の日付文字列 (YYYY-MM-DD) を取得
 */
function getJstDateString(date = new Date()) {
  const d = new Date(date);
  const jstDate = new Date(d.getTime() + (9 * 60 * 60 * 1000));
  const yyyy = jstDate.getUTCFullYear();
  const mm = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jstDate.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 日本時間 (JST) のフォーマット日時文字列を取得
 */
function getJstFormattedString(date = new Date()) {
  const d = new Date(date);
  const jstDate = new Date(d.getTime() + (9 * 60 * 60 * 1000));
  const yyyy = jstDate.getUTCFullYear();
  const mm = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jstDate.getUTCDate()).padStart(2, '0');
  const hh = String(jstDate.getUTCHours()).padStart(2, '0');
  const min = String(jstDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(jstDate.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} JST`;
}

/**
 * MongooseドキュメントまたはオブジェクトをプレーンなJSONオブジェクトに変換
 */
function toPlainObject(doc) {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ depopulate: true, virtuals: false });
  }
  if (typeof doc.toJSON === 'function') {
    return doc.toJSON();
  }
  return JSON.parse(JSON.stringify(doc));
}

/**
 * 単一ファイルを .gz に圧縮し、元ファイルを安全に削除
 */
function compressFileToGz(srcPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(srcPath)) return resolve(false);
    const destPath = srcPath + '.gz';
    const tmpDestPath = destPath + '.tmp';

    const readStream = fs.createReadStream(srcPath);
    const writeStream = fs.createWriteStream(tmpDestPath);
    const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });

    readStream.pipe(gzip).pipe(writeStream);

    writeStream.on('finish', () => {
      try {
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        fs.renameSync(tmpDestPath, destPath);
        fs.unlinkSync(srcPath);
        console.log(`📦 [LogRotate] ログ圧縮完了: ${path.basename(destPath)}`);
        resolve(true);
      } catch (err) {
        reject(err);
      }
    });

    writeStream.on('error', err => {
      try { if (fs.existsSync(tmpDestPath)) fs.unlinkSync(tmpDestPath); } catch (_) {}
      reject(err);
    });
    readStream.on('error', reject);
    gzip.on('error', reject);
  });
}

/**
 * 過去日付の未圧縮ログファイルをスキャンし、すべて .gz にローテート圧縮
 */
async function rotateOldLogs() {
  try {
    const todayStr = getJstDateString();
    const files = fs.readdirSync(LOGS_DIR);

    for (const file of files) {
      const match = file.match(/^operations_(\d{4}-\d{2}-\d{2})\.(jsonl|readable\.log)$/);
      if (match) {
        const fileDate = match[1];
        // 今日以外の日付のファイルであれば圧縮
        if (fileDate !== todayStr) {
          const fullPath = path.join(LOGS_DIR, file);
          await compressFileToGz(fullPath);
        }
      }
    }
  } catch (err) {
    console.error('❌ [LogRotate] ローテーション実行エラー:', err.message);
  }
}

/**
 * 常に最新の当日ログファイルを指すシンボリックリンクを更新
 */
function updateActiveSymlinks(todayStr) {
  try {
    const targetJsonl = `operations_${todayStr}.jsonl`;
    const targetReadable = `operations_${todayStr}.readable.log`;

    // JSONL symlink
    if (fs.existsSync(ACTIVE_JSONL_PATH)) {
      const stat = fs.lstatSync(ACTIVE_JSONL_PATH);
      if (stat.isSymbolicLink()) {
        const curTarget = fs.readlinkSync(ACTIVE_JSONL_PATH);
        if (curTarget !== targetJsonl) {
          fs.unlinkSync(ACTIVE_JSONL_PATH);
          fs.symlinkSync(targetJsonl, ACTIVE_JSONL_PATH);
        }
      }
    } else {
      fs.symlinkSync(targetJsonl, ACTIVE_JSONL_PATH);
    }

    // Readable log symlink
    if (fs.existsSync(ACTIVE_READABLE_PATH)) {
      const stat = fs.lstatSync(ACTIVE_READABLE_PATH);
      if (stat.isSymbolicLink()) {
        const curTarget = fs.readlinkSync(ACTIVE_READABLE_PATH);
        if (curTarget !== targetReadable) {
          fs.unlinkSync(ACTIVE_READABLE_PATH);
          fs.symlinkSync(targetReadable, ACTIVE_READABLE_PATH);
        }
      }
    } else {
      fs.symlinkSync(targetReadable, ACTIVE_READABLE_PATH);
    }
  } catch (_) {
    // シンボリックリンクのエラーは実ファイルの書き込みに影響を与えないよう握る
  }
}

/**
 * 📝 操作ログを記録 (日別ファイルへの追記 & 日次ローテーション連動)
 */
async function logOperation(params) {
  try {
    const now = new Date();
    const todayStr = getJstDateString(now);
    const timestampJst = getJstFormattedString(now);
    const logId = `op_${now.getTime()}_${crypto.randomBytes(4).toString('hex')}`;

    const {
      system = 'system',
      opType = 'GENERAL_OP',
      action = 'UPDATE',
      collection = 'general',
      documentId = '',
      operator = {},
      summary = '',
      details = {},
      snapshot = null,
      meta = {}
    } = params;

    const plainSnapshot = snapshot ? toPlainObject(snapshot) : null;
    const docIdStr = documentId ? String(documentId) : (plainSnapshot?._id ? String(plainSnapshot._id) : '');

    // 1. 機械可読・DB再構築用 JSON Lines エントリ
    const jsonEntry = {
      version: 1,
      logId,
      timestamp: now.toISOString(),
      timestampJst,
      system,
      opType,
      action: action.toUpperCase(),
      collection: collection.toLowerCase(),
      documentId: docIdStr,
      operator: {
        id: operator.id || '',
        name: operator.name || '担当者',
        role: operator.role || '',
        department: operator.department || '',
        ip: operator.ip || ''
      },
      summary,
      details,
      meta,
      snapshot: plainSnapshot
    };

    const jsonLine = JSON.stringify(jsonEntry) + '\n';

    // 2. 人間が直接エディタやless、catで読んで理解できる【可読性のあるログ】
    const operatorStr = `${operator.name || '担当者'}${operator.department ? ` (${operator.department})` : ''}${operator.role ? ` [${operator.role}]` : ''}${operator.ip ? ` @${operator.ip}` : ''}`;
    
    let detailsBlock = '';
    if (details && Object.keys(details).length > 0) {
      detailsBlock = '【詳細項目】\n' + Object.entries(details)
        .map(([k, v]) => `  ・${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n') + '\n';
    }

    const readableEntry = [
      '================================================================================',
      `[${timestampJst}] [${opType}] システム: ${system.toUpperCase()} | 操作種別: ${action.toUpperCase()}`,
      `ログID: ${logId}`,
      `操作者: ${operatorStr}`,
      `対象: ${collection} (ID: ${docIdStr})`,
      `要約: ${summary}`,
      detailsBlock ? detailsBlock.trimEnd() : null,
      '================================================================================\n'
    ].filter(Boolean).join('\n');

    // 3. 日別ログファイルへ書き込み
    const dailyJsonlPath = path.join(LOGS_DIR, `operations_${todayStr}.jsonl`);
    const dailyReadablePath = path.join(LOGS_DIR, `operations_${todayStr}.readable.log`);

    fs.appendFileSync(dailyJsonlPath, jsonLine, 'utf8');
    fs.appendFileSync(dailyReadablePath, readableEntry, 'utf8');

    // シンボリックリンク更新
    updateActiveSymlinks(todayStr);

    // 過去日付の未圧縮ログがあれば非同期で .gz 圧縮
    rotateOldLogs().catch(() => {});

    return { success: true, logId };
  } catch (err) {
    console.error('❌ [OperationLogger] ログ記録エラー:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 📜 保存されているログアーカイブ（.gz および 当日ファイル）の一覧を取得
 */
function getLogArchivesList() {
  try {
    if (!fs.existsSync(LOGS_DIR)) return [];
    const files = fs.readdirSync(LOGS_DIR);
    const archives = [];

    for (const file of files) {
      if (file.startsWith('operations_') && (file.endsWith('.jsonl') || file.endsWith('.jsonl.gz') || file.endsWith('.readable.log') || file.endsWith('.readable.log.gz'))) {
        const fullPath = path.join(LOGS_DIR, file);
        const stat = fs.statSync(fullPath);
        archives.push({
          filename: file,
          isGz: file.endsWith('.gz'),
          type: file.includes('.readable.') ? 'readable' : 'jsonl',
          sizeBytes: stat.size,
          sizeKb: (stat.size / 1024).toFixed(1) + ' KB',
          mtime: stat.mtime
        });
      }
    }

    return archives.sort((a, b) => b.filename.localeCompare(a.filename));
  } catch (err) {
    console.error('❌ [OperationLogger] アーカイブ一覧取得エラー:', err);
    return [];
  }
}

/**
 * 📜 最新の機械可読ログ（JSON）を取得
 */
function getRecentLogs(limit = 100) {
  try {
    const todayStr = getJstDateString();
    const dailyJsonlPath = path.join(LOGS_DIR, `operations_${todayStr}.jsonl`);
    const targetPath = fs.existsSync(dailyJsonlPath) ? dailyJsonlPath : ACTIVE_JSONL_PATH;

    if (!fs.existsSync(targetPath)) return [];
    const content = fs.readFileSync(targetPath, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n');
    const recent = lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
    return recent.reverse();
  } catch (err) {
    console.error('❌ [OperationLogger] ログ読込エラー:', err);
    return [];
  }
}

/**
 * 📖 最新の人間可読テキストログを取得
 */
function getRecentReadableLog(limitLines = 300) {
  try {
    const todayStr = getJstDateString();
    const dailyReadablePath = path.join(LOGS_DIR, `operations_${todayStr}.readable.log`);
    const targetPath = fs.existsSync(dailyReadablePath) ? dailyReadablePath : ACTIVE_READABLE_PATH;

    if (!fs.existsSync(targetPath)) return '（本日のログはまだありません）';
    const content = fs.readFileSync(targetPath, 'utf8');
    const lines = content.split('\n');
    return lines.slice(-limitLines).join('\n');
  } catch (err) {
    console.error('❌ [OperationLogger] 可読ログ読込エラー:', err);
    return `ログ読込エラー: ${err.message}`;
  }
}

module.exports = {
  logOperation,
  getRecentLogs,
  getRecentReadableLog,
  getLogArchivesList,
  rotateOldLogs,
  compressFileToGz,
  getJstDateString,
  getJstFormattedString,
  LOGS_DIR,
  ACTIVE_JSONL_PATH,
  ACTIVE_READABLE_PATH
};
