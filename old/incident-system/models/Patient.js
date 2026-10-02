const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema({
  patientId: { type: String, required: true, unique: true }, // 患者ID (例: P001, 10001)
  name: { type: String, required: true },                   // 患者氏名 (漢字)
  kana: { type: String, default: '' },                      // フリガナ
  birthDate: { type: String, default: '' },                  // 生年月日 (YYYY-MM-DD)
  age: { type: Number, default: null },                      // 年齢 (生年月日から自動計算)
  gender: { type: String, enum: ['男', '女', 'その他'], default: '男' }, // 性別
  
  // 連絡先・キーパーソン情報
  postalCode: { type: String, default: '' },                // 郵便番号 (例: 052-0012)
  address: { type: String, default: '' },                   // 住所 (例: 北海道伊達市松ヶ枝町9-1)
  phoneNumber: { type: String, default: '' },               // 電話番号 (本人連絡先)
  keyPersonName: { type: String, default: '' },             // キーパーソン氏名
  keyPersonPhone: { type: String, default: '' },            // キーパーソン電話番号
  keyPersonRelation: { type: String, default: '' },         // キーパーソン続柄 (配偶者、長男、長女、施設等)
  keyPersonNotes: { type: String, default: '' },            // キーパーソン備考 (連絡可能時間、留意事項等)

  // 診療・病棟病室情報
  ward: { type: String, default: '外来' },                   // 病棟 (しおかぜ, うみかぜ, 医療療養, 外来 等)
  room: { type: String, default: '' },                      // 病室 (例: 302号室, 401-A)
  department: { type: String, default: '内科' },             // 診療科 (内科, 外科, 整形外科, 総合診療科 等)
  
  // 身体・医療情報
  bloodType: { type: String, default: '不明' },              // 血液型 (A, B, O, AB, 不明)
  infection: { type: String, default: '無' },                // 感染症情報 (無 / 有(MRSA) 等)
  mobility: { type: String, default: '徒歩' },               // 移動能力/ADL (徒歩, 車椅子, ベッド, ストレッチャー)
  height: { type: Number, default: null },                   // 身長 (cm)
  weight: { type: Number, default: null },                   // 体重 (kg)
  allergies: { type: String, default: 'なし' },              // アレルギー情報
  notes: { type: String, default: '' },                      // 特記事項・既往歴・申し送り
  memo: { type: String, default: '' },                       // 備考・個別メモ欄

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 保存前に生年月日から年齢を自動算出 & 更新日時を更新
PatientSchema.pre('save', function() {
  if (this.birthDate && this.birthDate.trim() !== '') {
    const birth = new Date(this.birthDate);
    if (!isNaN(birth.getTime())) {
      const today = new Date();
      let calculatedAge = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        calculatedAge--;
      }
      if (calculatedAge >= 0 && calculatedAge < 130) {
        this.age = calculatedAge;
      }
    }
  }
  this.updatedAt = new Date();
});

module.exports = mongoose.models.Patient || mongoose.model('Patient', PatientSchema);
