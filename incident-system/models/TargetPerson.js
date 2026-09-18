const mongoose = require('mongoose');

const TargetPersonSchema = new mongoose.Schema({
  customId: { type: String, required: true, unique: true }, // 対象者ID (例: T001)
  name: { type: String, required: true },                   // 対象者氏名
  department: { type: String, default: '' },                 // 部署/病棟など
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TargetPerson', TargetPersonSchema);
