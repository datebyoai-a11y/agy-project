const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
  loginId: { type: String, required: true, unique: true }, // ログイン名（重複不可）
  userName: { type: String, required: true },               // 入力者氏名
  password: { type: String, default: '' },                   // パスワード（ハッシュ化して保存、初期化時は空文字）
  isPasswordReset: { type: Boolean, default: false },        // パスワード消去・初期化状態フラグ
  role: { type: String, enum: ['admin', 'user'], default: 'user' }, // ロール（管理者 / 一般）
  department: { type: String, default: '一般' },            // 所属部署（医師、看護師、薬剤師、放射線技師、リハビリ、介護士、栄養士、医療安全管理室、一般）
  allowedMenus: [{ type: String }],                         // 個別許可メニューID一覧（空の場合は職種雛形を自動適用）
  createdAt: { type: Date, default: Date.now }
});

// 保存前にパスワードをハッシュ化（空文字の場合はハッシュ化せずそのまま保存）
UserSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  if (!this.password || this.password.trim() === '') {
    this.password = '';
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// パスワード比較用メソッド（パスワード未設定・初期化時は常にfalse）
UserSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password || this.password.trim() === '' || this.isPasswordReset) {
    return false;
  }
  if (!this.password.startsWith('$2b$') && !this.password.startsWith('$2a$')) {
    if (candidatePassword === this.password) {
      this.markModified('password');
      await this.save();
      return true;
    }
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
