const express = require("express");
const router = express.Router();
const Person = require("../models/Person");

// ★ ログイン必須チェック
function requireLogin(req, res, next) {
  if (!req.session.username) {
    return res.status(401).send("ログインが必要です");
  }
  next();
}

router.post("/create", requireLogin, async (req, res) => {
  try {
    const { name, birthDate, memo } = req.body;

    const person = new Person({
      name,
      birthDate,
      memo,
      createdBy: req.session.username, // ★ ログインユーザー名
    });

    await person.save();

    res.json({ message: "対象者データ作成完了" });
  } catch (err) {
    res.status(400).json({ error: "作成失敗: " + err.message });
  }
});

// 対象者一覧取得
router.get("/list", requireLogin, async (req, res) => {
  try {
    const people = await Person.find().sort({ createdAt: -1 });
    res.json(people);
  } catch (err) {
    res.status(400).json({ error: "一覧取得失敗: " + err.message });
  }
});

module.exports = router;
