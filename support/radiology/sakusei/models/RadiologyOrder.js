const mongoose = require('mongoose');

const RadiologyOrderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true }, // 例: RAD-20260930-0001
  orderDate: { type: Date, default: Date.now },               // 発行日時
  scheduledDate: { type: Date, default: Date.now },           // 検査予定日時

  // 👤 患者情報 (MongoDB Patient / TargetPerson と連動)
  patientId: { type: String, required: true },
  patientName: { type: String, required: true },
  patientKana: { type: String, default: '' },
  gender: { type: String, default: '不明' },
  age: { type: Number, default: null },
  birthDate: { type: String, default: '' },
  ward: { type: String, default: '' },                        // 病棟 (しおかぜ, うみかぜ, 外来等)
  room: { type: String, default: '' },                        // 病室 (302号室等)
  department: { type: String, default: '内科' },              // 診療科
  mobility: { type: String, default: '徒歩' },                // 移動方法 (徒歩, 車椅子, ベッド, ストレッチャー)
  infection: { type: String, default: '無' },                 // 感染症情報 (無 / 有(MRSA等))

  // 👨‍⚕️ 依頼者情報
  doctorName: { type: String, default: '担当医師' },
  requestDepartment: { type: String, default: '内科' },

  // 🩻 検査フォーム種別 ('CT': CT検査依頼書, 'FLUORO': 透視検査依頼書, 'XRAY': 診療X線照射録)
  formType: { 
    type: String, 
    enum: ['CT', 'FLUORO', 'XRAY'], 
    default: 'CT' 
  },
  formName: { type: String, default: 'ＣＴ検査依頼書' },

  // 🎯 検査詳細
  examType: { type: String, required: true },                 // 検査種別・部位名称 (例: 単純CT(胸部), PEG交換, 胸部一般撮影)
  modality: { type: String, default: 'CT' },                  // CT, 透視, 一般X線
  contrast: { type: String, default: '単純' },                // 単純 / 造影
  dynamicPhase: { type: String, default: '' },                // 2phase, 3phase 等
  portable: { type: String, default: '放射線科撮影室' },      // 撮影室 / ポータブル(病室)
  isPortable: { type: Boolean, default: false },
  portableRoom: { type: String, default: '' },
  
  // 撮影部位リスト (複数選択対応)
  parts: [{ type: String }],                                  // 頭部, 胸部, 腹部 等
  partsDetail: { type: String, default: '' },                 // 部位の詳細・方向 (例: R/L 正・側)

  // 使用薬剤 & 材料
  medications: { type: String, default: '' },                 // 造影剤、ガストログラフィン、キシロカイン等
  materials: { type: String, default: '' },                   // カテーテル型番、シリンジ、ガーゼ等
  
  // 撮影条件
  conditions: {
    kv: { type: String, default: '' },
    ma: { type: String, default: '' },
    sec: { type: String, default: '' },
    mas: { type: String, default: '' },
    distance: { type: String, default: '' },
    raw: { type: String, default: '' }
  },

  // 目的・臨床所見・特記事項
  purpose: { type: String, default: '' },                     // 検査目的・疑い病名
  remarks: { type: String, default: '' },                     // 注意事項・アレルギー等

  // 媒体連携 (DVD作成・画像取込等)
  mediaDvd: { type: String, default: '未' },
  mediaImport: { type: String, default: '未' },
  elecImgAdd: { type: Boolean, default: true },               // 電子画像管理加算

  // 🖨️ 印刷管理情報 (正・控え)
  printStatus: {
    printedCount: { type: Number, default: 0 },               // 印刷回数
    lastPrintedAt: { type: Date, default: null },             // 最終印刷日時
    printedBy: { type: String, default: '' }                  // 印刷実行者
  },

  // 🔗 カルテ・部門連携
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', default: null }, // カルテ記事連携ID
  syncStatus: { type: String, default: 'SAVED' },             // SAVED, SYNCED_CARTE, SYNCED_RECEIVER, FAILED
  // 🛡️ PGP電子署名・真正性保証 (Authenticity & Integrity Assurance)
  pgp: {
    isSigned: { type: Boolean, default: false },               // PGP署名済みフラグ
    signature: { type: String, default: '' },                  // ASCII Armored PGP署名文字列
    payloadHash: { type: String, default: '' },                // 対象ペイロードのSHA-256ハッシュ
    canonicalPayload: { type: String, default: '' },           // 署名対象となった正規化データ(JSON文字列)
    keyId: { type: String, default: '' },                      // 署名鍵のKey ID (例: 4bc55761c5899f82)
    fingerprint: { type: String, default: '' },                // 署名鍵のFingerprint (40桁HEX)
    signer: { type: String, default: '' },                     // 署名者情報 (例: 交雄会だて病院 放射線科 / 担当医)
    signedAt: { type: Date, default: null },                   // 署名生成日時
    algorithm: { type: String, default: 'Ed25519 (OpenPGP)' }, // 暗号アルゴリズム
    verifiedAt: { type: Date, default: null }                  // 最終検証成功日時
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

RadiologyOrderSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (typeof next === 'function') next();
});

module.exports = mongoose.models.RadiologyOrder || mongoose.model('RadiologyOrder', RadiologyOrderSchema);
