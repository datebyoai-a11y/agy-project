const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/auth');

// ユーザー新規登録処理
router.post('/register', async (req, res) => {
  try {
    const { loginId, userName, password } = req.body;

    if (!loginId || !userName || !password) {
      return res.send('<script>alert("すべての項目を入力してください。"); window.history.back();</script>');
    }

    const existingUser = await User.findOne({ loginId });
    if (existingUser) {
      return res.send('<script>alert("このログイン名はすでに使用されています。"); window.history.back();</script>');
    }

    // パスワードはUserモデルのpre('save')で自動的にbcryptハッシュ化されます
    const newUser = new User({ loginId, userName, password });
    await newUser.save();

    res.send('<script>alert("ユーザー登録が完了しました！ログインしてください。"); window.location.href="/login";</script>');
  } catch (err) {
    res.status(500).send('ユーザー登録エラー: ' + err.message);
  }
});

// ログイン処理（bcryptパスワード照合 & JWTトークン発行）
router.post('/login', async (req, res) => {
  try {
    const { loginId, password } = req.body;

    if (!loginId || !password) {
      return res.send('<script>alert("ログイン名とパスワードを入力してください。"); window.history.back();</script>');
    }

    const user = await User.findOne({ loginId });

    if (user && await user.comparePassword(password)) {
      // JWT トークン生成
      const token = jwt.sign(
        { userId: user._id, loginId: user.loginId, userName: user.userName },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      // HTTP-only Cookie に保存
      res.cookie('token', token, {
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000 // 8時間
      });

      // セッションにも保存
      req.session.user = {
        id: user.loginId,
        name: user.userName
      };

      res.redirect('/target-people');
    } else {
      res.send('<script>alert("ログイン名またはパスワードが間違っています。"); window.history.back();</script>');
    }
  } catch (err) {
    res.status(500).send('ログイン処理エラー: ' + err.message);
  }
});

// ログアウト処理
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  if (req.session) {
    req.session.destroy();
  }
  res.redirect('/login');
});

module.exports = router;
