const express = require('express');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/database');
const viewRoutes = require('./routes/viewRoutes');
const { authenticateToken } = require('./middleware/auth');

const app = express();

// DB接続 & マスタデータ初期シード
connectDB();

// ミドルウェア設定
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// セッション設定
app.use(session({
  secret: 'incident-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// テンプレートエンジン設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// 公開API（認証不要）
app.use('/api', require('./routes/authRoutes'));

// 認証チェック：未ログインユーザーがアクセスした場合、最初にまず /login へ遷移させる
// 外部からの点滴・食事・放射線オーダー受信用API も除外対象に設定
const publicPaths = [
  '/login',
  '/register',
  '/api/iv-orders/receive',
  '/api/meal-orders/receive',
  '/api/radiology-orders/receive'
];

const requireAuth = (req, res, next) => {
  if (publicPaths.includes(req.path)) {
    return next();
  }
  return authenticateToken(req, res, next);
};

app.use(requireAuth);

// 認証が必要なAPI
app.use('/api', require('./routes/targetPersonRoutes'));
app.use('/api', require('./routes/articleRoutes'));
app.use('/api', require('./routes/reportRoutes'));
app.use('/api', require('./routes/exportRoutes'));
app.use('/api', require('./routes/backupRoutes'));
app.use('/api', require('./routes/userRoutes'));
app.use('/api', require('./routes/ivOrderRoutes'));
app.use('/api', require('./routes/mealOrderRoutes'));
app.use('/api', require('./routes/radiologyOrderRoutes'));

// ログアウト用ショートカット
app.get('/logout', (req, res) => {
  res.clearCookie('token');
  if (req.session) {
    req.session.destroy();
  }
  res.redirect('/login');
});

// 画面遷移用ルーティング
app.use('/', viewRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`インシデント管理システム サーバー起動中: http://localhost:${PORT}`);
});
