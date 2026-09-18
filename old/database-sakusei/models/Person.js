const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({
  name: { type: String, required: true },        // 対象者氏名
  birthDate: { type: Date, required: true },     // 生年月日
  memo: { type: String },                        // メモ
  createdBy: { type: String, required: true },   // 作成者（ログインユーザー名）
  createdAt: { type: Date, default: Date.now }   // 作成年月日（自動）
});

module.exports = mongoose.model("Person", PersonSchema);
