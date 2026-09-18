const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

// JWTトークンによる認証ミドルウェア（クッキーまたはAuthorizationヘッダー）
const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

  // セッションがある場合のフォールバック（セッション互換性維持）
  if (!token) {
    if (req.session && req.session.user) {
      req.user = req.session.user;
      return next();
    }
    // ログイン画面へリダイレクト
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ message: '認証が必要です。ログインしてください。' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      res.clearCookie('token');
      if (req.accepts('html')) {
        return res.redirect('/login');
      }
      return res.status(401).json({ message: '無効なユーザーです。' });
    }
    req.user = user;
    // セッションとも同期
    req.session.user = {
      id: user.loginId,
      name: user.userName
    };
    next();
  } catch (err) {
    res.clearCookie('token');
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ message: 'トークンの検証に失敗しました。' });
  }
};

// ログイン済みユーザーのリダイレクトミドルウェア
const redirectIfLoggedIn = (req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return res.redirect('/target-people');
    } catch (err) {
      res.clearCookie('token');
    }
  } else if (req.session && req.session.user) {
    return res.redirect('/target-people');
  }
  next();
};

module.exports = {
  JWT_SECRET,
  authenticateToken,
  redirectIfLoggedIn
};
