const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
  loginId: { type: String, required: true, unique: true }, // ログイン名（重複不可）
  userName: { type: String, required: true },               // 入力者氏名
  password: { type: String, required: true },               // パスワード（ハッシュ化して保存）
  role: { type: String, enum: ['admin', 'user'], default: 'user' }, // ロール（管理者 / 一般）
  department: { type: String, default: '看護師' },            // 所属部署（医師、看護師、薬剤師、放射線技師、リハビリ、介護士、栄養士、事務）
  createdAt: { type: Date, default: Date.now }
});

// 保存前にパスワードをハッシュ化
UserSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// パスワード比較用メソッド（旧平文パスワードの自動bcrypt移行対応）
UserSchema.methods.comparePassword = async function(candidatePassword) {
  if (this.password && !this.password.startsWith('$2b$') && !this.password.startsWith('$2a$')) {
    if (candidatePassword === this.password) {
      this.markModified('password');
      await this.save();
      return true;
    }
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);


