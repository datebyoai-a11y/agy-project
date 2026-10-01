/**
 * 💊 内服・外用処方オーダー モデル (PrescriptionOrder.js)
 * 交雄会だて病院 医療情報システム
 */
const mongoose = require('mongoose');

const MedicineItemSchema = new mongoose.Schema({
  medicineId: { type: String },         // 薬品コード (例: DR0001)
  name: { type: String, required: true },// 薬品名
  genericName: { type: String },        // 一般名
  spec: { type: String },               // 規格 (例: 375mg, 100mg)
  unit: { type: String, default: '錠' }, // 単位 (錠, 包, g, mL, 本, 枚)
  dose: { type: String, required: true },// 用量 (1回1錠, 1日3錠 など)
  category: { type: String, default: '内服薬' }, // 内服薬, 外用薬, 頓服薬
  suspensionOk: { type: String },       // 簡易懸濁可否 (〇, ×)
  crushOk: { type: String },            // 粉砕可否 (〇, ×)
  uncapsuleOk: { type: String },        // 脱カプセル可否
  brandType: { type: String }           // 先発, 後発
}, { _id: true });

const RpItemSchema = new mongoose.Schema({
  rpNumber: { type: Number, required: true }, // Rp番号 (1, 2, 3...)
  medicines: [MedicineItemSchema],            // 配合・同服用タイミングの薬品リスト
  usage: { type: String, required: true },    // 用法 (例: 1日3回 毎食後, 1日1回 朝食後, 疼痛時頓用)
  timing: { type: String, default: '毎食後' }, // タイミング区分
  days: { type: Number, default: 7 },         // 日数 (または頓用回数/本数)
  dayUnit: { type: String, default: '日分' }, // 単位 (日分, 回分, 本, 枚)
  oneDosePackage: { type: Boolean, default: false }, // 一包化指示
  crushInstruction: { type: Boolean, default: false },// 粉砕指示 (簡易懸濁)
  instructionNotes: { type: String, default: '' }    // 個別調剤・用法備考
}, { _id: true });

const PrescriptionOrderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  }, // RX-YYYYMMDD-XXX
  patientId: { type: String, required: true, index: true },
  patientName: { type: String, required: true },
  patientKana: { type: String, default: '' },
  gender: { type: String, default: '' },
  age: { type: String, default: '' },
  birthDate: { type: String, default: '' },
  ward: { type: String, default: '' },
  roomNo: { type: String, default: '' },
  bedNo: { type: String, default: '' },
  
  // 医師・部門情報
  orderingDoctor: { type: String, required: true },
  department: { type: String, default: '一般内科' },
  
  // 処方区分
  orderClass: { type: String, default: '定期処方' }, // 定期処方, 臨時処方, 頓服処方, 退院時処方
  dispenseType: { type: String, default: '院内処方' }, // 院内処方, 院外処方箋
  startDate: { type: String, required: true },        // 服用開始日 (YYYY-MM-DD)
  
  // 処方内容 (Rpリスト)
  rpList: [RpItemSchema],
  
  // 医師コメント・特記事項
  remarks: { type: String, default: '' },
  
  // ステータス管理
  status: {
    type: String,
    enum: ['ORDERED', 'RECEIVED', 'CHECKED', 'DISPENSED', 'COMPLETED', 'CANCELLED'],
    default: 'ORDERED',
    index: true
  },
  
  // 調剤・鑑査記録 (薬剤部連携)
  audit: {
    pharmacistName: { type: String, default: '' },
    checkedAt: { type: Date },
    dispensedAt: { type: Date },
    comments: { type: String, default: '' }
  },
  
  // 電子カルテ連携
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article' },
  targetPersonId: { type: mongoose.Schema.Types.ObjectId, ref: 'TargetPerson' },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

PrescriptionOrderSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('PrescriptionOrder', PrescriptionOrderSchema);
