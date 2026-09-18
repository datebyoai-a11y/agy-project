const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
    username: { type: String, required: true },
    content: { type: String, required: true },
    targetId: { type: String, required: true }, // ★対象者IDを紐づける
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Article', articleSchema);

