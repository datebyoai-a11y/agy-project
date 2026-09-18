const mongoose = require('mongoose');

const targetSchema = new mongoose.Schema({
    name: { type: String, required: true },
    targetId: { type: String, required: true, unique: true }
});

module.exports = mongoose.model('Target', targetSchema);

