const mongoose = require('mongoose');

const ArticleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  targetPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'TargetPerson' },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  category: { type: String, default: '共有メモ' }, // 共有メモ, 申し送り, 事例ナレッジ, 💉 点滴オーダー など
  parentArticle: { type: mongoose.Schema.Types.ObjectId, ref: 'Article' }, // 引用・修正元の親記事
  isCorrection: { type: Boolean, default: false }, // 修正・追記記事フラグ
  
  // 一時的オーバーライド（代行入力）情報
  isOverride: { type: Boolean, default: false }, // 一時代行入力フラグ
  originalAuthor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // 元の入力者（端末操作者・ログインユーザー）


  // 点滴オーダー専用構造データ
  ivOrderDetails: {
    medicine: { type: String },     // 薬剤名
    dose: { type: String },         // 投与量
    rate: { type: String },         // 投与速度・時間
    route: { type: String },        // 投与経路
    remarks: { type: String },      // 指示備考
    scheduledAt: { type: Date }     // 開始日時
  },

  // 食事選択オーダー専用構造データ
  mealOrderDetails: {
    mealType: { type: String },     // 食形態・食種 (例: 常食, 全粥, 刻み食, 減塩食)
    timing: { type: String },       // 提供区分 (例: 毎食, 朝食のみ, 昼食, 夕食)
    stapleFood: { type: String },   // 主食 (例: 米飯, 粥, パン)
    sideDish: { type: String },     // 副食 (例: 常菜, 刻み, ペースト)
    allergies: { type: String },    // アレルギー・禁止食品
    remarks: { type: String },      // 指示備考
    scheduledAt: { type: Date }     // 開始日時
  },

  // 放射線科オーダー専用構造データ
  radiologyOrderDetails: {
    examType: { type: String },     // 検査種別・部位 (例: 単純X線(胸部), 頭部CT, 腰椎MRI)
    modality: { type: String },     // モダリティ (例: X-Ray, CT, MRI, RI, Angio)
    contrast: { type: String },     // 造影有無 (例: 単純(なし), 造影あり)
    portable: { type: String },     // 撮影場所 (例: 放射線科撮影室, 病室ポータブル)
    purpose: { type: String },      // 目的・臨床情報
    remarks: { type: String },      // 指示・注意事項
    scheduledAt: { type: Date }     // 検査予定日時
  },

  // 別ホストとの同期ステータス情報
  remoteSync: {
    isRemoteOrder: { type: Boolean, default: false }, // 外部ホスト受信フラグ
    remoteHost: { type: String, default: '' },        // 送信先または送信元ホストURL
    syncStatus: { type: String, default: 'NONE' },    // NONE, SUCCESS, FAILED, RECEIVED
    syncedAt: { type: Date },
    errorMessage: { type: String }
  },

  // 🔏 PGP改ざん防止電子署名情報
  pgpSignature: {
    signature: { type: String },          // PGP ASCII Armor署名ブロック
    rawSignature: { type: String },       // Base64署名バイナリ
    signedPayload: { type: String },      // 署名対象カノニカルペイロード
    keyId: { type: String },              // 署名鍵Key ID (例: 0x4A8F9C2D)
    fingerprint: { type: String },        // 鍵フィンガープリント
    signedAt: { type: Date },             // 署名発行日時
    signedBy: { type: String },           // 署名者名 (ユーザー名・ログインID)
    signerRole: { type: String },         // 署名者職種・権限
    isOverride: { type: Boolean, default: false }, // 代行入力署名フラグ
    proxyBy: { type: String },            // 代行入力者情報 (例: "看護師花子 (nurse1)")
    algorithm: { type: String, default: 'RSA-SHA256 (OpenPGP Armor)' }
  },

  createdAt: { type: Date, default: Date.now }
});

// 🔒 電子カルテ真正性・改ざん防止規定：記事の削除操作をMongoose層で永久ブロック
const rejectArticleDeletion = function(next) {
  const err = new Error('【削除禁止】電子カルテ診療記録および記事の削除は、真正性保護規程および医療安全管理指針により固く禁止されています。修正は引用ツリー形式で行ってください。');
  next(err);
};

ArticleSchema.pre('deleteOne', rejectArticleDeletion);
ArticleSchema.pre('deleteMany', rejectArticleDeletion);
ArticleSchema.pre('findOneAndDelete', rejectArticleDeletion);
ArticleSchema.pre('findByIdAndDelete', rejectArticleDeletion);
ArticleSchema.pre('findOneAndRemove', rejectArticleDeletion);
ArticleSchema.pre('findByIdAndRemove', rejectArticleDeletion);
ArticleSchema.pre('remove', rejectArticleDeletion);

// 🔒 電子カルテ真正性・改変禁止規定：確定保存された記事の本文・タイトル・署名改変をMongoose層で永久ブロック
ArticleSchema.pre('save', function(next) {
  if (!this.isNew && (this.isModified('content') || this.isModified('title') || this.isModified('author') || this.isModified('targetPerson') || this.isModified('pgpSignature'))) {
    const err = new Error('【改変禁止】確定保存された電子カルテ記事の改変（上書き更新）は真正性保護規程により禁止されています。修正は「引用して修正」機能で追記してください。');
    return next(err);
  }
  next();
});

const rejectArticleUpdate = function(next) {
  const update = this.getUpdate() || {};
  const isModifyingContent = (update.$set && (update.$set.content || update.$set.title || update.$set.author || update.$set.pgpSignature))
    || update.content || update.title || update.author || update.pgpSignature;
  if (isModifyingContent) {
    const err = new Error('【改変禁止】確定保存された電子カルテ記事の改変（上書き更新）は真正性保護規程により禁止されています。修正は「引用して修正」機能で追記してください。');
    return next(err);
  }
  next();
};

ArticleSchema.pre('updateOne', rejectArticleUpdate);
ArticleSchema.pre('updateMany', rejectArticleUpdate);
ArticleSchema.pre('findOneAndUpdate', rejectArticleUpdate);
ArticleSchema.pre('findByIdAndUpdate', rejectArticleUpdate);

module.exports = mongoose.model('Article', ArticleSchema);
