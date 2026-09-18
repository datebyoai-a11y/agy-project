const express = require("express");
const router = express.Router();
const path = require("path");
const User = require("../models/User");

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (!user) return res.status(400).send("ユーザーが存在しません");

  const ok = await user.comparePassword(password);
  if (!ok) return res.status(400).send("パスワードが違います");

  // ★ ログインユーザー名をセッションに保存
  req.session.username = username;

  // ★ person.html を表示（正しいパス）
  res.sendFile(path.join(__dirname, "../public", "person.html"));
});

router.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = new User({ username, password });
    await user.save();

    res.json({ message: "ユーザー登録完了" });
  } catch (err) {
    res.status(400).json({ error: "登録失敗: " + err.message });
  }
});

module.exports = router;
