const mongoose = require('mongoose');

const RoleTemplateSchema = new mongoose.Schema({
  roleKey: { type: String, required: true, unique: true }, // 職種キー (例: '医師', '看護師', '放射線技師', etc.)
  name: { type: String, required: true },                   // 表示名 (例: '医師 (Doctor)')
  defaultRole: { type: String, default: 'user' },           // デフォルトロール ('admin' / 'user')
  description: { type: String, default: '' },               // 職務説明
  menus: [{ type: String }],                                // 許可メニューID一覧 (['emr', 'order_sender', ...])
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.RoleTemplate || mongoose.model('RoleTemplate', RoleTemplateSchema);
