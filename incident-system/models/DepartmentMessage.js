const mongoose = require('mongoose');

const DepartmentMessageSchema = new mongoose.Schema({
  fromDepartment: { type: String, required: true }, // 送信元部署 (例: 一般病棟)
  toDepartment: { type: String, required: true },   // 送信先部署 (例: 薬剤部, 全部署)
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'TargetPerson' }, // 関連対象者（任意）
  priority: { type: String, default: '通常' },       // 通常, 重要, 緊急
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false },        // 既読フラグ
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DepartmentMessage', DepartmentMessageSchema);
