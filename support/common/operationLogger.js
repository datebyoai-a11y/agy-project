/**
 * 🏥 交雄会だて病院 医療統合システム 統一操作・監査ロガー (operationLogger.js)
 * 
 * 目的:
 *  1. 各システム（放射線科オーダー、指示受けモニタ、電子カルテ等）で行われる「それぞれの操作」に対し、
 *     人間が直接読んで理解できる【可読性のあるログ】を生成・記録。
 *  2. 同時に、ログからデータベースを 100% 正確に再構築（Replay/Restore）できる
 *     完全な【構造化イベントログ (JSON Lines)】を永続化。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ログ保存先ディレクトリ
const LOGS_DIR = path.resolve(__dirname, '../../logs/operations');
const JSONL_LOG_PATH = path.join(LOGS_DIR, 'operations.jsonl');
const READABLE_LOG_PATH = path.join(LOGS_DIR, 'operations.readable.log');

// ディレクトリ確保
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * 日本時間 (JST) のフォーマット文字列を取得
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
 * 📝 操作ログを記録
 * 
 * @param {Object} params
 * @param {string} params.system - 発行システム ('radiology' | 'radi-uke' | 'carte' | 'incident' 等)
 * @param {string} params.opType - 操作種別 ('ORDER_CREATE' | 'ORDER_ACCEPT' | 'ORDER_COMPLETE' | 'ORDER_REVERT' | 'ORDER_NOTE' | 'ORDER_PRINT' 等)
 * @param {string} params.action - DB操作種別 ('INSERT' | 'UPDATE' | 'DELETE')
 * @param {string} params.collection - 対象コレクション名 ('radiologyorders' | 'articles' 等)
 * @param {string|Object} params.documentId - 対象ドキュメントID (_id)
 * @param {Object} [params.operator] - 操作者情報 { id, name, role, department, ip }
 * @param {string} params.summary - 人間向け要約文
 * @param {Object} [params.details] - 人間向け詳細項目（Key-Value）
 * @param {Object} [params.snapshot] - 再構築用の完全ドキュメントスナップショット
 * @param {Object} [params.meta] - 補助メタデータ (PGP署名情報、リクエストURLなど)
 */
async function logOperation(params) {
  try {
    const now = new Date();
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
    fs.appendFileSync(JSONL_LOG_PATH, jsonLine, 'utf8');

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

    fs.appendFileSync(READABLE_LOG_PATH, readableEntry, 'utf8');

    return { success: true, logId };
  } catch (err) {
    console.error('❌ [OperationLogger] ログ記録エラー:', err);
    // 業務処理を止めないようエラーを投げるのではなく結果を返す
    return { success: false, error: err.message };
  }
}

/**
 * 📜 最新の機械可読ログ（JSON）を取得
 */
function getRecentLogs(limit = 100) {
  try {
    if (!fs.existsSync(JSONL_LOG_PATH)) return [];
    const content = fs.readFileSync(JSONL_LOG_PATH, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n');
    const recent = lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
    return recent.reverse(); // 新しい順
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
    if (!fs.existsSync(READABLE_LOG_PATH)) return '（ログはまだありません）';
    const content = fs.readFileSync(READABLE_LOG_PATH, 'utf8');
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
  LOGS_DIR,
  JSONL_LOG_PATH,
  READABLE_LOG_PATH,
  getJstFormattedString
};
