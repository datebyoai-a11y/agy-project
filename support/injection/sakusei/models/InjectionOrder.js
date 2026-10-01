const mongoose = require('mongoose');

const InjectionOrderSchema = new mongoose.Schema({
  // オーダー番号 (例: INJ-20261001-001)
  orderNumber: { type: String, required: true, unique: true },

  // 患者情報
  patientId: { type: String, required: true }, // 診察券番号
  patientName: { type: String, required: true },
  patientKana: { type: String },
  gender: { type: String },
  age: { type: String },
  birthDate: { type: String },
  ward: { type: String }, // 病棟 (しおかぜ病棟 / うみかぜ病棟 / 外来)
  roomNo: { type: String }, // 病室
  bedNo: { type: String }, // ベッド番号

  // 医師・指示情報
  orderingDoctor: { type: String, required: true }, // 指示医師
  department: { type: String, default: '一般内科' },

  // 注射・点滴詳細情報
  orderType: { 
    type: String, 
    default: '点滴静注 (DIV)' 
  },
  
  // 主輸液・基本薬
  mainMedicine: { type: String, required: true }, // 例: ソルデム3A 500mL
  dose: { type: String, default: '1本' }, // 投与量・本数
  
  // 混注・側管薬剤リスト
  mixedMedicines: [{
    medicineName: { type: String }, // 例: ロセフィン静注用1g
    dose: { type: String },         // 例: 1バイアル
    timing: { type: String }        // 投与タイミング (開始時、ボトル混注、側管からなど)
  }],

  // 投与速度・滴下指示
  rate: { type: String, default: '60 mL/h (約8時間)' }, // 投与速度・時間
  dropsPerMin: { type: String }, // 滴下数 (例: 20滴/分)
  scheduledAt: { type: Date, default: Date.now }, // 投与開始予定日時
  
  // 指示・特記事項
  remarks: { type: String }, // 注意事項・アレルギー等

  // ワークフローステータス
  status: { 
    type: String, 
    enum: ['ORDERED', 'PREPARED', 'EXECUTING', 'COMPLETED', 'CANCELLED'], 
    default: 'ORDERED' 
  },
  
  // 調剤・実施記録
  preparedBy: { type: String }, // 調剤・ミキシング担当者
  preparedAt: { type: Date },
  executedBy: { type: String }, // 投与開始・実施看護師
  executedAt: { type: Date },
  executionNote: { type: String },

  // 原本様式 (注射指示箋) データ
  sheetData: { type: mongoose.Schema.Types.Mixed },

  // 電子カルテ連携情報
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article' }, // incident-system 記事ID
  targetPersonId: { type: mongoose.Schema.Types.ObjectId, ref: 'TargetPerson' },

  // タイムスタンプ
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 更新日時自動セット
InjectionOrderSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('InjectionOrder', InjectionOrderSchema);
