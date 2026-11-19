const express = require('express');
const router = express.Router();
const TargetPerson = require('../models/TargetPerson');
const { authenticateToken } = require('../middleware/auth');

// 対象者マスタ一覧取得 API
router.get('/target-people', authenticateToken, async (req, res) => {
  try {
    const targets = await TargetPerson.find().sort({ customId: 1 });
    res.json(targets);
  } catch (err) {
    res.status(500).json({ error: '対象者一覧の取得に失敗しました: ' + err.message });
  }
});

// 対象者マスタ新規追加 API
router.post('/target-people', authenticateToken, async (req, res) => {
  try {
    const { customId, name, department } = req.body;
    if (!customId || !name) {
      return res.status(400).json({ error: '対象者IDと氏名は必須です。' });
    }

    const existing = await TargetPerson.findOne({ customId });
    if (existing) {
      return res.status(400).json({ error: '指定された対象者IDは既に存在します。' });
    }

    const newTarget = new TargetPerson({ customId, name, department });
    await newTarget.save();
    res.status(201).json(newTarget);
  } catch (err) {
    res.status(500).json({ error: '対象者の登録に失敗しました: ' + err.message });
  }
});

// 対象者マスタ更新 API
router.put('/target-people/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { customId, name, department } = req.body;

    const target = await TargetPerson.findById(id);
    if (!target) {
      return res.status(404).json({ error: '対象のデータが見つかりません。' });
    }

    if (customId && customId !== target.customId) {
      const existing = await TargetPerson.findOne({ customId });
      if (existing) {
        return res.status(400).json({ error: '指定された対象者IDは既に使用されています。' });
      }
      target.customId = customId;
    }

    if (name) target.name = name;
    if (department !== undefined) target.department = department;

    await target.save();
    res.json({ success: true, message: '対象者情報を更新しました。', target });
  } catch (err) {
    res.status(500).json({ error: '対象者の更新に失敗しました: ' + err.message });
  }
});

// 対象者マスタ削除 API
router.delete('/target-people/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await TargetPerson.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: '対象のデータが見つかりません。' });
    }
    res.json({ success: true, message: `対象者 [${deleted.name}] を削除しました。` });
  } catch (err) {
    res.status(500).json({ error: '対象者の削除に失敗しました: ' + err.message });
  }
});

module.exports = router;
