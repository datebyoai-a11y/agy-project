/**
 * 🏥 交雄会だて病院 医療統合ポータル サーバー (server.js)
 * 
 * 1. ログイン認証 & ユーザー権限（部署・ロール）連動メニューシステム
 * 2. ADMIN向け 職種ーメニュー権限雛形マトリクス（権限付与・削除）
 * 3. 職員アカウントの作成・編集・削除機能
 * 4. 患者情報登録・管理画面（電子カルテ・オーダリング自動連動）
 */

const express = require('express');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

const User = require('./models/User');
const RoleTemplate = require('./models/RoleTemplate');
const Patient = require('./models/Patient');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');
const { SamplePatients } = require('/home/a/Desktop/ai/agy-project/ordering/shared/orderSchema');
const { getAuthorizedMenus, checkAccess, MENUS, DEFAULT_ROLE_TEMPLATES } = require('./config/permissions');
const { seed2FPhotoPatients } = require('./seed2FPhotoPatients');

// 🛏️ 病棟・病室・ベッドマスタ定義（全機能共通）
// 2F医療病棟、3F介護医療院、4F介護医療院（全フロア同一構造・20部屋・計62床）
function createWardRooms(floor) {
  const f = String(floor);
  return [
    { roomNo: `${f}01`, type: '4人部屋', gender: '女', beds: [`${f}01-1`, `${f}01-2`, `${f}01-3`, `${f}01-4`] },
    { roomNo: `${f}02`, type: '4人部屋', gender: '女', beds: [`${f}02-1`, `${f}02-2`, `${f}02-3`, `${f}02-4`] },
    { roomNo: `${f}03`, type: '4人部屋', gender: '女', beds: [`${f}03-1`, `${f}03-2`, `${f}03-3`, `${f}03-4`] },
    { roomNo: `${f}05`, type: '4人部屋', gender: '男', beds: [`${f}05-1`, `${f}05-2`, `${f}05-3`, `${f}05-4`] },
    { roomNo: `${f}06`, type: '個室 (トイレ付)', gender: '女', beds: [`${f}06-1`] },
    { roomNo: `${f}07`, type: '個室 (トイレ付)', gender: '個室', beds: [`${f}07-1`] },
    { roomNo: `${f}08`, type: '個室 (トイレ付)', gender: '男', beds: [`${f}08-1`] },
    { roomNo: `${f}11`, type: '4人部屋', gender: '男', beds: [`${f}11-1`, `${f}11-2`, `${f}11-3`, `${f}11-4`] },
    { roomNo: `${f}12`, type: '4人部屋', gender: '男', beds: [`${f}12-1`, `${f}12-2`, `${f}12-3`, `${f}12-4`] },
    { roomNo: `${f}13`, type: '4人部屋', gender: '女', beds: [`${f}13-1`, `${f}13-2`, `${f}13-3`, `${f}13-4`] },
    { roomNo: `${f}15`, type: '個室 (トイレ付)', gender: '男', beds: [`${f}15-1`] },
    { roomNo: `${f}16`, type: '個室 (トイレ付)', gender: '女', beds: [`${f}16-1`] },
    { roomNo: `${f}17`, type: '個室 (トイレ付)', gender: '女', beds: [`${f}17-1`] },
    { roomNo: `${f}18`, type: '4人部屋', gender: '男', beds: [`${f}18-1`, `${f}18-2`, `${f}18-3`, `${f}18-4`] },
    { roomNo: `${f}20`, type: '4人部屋', gender: '女', beds: [`${f}20-1`, `${f}20-2`, `${f}20-3`, `${f}20-4`] },
    { roomNo: `${f}21`, type: '4人部屋', gender: '女', beds: [`${f}21-1`, `${f}21-2`, `${f}21-3`, `${f}21-4`] },
    { roomNo: `${f}22`, type: '4人部屋', gender: '女', beds: [`${f}22-1`, `${f}22-2`, `${f}22-3`, `${f}22-4`] },
    { roomNo: `${f}23`, type: '4人部屋', gender: '男', beds: [`${f}23-1`, `${f}23-2`, `${f}23-3`, `${f}23-4`] },
    { roomNo: `${f}25`, type: '4人部屋', gender: '女', beds: [`${f}25-1`, `${f}25-2`, `${f}25-3`, `${f}25-4`] },
    { roomNo: `${f}26`, type: '4人部屋', gender: '女', beds: [`${f}26-1`, `${f}26-2`, `${f}26-3`, `${f}26-4`] }
  ];
}

const BED_MASTER = {
  '2F医療病棟': {
    name: '2F 医療病棟',
    wardKey: '2F医療病棟',
    floor: 2,
    rooms: createWardRooms(2)
  },
  '3Fしおかぜ': {
    name: '3F しおかぜ',
    wardKey: '3Fしおかぜ',
    floor: 3,
    rooms: createWardRooms(3)
  },
  '4Fうみかぜ': {
    name: '4F うみかぜ',
    wardKey: '4Fうみかぜ',
    floor: 4,
    rooms: createWardRooms(4)
  }
};

function resolveWardMaster(wardKey) {
  if (BED_MASTER[wardKey]) return BED_MASTER[wardKey];
  if (wardKey === '3Fしおかぜ' || wardKey === 'しおかぜ病棟' || wardKey === '3F' || (wardKey && (wardKey.startsWith('3F') || wardKey.includes('しおかぜ')))) return BED_MASTER['3Fしおかぜ'];
  if (wardKey === '4Fうみかぜ' || wardKey === 'うみかぜ病棟' || wardKey === '4F' || (wardKey && (wardKey.startsWith('4F') || wardKey.includes('うみかぜ')))) return BED_MASTER['4Fうみかぜ'];
  return BED_MASTER['2F医療病棟'];
}

const app = express();
const PORT = process.env.PORT || 8000;

// MongoDB 接続 (レプリカセット rs0 対応)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ [Portal] MongoDB レプリカセット (rs0) に正常接続しました。');
    await initRoleTemplates();
    await initAdminUser();
    await initSamplePatients();
    await migrateWardNames();
    try {
      // ※ ベッドボードの患者はDBから適宜入床させる運用の変更に伴い、起動時の固定ベッド割り当てシードは無効化
      // await seed2FPhotoPatients();
    } catch (e) {
      console.warn('⚠️ seed2FPhotoPatients warning:', e.message);
    }
  })
  .catch(err => console.warn('⚠️ [Portal] MongoDB 接続警告:', err.message));

// 病棟名マイグレーション (3F: しおかぜ, 4F: うみかぜ)
async function migrateWardNames() {
  try {
    const r1 = await Patient.updateMany({ ward: { $in: ['3F介護医療院', '3F', 'しおかぜ病棟'] } }, { ward: '3Fしおかぜ' });
    const r2 = await Patient.updateMany({ ward: { $in: ['4F介護医療院', '4F', 'うみかぜ病棟'] } }, { ward: '4Fうみかぜ' });
    const r3 = await Patient.updateMany({ ward: { $in: ['2F', '2F医療'] } }, { ward: '2F医療病棟' });
    if (r1.modifiedCount > 0 || r2.modifiedCount > 0 || r3.modifiedCount > 0) {
      console.log(`🏥 病棟移行完了: 3F➔3Fしおかぜ(${r1.modifiedCount}件), 4F➔4Fうみかぜ(${r2.modifiedCount}件), 2F➔2F医療病棟(${r3.modifiedCount}件)`);
    }
  } catch (e) {
    console.warn('⚠️ 病棟名マイグレーション警告:', e.message);
  }
}

// 初期職種テンプレートのシード
async function initRoleTemplates() {
  try {
    for (const [key, val] of Object.entries(DEFAULT_ROLE_TEMPLATES)) {
      const existing = await RoleTemplate.findOne({ roleKey: key });
      if (!existing) {
        await RoleTemplate.create(val);
      }
    }
  } catch (e) {
    console.error('RoleTemplate 初期化エラー:', e.message);
  }
}

// 初期管理者 admin (pass: pass) の確保
async function initAdminUser() {
  try {
    const admin = await User.findOne({ loginId: 'admin' });
    if (!admin) {
      const newAdmin = new User({
        loginId: 'admin',
        userName: '管理者 太郎',
        password: 'pass',
        role: 'admin',
        department: '医療安全管理室'
      });
      await newAdmin.save();
      console.log('👑 初期管理者 (admin / pass) を作成しました。');
    }
  } catch (e) {
    console.error('Admin ユーザー確保エラー:', e.message);
  }
}

// サンプル患者データの初期シード（カルテ・オーダリング共通）
async function initSamplePatients() {
  try {
    const count = await Patient.countDocuments();
    if (count === 0 && SamplePatients && SamplePatients.length > 0) {
      for (const sp of SamplePatients) {
        const p = new Patient({
          patientId: sp.id,
          name: sp.name,
          kana: sp.kana || '',
          age: sp.age || null,
          gender: sp.gender || '男',
          birthDate: sp.birthDate || '',
          ward: sp.ward || '外来',
          room: sp.room || '',
          department: sp.department || '内科',
          infection: sp.infection || '無',
          mobility: sp.mobility || '徒歩',
          height: sp.height || null,
          weight: sp.weight || null,
          allergies: 'なし',
          notes: sp.examCategory || ''
        });
        await p.save();

        // TargetPerson にも同期
        await TargetPerson.findOneAndUpdate(
          { customId: sp.id },
          { customId: sp.id, name: sp.name, department: (sp.ward || '外来') + ' ' + (sp.department || '内科') },
          { upsert: true, new: true }
        );
      }
      console.log(`🏥 サンプル患者 ${SamplePatients.length} 名をマスタ登録 & カルテ連動同期しました。`);
    }
  } catch (e) {
    console.error('サンプル患者シードエラー:', e.message);
  }
}

// 動的テンプレートの取得ヘルパー
async function getActiveRoleTemplates() {
  try {
    const dbTemplates = await RoleTemplate.find({});
    const map = { ...DEFAULT_ROLE_TEMPLATES };
    dbTemplates.forEach(t => {
      map[t.roleKey] = {
        roleKey: t.roleKey,
        name: t.name,
        defaultRole: t.defaultRole,
        description: t.description,
        menus: t.menus,
        labels: DEFAULT_ROLE_TEMPLATES[t.roleKey]?.labels || {}
      };
    });
    return map;
  } catch (e) {
    return DEFAULT_ROLE_TEMPLATES;
  }
}

const { createProxyMiddleware } = require('http-proxy-middleware');

// =========================================================
// 🌐 各種システムへのリバースプロキシ設定 (Cloudflare・外部アクセス完全対応)
// =========================================================

// 🩻 1. 放射線科オーダー (Port 8080) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/radiology') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/radiology/' + q);
  }
  next();
});

app.use('/radiology', createProxyMiddleware({
  target: 'http://127.0.0.1:8080',
  changeOrigin: true,
  pathRewrite: {
    '^/radiology': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/radiology');
    }
  }
}));

// 🩻 1.5 放射線科【指示受け・実施モニター】(Port 8081) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/radi-uke') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/radi-uke/' + q);
  }
  next();
});

app.use('/radi-uke', createProxyMiddleware({
  target: 'http://127.0.0.1:8081',
  changeOrigin: true,
  pathRewrite: {
    '^/radi-uke': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/radi-uke');
    }
  }
}));

// 💉 1.6 注射・点滴オーダー (Port 8082) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/injection') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/injection/' + q);
  }
  next();
});

app.use('/injection', createProxyMiddleware({
  target: 'http://127.0.0.1:8082',
  changeOrigin: true,
  pathRewrite: {
    '^/injection': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/injection');
    }
  }
}));

// 🤸 1.7 リハビリテーション指示オーダー (Port 8083) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/rehabili') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/rehabili/' + q);
  }
  next();
});

app.use('/rehabili', createProxyMiddleware({
  target: 'http://127.0.0.1:8083',
  changeOrigin: true,
  pathRewrite: {
    '^/rehabili': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/rehabili');
    }
  }
}));

// 🤸 1.7.5 リハビリテーション科【指示受け・実施モニター】(Port 8085) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/reha-uke') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/reha-uke/' + q);
  }
  next();
});

app.use('/reha-uke', createProxyMiddleware({
  target: 'http://127.0.0.1:8085',
  changeOrigin: true,
  pathRewrite: {
    '^/reha-uke': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/reha-uke');
    }
  }
}));

// 💊 1.8 内服・外用処方オーダー (Port 8084) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/naifuku') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/naifuku/' + q);
  }
  next();
});

app.use('/naifuku', createProxyMiddleware({
  target: 'http://127.0.0.1:8084',
  changeOrigin: true,
  pathRewrite: {
    '^/naifuku': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/naifuku');
    }
  }
}));

// 📝 2. 統合オーダリング総合ポータル (Port 4000) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/ordering') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/ordering/' + q);
  }
  if (req.path === '/support/ordering') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/ordering/' + q);
  }
  next();
});

app.use('/ordering', createProxyMiddleware({
  target: 'http://127.0.0.1:4000',
  changeOrigin: true,
  pathRewrite: {
    '^/ordering': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/ordering');
    }
  }
}));

app.use('/support/ordering', createProxyMiddleware({
  target: 'http://127.0.0.1:4000',
  changeOrigin: true,
  pathRewrite: {
    '^/support/ordering': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/support/ordering');
    }
  }
}));

// 📥 オーダリング【受信側】(Port 5000) - 停止・閉鎖中
app.use('/monitor', (req, res) => {
  res.status(503).send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head><meta charset="utf-8"><title>部門モニター停止中</title></head>
    <body style="font-family:sans-serif; text-align:center; padding:3rem; background:#f8fafc; color:#1e293b;">
      <div style="max-width:500px; margin:auto; background:white; padding:2rem; border-radius:12px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1); border:1px solid #e2e8f0;">
        <div style="font-size:2.5rem; margin-bottom:1rem;">🔒</div>
        <h2 style="margin:0 0 0.5rem; color:#0f172a;">部門モニターは停止中です</h2>
        <p style="color:#64748b; font-size:0.95rem; line-height:1.5;">ポート5000の受信モニター機能は停止・閉鎖されています。</p>
        <a href="/menu" style="display:inline-block; margin-top:1.5rem; padding:0.55rem 1.4rem; background:#0284c7; color:white; text-decoration:none; border-radius:6px; font-weight:bold;">🏠 医療統合ポータルへ戻る</a>
      </div>
    </body>
    </html>
  `);
});

// 🩺 4. 電子カルテ・インシデント管理 (Port 3000) へのリバースプロキシ
const emrProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:3000',
  changeOrigin: true,
  ws: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-host', req.headers.host || '');
      proxyReq.setHeader('x-forwarded-proto', req.protocol || 'http');
    }
  }
});

const isEmrRoute = (pathname) => {
  if (pathname.startsWith('/articles') ||
      pathname.startsWith('/target-people') ||
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/incident') ||
      pathname.startsWith('/incidents') ||
      pathname.startsWith('/reports') ||
      pathname === '/users') {
    return true;
  }
  if (pathname.startsWith('/api')) {
    if (pathname.startsWith('/api/patients') || pathname.startsWith('/api/bed-board')) {
      return false; // ポータル固有API
    }
    return true; // 電子カルテAPI (sso-login, select-target-person, orders, articles等)
  }
  return false;
};

// ExpressのマウントによるパスStripを防止し、完全なURLパスをPort 3000へ透過プロキシ
app.use((req, res, next) => {
  if (isEmrRoute(req.path)) {
    return emrProxy(req, res, next);
  }
  next();
});

// ミドルウェア
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// セッション設定
// セッション設定 (閉じて開いた時はログイン画面から開くよう、ブラウザ終了で破棄するセッションCookieに設定)
app.use(session({
  name: 'portal.sid',
  secret: 'koyukai-hospital-menu-portal-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
    // ※ maxAge を指定しないことで、ブラウザ・ウィンドウ終了時にCookieが自動消滅します
  }
}));

// テンプレートエンジン (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 全画面共通リボン用：患者リストとアクティブ患者を全テンプレートへ自動提供
app.use(async (req, res, next) => {
  try {
    const patients = await Patient.find({}).sort({ patientId: 1 }).limit(30);
    res.locals.allPatients = patients;
    res.locals.activePatient = null; // 選ぶまでは空
  } catch (err) {
    res.locals.allPatients = [];
    res.locals.activePatient = null;
  }
  next();
});

// 認証チェック
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// 管理者権限チェック
const requireAdmin = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin' && req.session.user.department !== '医療安全管理室') {
    return res.status(403).render('unauthorized', { user: req.session.user });
  }
  next();
};

/* =========================================================
   認証ルーティング
   ========================================================= */

// 閉じて開いた際、必ずログイン画面から起動
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/menu');
  }
  res.render('login', {
    error: req.query.error || null,
    success: req.query.success || null,
    loginId: req.query.loginId || ''
  });
});

app.post('/login', async (req, res) => {
  const { loginId, password } = req.body;

  try {
    const user = await User.findOne({ loginId });
    if (!user) {
      return res.render('login', {
        error: 'ログインIDまたはパスワードが正しくありません。',
        success: null,
        loginId
      });
    }

    // パスワード消去・初期化状態のチェック
    if (!user.password || user.password.trim() === '' || user.isPasswordReset) {
      return res.render('login', {
        error: `職員 [${user.userName}] のパスワードは初期化されています。下の「🔑 パスワードの変更」から新しいパスワードを設定してください。`,
        success: null,
        loginId
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.render('login', {
        error: 'ログインIDまたはパスワードが正しくありません。',
        success: null,
        loginId
      });
    }

    req.session.user = {
      _id: user._id,
      loginId: user.loginId,
      userName: user.userName,
      role: user.role,
      department: user.department || '一般',
      allowedMenus: user.allowedMenus || []
    };

    console.log(`🔑 ログイン成功: ${user.userName} (${user.department} / ${user.role})`);
    res.redirect('/menu');
  } catch (err) {
    console.error('ログイン処理エラー:', err);
    res.render('login', {
      error: '認証処理中にシステムエラーが発生しました。',
      success: null,
      loginId
    });
  }
});

// 🔑 パスワード変更処理（ログイン画面から実行）
app.post('/change-password', async (req, res) => {
  const { loginId, currentPassword, newPassword, confirmPassword } = req.body;

  try {
    if (!loginId || !newPassword) {
      return res.redirect('/login?error=' + encodeURIComponent('職員IDと新しいパスワードを入力してください。') + '&loginId=' + encodeURIComponent(loginId || ''));
    }

    if (newPassword !== confirmPassword) {
      return res.redirect('/login?error=' + encodeURIComponent('新しいパスワードと確認用パスワードが一致しません。') + '&loginId=' + encodeURIComponent(loginId));
    }

    if (newPassword.length < 4) {
      return res.redirect('/login?error=' + encodeURIComponent('パスワードは4文字以上で設定してください。') + '&loginId=' + encodeURIComponent(loginId));
    }

    const user = await User.findOne({ loginId });
    if (!user) {
      return res.redirect('/login?error=' + encodeURIComponent('指定された職員IDが見つかりません。'));
    }

    // パスワードが初期化済みでない通常変更の場合、現在のパスワードを検証
    const isReset = !user.password || user.password.trim() === '' || user.isPasswordReset;
    if (!isReset) {
      if (!currentPassword) {
        return res.redirect('/login?error=' + encodeURIComponent('現在のパスワードを入力してください。') + '&loginId=' + encodeURIComponent(loginId));
      }
      const isCurrentMatch = await user.comparePassword(currentPassword);
      if (!isCurrentMatch) {
        return res.redirect('/login?error=' + encodeURIComponent('現在のパスワードが正しくありません。') + '&loginId=' + encodeURIComponent(loginId));
      }
    }

    // パスワード更新
    user.password = newPassword;
    user.isPasswordReset = false;
    await user.save();

    console.log(`🔑 パスワード変更完了: ${user.userName} (${user.loginId})`);
    res.redirect('/login?success=' + encodeURIComponent(`職員 [${user.userName}] のパスワードを変更しました。新しいパスワードでログインしてください。`) + '&loginId=' + encodeURIComponent(loginId));
  } catch (err) {
    console.error('パスワード変更エラー:', err);
    res.redirect('/login?error=' + encodeURIComponent('パスワード変更に失敗しました: ' + err.message));
  }
});

app.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy();
  }
  res.clearCookie('portal.sid');
  res.clearCookie('connect.sid');
  res.redirect('/login');
});

/* =========================================================
   🔑 SSO (Single Sign-On) 連携ルーティング
   ========================================================= */
app.get('/sso/launch', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const appKey = req.query.app || 'articles';

    // 宛先パスのマッピング
    let targetPath = '/target-people';
    if (appKey === 'emr' || appKey === 'articles') {
      const patientId = req.query.patientId || req.query.targetId;
      if (patientId) {
        targetPath = `/articles?targetId=${encodeURIComponent(patientId)}`;
      } else {
        // 先に患者を選ぶため、カルテ側の対象者一覧へ遷移
        targetPath = '/target-people';
      }
    } else if (appKey === 'target_people') {
      targetPath = '/target-people';
    } else if (appKey === 'dashboard') {
      targetPath = '/dashboard';
    } else if (appKey === 'incident_report') {
      targetPath = '/incident/report/level1';
    } else if (appKey === 'safety_analytics') {
      targetPath = '/dashboard';
    } else if (appKey === 'level0') {
      targetPath = '/incident/report/level0';
    } else if (req.query.redirect) {
      targetPath = req.query.redirect;
    }

    // 5分間有効なワンタイムSSOトークンを生成
    const ssoToken = jwt.sign(
      {
        userId: user._id,
        loginId: user.loginId,
        userName: user.userName,
        department: user.department,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    // 🩻 放射線科オーダーへのSSO連携API (プロキシ経由で安全に接続)
    if (appKey === 'radiology' || appKey === 'radiology_order') {
      const patientId = req.query.patientId || req.query.targetId;
      const targetQuery = patientId ? `&patientId=${encodeURIComponent(patientId)}` : '';
      const ssoUrl = `/radiology/api/sso-login?token=${encodeURIComponent(ssoToken)}${targetQuery}`;
      console.log(`🔗 [SSO Launch -> Radiology API] ${user.userName} (${user.loginId}) ➔ ${ssoUrl}`);
      return res.redirect(ssoUrl);
    }

    // 🩻 放射線科【指示受け・実施モニター】へのSSO連携API
    if (appKey === 'radi_uke' || appKey === 'radiology_receiver') {
      const ssoUrl = `/radi-uke/api/sso-login?token=${encodeURIComponent(ssoToken)}`;
      console.log(`🔗 [SSO Launch -> RadiUke API] ${user.userName} (${user.loginId}) ➔ ${ssoUrl}`);
      return res.redirect(ssoUrl);
    }

    // 💉 注射・点滴オーダーへのSSO連携API (プロキシ経由で安全に接続)
    if (appKey === 'injection' || appKey === 'injection_order') {
      const patientId = req.query.patientId || req.query.targetId;
      const targetQuery = patientId ? `&patientId=${encodeURIComponent(patientId)}` : '';
      const ssoUrl = `/injection/api/sso-login?token=${encodeURIComponent(ssoToken)}${targetQuery}`;
      console.log(`🔗 [SSO Launch -> Injection API] ${user.userName} (${user.loginId}) ➔ ${ssoUrl}`);
      return res.redirect(ssoUrl);
    }

    // 🤸 リハビリテーション指示オーダーへのSSO連携API (プロキシ経由で安全に接続)
    if (appKey === 'rehabili' || appKey === 'rehabili_order') {
      const patientId = req.query.patientId || req.query.targetId;
      const targetQuery = patientId ? `&patientId=${encodeURIComponent(patientId)}` : '';
      const ssoUrl = `/rehabili/api/sso-login?token=${encodeURIComponent(ssoToken)}${targetQuery}`;
      console.log(`🔗 [SSO Launch -> Rehabili API] ${user.userName} (${user.loginId}) ➔ ${ssoUrl}`);
      return res.redirect(ssoUrl);
    }

    // 🤸 リハビリテーション科【指示受け・実施モニター】へのSSO連携API
    if (appKey === 'reha_uke' || appKey === 'rehabili_receiver') {
      const ssoUrl = `/reha-uke/api/sso-login?token=${encodeURIComponent(ssoToken)}`;
      console.log(`🔗 [SSO Launch -> RehaUke API] ${user.userName} (${user.loginId}) ➔ ${ssoUrl}`);
      return res.redirect(ssoUrl);
    }

    // 💊 内服・外用処方オーダーへのSSO連携API (プロキシ経由で安全に接続)
    if (appKey === 'naifuku' || appKey === 'naifuku_order' || appKey === 'prescription') {
      const patientId = req.query.patientId || req.query.targetId;
      const targetQuery = patientId ? `&patientId=${encodeURIComponent(patientId)}` : '';
      const ssoUrl = `/naifuku/api/sso-login?token=${encodeURIComponent(ssoToken)}${targetQuery}`;
      console.log(`🔗 [SSO Launch -> Naifuku API] ${user.userName} (${user.loginId}) ➔ ${ssoUrl}`);
      return res.redirect(ssoUrl);
    }

    // 📝 統合オーダリング総合ポータルへのSSO連携API (プロキシ経由で安全に接続)
    if (appKey === 'ordering' || appKey === 'order_sender') {
      const patientId = req.query.patientId || req.query.targetId;
      const targetQuery = patientId ? `&patientId=${encodeURIComponent(patientId)}` : '';
      const ssoUrl = `/ordering/api/sso-login?token=${encodeURIComponent(ssoToken)}${targetQuery}`;
      console.log(`🔗 [SSO Launch -> Ordering Portal API] ${user.userName} (${user.loginId}) ➔ ${ssoUrl}`);
      return res.redirect(ssoUrl);
    }

    // 📥 オーダリング【受信側】部門モニターへのプロキシ遷移
    if (appKey === 'monitor' || appKey === 'order_receiver') {
      const targetUrl = '/monitor/';
      console.log(`🔗 [SSO Launch -> Ordering Receiver (Proxy)] ${user.userName} ➔ ${targetUrl}`);
      return res.redirect(targetUrl);
    }

    // 🩺 電子カルテ・インシデントへのSSO連携API (プロキシ経由でポート指定不要・外部完全対応)
    const ssoUrl = `/api/sso-login?token=${encodeURIComponent(ssoToken)}&redirect=${encodeURIComponent(targetPath)}`;
    console.log(`🔗 [SSO Launch -> EMR API (Proxy)] ${user.userName} (${user.loginId}) ➔ ${ssoUrl}`);
    res.redirect(ssoUrl);
  } catch (err) {
    console.error('SSO起動エラー:', err.message);
    res.redirect('/menu?error=' + encodeURIComponent('SSO連携中にエラーが発生しました'));
  }
});

/* =========================================================
   メインメニュー（権限連動ポータル）
   ========================================================= */

app.get('/menu', requireAuth, async (req, res) => {
  const user = req.session.user;
  const activeTemplates = await getActiveRoleTemplates();
  const authorizedMenus = getAuthorizedMenus(user, activeTemplates);
  const patients = await Patient.find({}).sort({ patientId: 1 }).lean();

  res.render('menu', {
    user,
    menus: authorizedMenus,
    patients: patients || []
  });
});

/* =========================================================
   ADMIN 職員 & 権限雛形マトリクス管理
   ========================================================= */

// 👥 職員一覧 & 職種ーメニュー対応表
app.get('/admin/users', requireAuth, async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).sort({ createdAt: -1 });
    const activeTemplates = await getActiveRoleTemplates();
    const isAdmin = !!(req.session.user && (req.session.user.role === 'admin' || req.session.user.department === '医療安全管理室'));

    res.render('admin-users', {
      user: req.session.user,
      users,
      menus: MENUS,
      roleTemplates: activeTemplates,
      isAdmin,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    res.status(500).send('職員一覧の取得に失敗しました: ' + err.message);
  }
});

// ⚡ 職種ーメニュー対応表での権限付与・削除（リアルタイムトグル）
app.post('/admin/templates/toggle', requireAdmin, async (req, res) => {
  try {
    const { roleKey, menuId } = req.body;
    let tmpl = await RoleTemplate.findOne({ roleKey });
    if (!tmpl) {
      const def = DEFAULT_ROLE_TEMPLATES[roleKey] || { roleKey, name: roleKey, menus: [] };
      tmpl = new RoleTemplate(def);
    }

    if (tmpl.menus.includes(menuId)) {
      tmpl.menus = tmpl.menus.filter(m => m !== menuId);
    } else {
      tmpl.menus.push(menuId);
    }

    tmpl.updatedAt = new Date();
    await tmpl.save();

    console.log(`⚡ 職種権限更新 [${roleKey}]: ${menuId} -> ${tmpl.menus.includes(menuId) ? '付与' : '削除'}`);
    res.json({ success: true, menus: tmpl.menus });
  } catch (err) {
    console.error('権限トグルエラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 👤 新規職員作成（雛形自動適用）
app.post('/admin/users/create', requireAdmin, async (req, res) => {
  try {
    let { loginId, userName, password, department, role, allowedMenus } = req.body;
    const existing = await User.findOne({ loginId });
    if (existing) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('そのログインIDは既に登録されています'));
    }

    if (!allowedMenus) {
      const activeTemplates = await getActiveRoleTemplates();
      const tmpl = activeTemplates[department] || activeTemplates['一般'];
      allowedMenus = tmpl ? tmpl.menus : ['incident_report'];
    } else if (!Array.isArray(allowedMenus)) {
      allowedMenus = [allowedMenus];
    }

    const newUser = new User({
      loginId,
      userName,
      password,
      department: department || '一般',
      role: role || 'user',
      allowedMenus
    });
    await newUser.save();

    console.log(`✅ 新規職員登録: ${userName} (${department} / ${role}) 許可: ${allowedMenus.join(', ')}`);
    res.redirect('/admin/users?success=' + encodeURIComponent(`職員「${userName}」(${department}) を登録しました。`));
  } catch (err) {
    console.error('新規登録エラー:', err);
    res.redirect('/admin/users?error=' + encodeURIComponent('登録処理に失敗しました: ' + err.message));
  }
});

// ✏️ 職員情報 & 権限の編集更新
app.post('/admin/users/update/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let { userName, department, role, password, allowedMenus } = req.body;

    const target = await User.findById(id);
    if (!target) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('職員が見つかりません'));
    }

    target.userName = userName;
    target.department = department;
    target.role = role;

    if (password && password.trim() !== '') {
      target.password = password; // pre-save will bcrypt it
    }

    if (allowedMenus) {
      target.allowedMenus = Array.isArray(allowedMenus) ? allowedMenus : [allowedMenus];
    } else {
      target.allowedMenus = [];
    }

    await target.save();
    console.log(`✏️ 職員情報更新: ${target.userName} (${target.department} / ${target.role})`);
    res.redirect('/admin/users?success=' + encodeURIComponent(`職員「${target.userName}」の情報を更新しました。`));
  } catch (err) {
    console.error('職員更新エラー:', err);
    res.redirect('/admin/users?error=' + encodeURIComponent('更新処理に失敗しました: ' + err.message));
  }
});

// 🔑 職員のパスワード消去・初期化
app.post('/admin/users/reset-password/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const target = await User.findById(id);
    if (!target) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('職員が見つかりません。'));
    }

    target.password = '';
    target.isPasswordReset = true;
    await target.save();

    console.log(`🔑 職員パスワード初期化・消去: ${target.userName} (${target.loginId})`);
    res.redirect('/admin/users?success=' + encodeURIComponent(`職員「${target.userName}」(${target.loginId}) のパスワードを消去・初期化しました。ログイン画面で新しいパスワードを設定できます。`));
  } catch (err) {
    console.error('パスワード初期化エラー:', err);
    res.redirect('/admin/users?error=' + encodeURIComponent('パスワード初期化に失敗しました: ' + err.message));
  }
});

// 🗑️ 職員の削除
app.post('/admin/users/delete/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const target = await User.findById(id);
    if (!target) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('職員が見つかりません'));
    }

    // 主要管理者および自身は削除不可
    if (target.loginId === 'admin' || target._id.toString() === req.session.user._id.toString()) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('現在ログイン中または主要管理者アカウント (admin) は削除できません。'));
    }

    await User.findByIdAndDelete(id);
    console.log(`🗑️ 職員削除: ${target.userName} (${target.loginId})`);
    res.redirect('/admin/users?success=' + encodeURIComponent(`職員「${target.userName}」(${target.loginId}) を削除しました。`));
  } catch (err) {
    console.error('職員削除エラー:', err);
    res.redirect('/admin/users?error=' + encodeURIComponent('削除処理に失敗しました: ' + err.message));
  }
});

// 🌐 システム稼働監視
app.get('/admin/status', requireAdmin, (req, res) => {
  res.render('admin-status', {
    user: req.session.user
  });
});

/* =========================================================
   🏥 患者情報登録・管理画面（電子カルテ・オーダリング連動）
   ========================================================= */

// 患者一覧画面
app.get('/patients', requireAuth, async (req, res) => {
  try {
    const patients = await Patient.find({}).sort({ patientId: 1 });
    res.render('patients', {
      user: req.session.user,
      patients,
      bedMaster: BED_MASTER,
      success: req.query.success || null,
      error: req.query.error || null,
      action: req.query.action || null,
      targetWard: req.query.ward || '',
      targetRoom: req.query.room || ''
    });
  } catch (err) {
    res.status(500).send('患者一覧の取得に失敗しました: ' + err.message);
  }
});

// 新規患者登録画面ショートカット (ベッドボード等からの直接遷移対応)
app.get('/patients/new', requireAuth, (req, res) => {
  const q = new URLSearchParams(req.query).toString();
  res.redirect('/patients?action=new' + (q ? '&' + q : ''));
});

// 新規患者登録
app.post('/patients/create', requireAuth, async (req, res) => {
  try {
    const {
      patientId, name, kana, birthDate, gender,
      postalCode, address, phoneNumber,
      keyPersonName, keyPersonPhone, keyPersonRelation, keyPersonNotes,
      ward, room, department, bloodType, infection,
      mobility, height, weight, allergies, notes, memo
    } = req.body;

    const existing = await Patient.findOne({ patientId });
    if (existing) {
      return res.redirect('/patients?error=' + encodeURIComponent(`患者ID [${patientId}] は既に登録されています。`));
    }

    const newPatient = new Patient({
      patientId,
      name,
      kana: kana || '',
      birthDate: birthDate || '',
      gender: gender || '男',
      postalCode: postalCode || '',
      address: address || '',
      phoneNumber: phoneNumber || '',
      keyPersonName: keyPersonName || '',
      keyPersonPhone: keyPersonPhone || '',
      keyPersonRelation: keyPersonRelation || '',
      keyPersonNotes: keyPersonNotes || '',
      ward: ward || '外来',
      room: room || '',
      department: department || '内科',
      bloodType: bloodType || '不明',
      infection: infection || '無',
      mobility: mobility || '徒歩',
      height: height ? parseFloat(height) : null,
      weight: weight ? parseFloat(weight) : null,
      allergies: allergies || 'なし',
      notes: notes || '',
      memo: memo || ''
    });
    // pre('save') で生年月日から年齢を自動算出
    await newPatient.save();

    // 🏥 電子カルテ側 (TargetPerson) に自動連動同期！
    await TargetPerson.findOneAndUpdate(
      { customId: patientId },
      { customId: patientId, name, department: (ward || '外来') + ' ' + (department || '内科') },
      { upsert: true, new: true }
    );

    console.log(`🏥 新規患者登録 & カルテ同期完了: ${name} (${patientId}) [年齢自動算出: ${newPatient.age}歳]`);
    res.redirect('/patients?success=' + encodeURIComponent(`患者「${name}」(${patientId} / ${newPatient.age}歳) を登録しました。`));
  } catch (err) {
    console.error('患者登録エラー:', err);
    res.redirect('/patients?error=' + encodeURIComponent('登録処理に失敗しました: ' + err.message));
  }
});

// 患者情報更新
app.post('/patients/update/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, kana, birthDate, gender,
      postalCode, address, phoneNumber,
      keyPersonName, keyPersonPhone, keyPersonRelation, keyPersonNotes,
      ward, room, department, bloodType, infection,
      mobility, height, weight, allergies, notes, memo
    } = req.body;

    const patient = await Patient.findById(id);
    if (!patient) {
      return res.redirect('/patients?error=' + encodeURIComponent('患者データが見つかりません。'));
    }

    patient.name = name;
    patient.kana = kana || '';
    patient.birthDate = birthDate || '';
    patient.gender = gender || '男';
    patient.postalCode = postalCode || '';
    patient.address = address || '';
    patient.phoneNumber = phoneNumber || '';
    patient.keyPersonName = keyPersonName || '';
    patient.keyPersonPhone = keyPersonPhone || '';
    patient.keyPersonRelation = keyPersonRelation || '';
    patient.keyPersonNotes = keyPersonNotes || '';
    patient.ward = ward || '外来';
    patient.room = room || '';
    patient.department = department || '内科';
    patient.bloodType = bloodType || '不明';
    patient.infection = infection || '無';
    patient.mobility = mobility || '徒歩';
    patient.height = height ? parseFloat(height) : null;
    patient.weight = weight ? parseFloat(weight) : null;
    patient.allergies = allergies || 'なし';
    patient.notes = notes || '';
    patient.memo = memo || '';

    // pre('save') で生年月日から年齢を自動再計算
    await patient.save();

    // カルテ側 (TargetPerson) も同期更新
    await TargetPerson.findOneAndUpdate(
      { customId: patient.patientId },
      { name, department: (ward || '外来') + ' ' + (department || '内科') }
    );

    console.log(`✏️ 患者情報更新 & カルテ同期完了: ${name} (${patient.patientId}) [年齢自動算出: ${patient.age}歳]`);
    res.redirect('/patients?success=' + encodeURIComponent(`患者「${name}」(${patient.age}歳) の情報を更新しました。`));
  } catch (err) {
    console.error('患者更新エラー:', err);
    res.redirect('/patients?error=' + encodeURIComponent('更新処理に失敗しました: ' + err.message));
  }
});

// 患者削除
app.post('/patients/delete/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patient = await Patient.findById(id);
    if (!patient) {
      return res.redirect('/patients?error=' + encodeURIComponent('患者データが見つかりません。'));
    }

    // カルテ側 (TargetPerson) からも削除
    await TargetPerson.findOneAndDelete({ customId: patient.patientId });
    await Patient.findByIdAndDelete(id);

    console.log(`🗑️ 患者削除: ${patient.name} (${patient.patientId})`);
    res.redirect('/patients?success=' + encodeURIComponent(`患者「${patient.name}」(${patient.patientId}) を削除しました。`));
  } catch (err) {
    console.error('患者削除エラー:', err);
    res.redirect('/patients?error=' + encodeURIComponent('削除処理に失敗しました: ' + err.message));
  }
});

/* =========================================================
   🛏️ 病棟・ベッドボード管理システム
   ========================================================= */

// ベッドボード画面
app.get('/bed-board', requireAuth, async (req, res) => {
  try {
    const patients = await Patient.find({}).sort({ patientId: 1 });
    let selectedWard = req.query.ward || '2F医療病棟';
    if (selectedWard === '3F介護医療院' || selectedWard === 'しおかぜ病棟' || selectedWard === '3F') selectedWard = '3Fしおかぜ';
    if (selectedWard === '4F介護医療院' || selectedWard === 'うみかぜ病棟' || selectedWard === '4F') selectedWard = '4Fうみかぜ';

    // 🪑 病棟ごとの仮置き患者（病棟ごとに独立管理）
    const stagingPatients = patients.filter(p => {
      const isStaging = (p.room === '仮置き' || p.room === '一時待機' || p.ward === '一時待機' || p.ward === `仮置き_${selectedWard}`);
      if (!isStaging) return false;
      if (p.ward === selectedWard) return true;
      if (selectedWard === '2F医療病棟' && (p.ward === '2F' || (p.ward && p.ward.startsWith('2F')) || p.ward === '一時待機')) return true;
      if (selectedWard === '3Fしおかぜ' && (p.ward === '3F' || (p.ward && p.ward.startsWith('3F')) || (p.ward && p.ward.includes('しおかぜ')) || p.ward === '3F介護医療院')) return true;
      if (selectedWard === '4Fうみかぜ' && (p.ward === '4F' || (p.ward && p.ward.startsWith('4F')) || (p.ward && p.ward.includes('うみかぜ')) || p.ward === '4F介護医療院')) return true;
      return false;
    });

    // 病棟マスタの解決 (2F, 3F, 4F 全フロア同一構造・20部屋・計62床)
    const currentWardMaster = resolveWardMaster(selectedWard);
    let totalBeds = 0;
    currentWardMaster.rooms.forEach(r => totalBeds += r.beds.length);

    // 現在の病棟に入床している患者 (仮置きを除く)
    const wardPatients = patients.filter(p => {
      if (!p.ward) return false;
      if (p.room === '仮置き' || p.room === '一時待機') return false;
      if (p.ward === selectedWard) return true;
      if (selectedWard === '2F医療病棟' && (p.ward === '2F' || p.ward.startsWith('2F'))) return true;
      if (selectedWard === '3Fしおかぜ' && (p.ward === '3F' || p.ward.startsWith('3F') || (p.ward && p.ward.includes('しおかぜ')) || p.ward === '3F介護医療院')) return true;
      if (selectedWard === '4Fうみかぜ' && (p.ward === '4F' || p.ward.startsWith('4F') || (p.ward && p.ward.includes('うみかぜ')) || p.ward === '4F介護医療院')) return true;
      return false;
    });

    const occupiedPatients = wardPatients.filter(p => p.room && p.room.trim() !== '');
    const occupiedCount = occupiedPatients.length;
    const emptyCount = Math.max(0, totalBeds - occupiedCount);
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedCount / totalBeds) * 100) : 0;

    // 性別集計
    const maleCount = occupiedPatients.filter(p => p.gender === '男' || p.gender === '男性').length;
    const femaleCount = occupiedPatients.filter(p => p.gender === '女' || p.gender === '女性').length;

    // 移動区分集計 (実機: 担送, 護送, 独歩)
    const tansouCount = occupiedPatients.filter(p => p.mobility === '担送').length;
    const gosouCount = occupiedPatients.filter(p => p.mobility === '護送').length;
    const doppoCount = occupiedPatients.filter(p => p.mobility === '独歩' || p.mobility === '徒歩').length;
    const kubunNashiCount = Math.max(0, occupiedCount - (tansouCount + gosouCount + doppoCount));

    // 空きベッドの男女別集計
    let emptyMaleCount = 0;
    let emptyFemaleCount = 0;
    currentWardMaster.rooms.forEach(room => {
      room.beds.forEach(bedId => {
        const isOccupied = occupiedPatients.some(p => p.room === bedId || p.room === `${room.roomNo}-${bedId}`);
        if (!isOccupied) {
          if (room.gender === '男' || room.gender === '男性') emptyMaleCount++;
          else if (room.gender === '女' || room.gender === '女性') emptyFemaleCount++;
        }
      });
    });

    const stats = {
      totalBeds,
      bedCount: totalBeds,
      occupiedCount,
      emptyCount,
      occupancyRate,
      maleCount,
      femaleCount,
      tansouCount,
      gosouCount,
      doppoCount,
      kubunNashiCount,
      emptyMaleCount,
      emptyFemaleCount,
      gaishutsuCount: 0,
      gaihakuCount: 0,
      zaiinCount: occupiedCount
    };

    res.render('bed-board', {
      user: req.session.user,
      patients,
      stagingPatients,
      bedMaster: BED_MASTER,
      selectedWard,
      currentWardMaster,
      stats,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    res.status(500).send('ベッドボード表示エラー: ' + err.message);
  }
});

// ベッド割り当て / 変更 API
app.post('/api/bed-board/assign', requireAuth, async (req, res) => {
  try {
    const { patientId, ward, room, action } = req.body;
    if (!patientId) {
      return res.redirect('/bed-board?error=' + encodeURIComponent('対象患者が指定されていません。'));
    }

    const patient = await Patient.findOne({ patientId });
    if (!patient) {
      return res.redirect('/bed-board?error=' + encodeURIComponent('患者データが見つかりません。'));
    }

    // 🪑 仮置き（病棟ごとのベッド外一時待機スロットへ移動）
    if (action === 'stage' || ward === '一時待機' || ward === '仮置き' || room === '一時待機' || room === '仮置き') {
      const targetWard = req.body.currentWard || req.body.ward || '2F医療病棟';
      const oldLocation = `${patient.ward || '外来'} ${patient.room || '未入床'}`;
      patient.ward = targetWard;
      patient.room = '仮置き';
      await patient.save();

      console.log(`🛏️ [仮置き移動] ${patient.name} (${patient.patientId}) [元: ${oldLocation}] ➔ [${targetWard}] 仮置きスロット`);
      return res.redirect(`/bed-board?ward=${encodeURIComponent(targetWard)}&success=` + encodeURIComponent(`患者「${patient.name}」を「${targetWard}」の仮置きスロットへ移動しました。`));
    }

    // 退院・外来へ移動（ベッド解放）
    if (action === 'discharge' || !ward || ward === '外来' || !room || room.trim() === '') {
      const currentWard = req.body.currentWard || '2F医療病棟';
      patient.ward = '外来';
      patient.room = '';
      await patient.save();

      await TargetPerson.findOneAndUpdate(
        { customId: patient.patientId },
        { department: '外来 ' + (patient.department || '内科') }
      );

      console.log(`🛏️ [ベッド解放] ${patient.name} (${patient.patientId}) を外来（退院・未入床）に移動しました`);
      return res.redirect(`/bed-board?ward=${encodeURIComponent(currentWard)}&success=` + encodeURIComponent(`患者「${patient.name}」のベッド割り当てを解除しました（外来へ移動）。`));
    }

    // 同じ部屋・ベッドに既に別の患者がいる場合は、その病棟の仮置きエリアへ自動退避
    const occupied = await Patient.findOne({ ward, room, patientId: { $ne: patientId } });
    if (occupied) {
      occupied.ward = ward;
      occupied.room = '仮置き';
      await occupied.save();
      console.log(`🛏️ [自動退避] 競合した患者「${occupied.name}」を [${ward}] の仮置きスロットへ退避させました`);
    }

    patient.ward = ward;
    patient.room = room;
    await patient.save();

    // カルテ側も同期更新
    await TargetPerson.findOneAndUpdate(
      { customId: patient.patientId },
      { department: patient.ward + ' ' + (patient.department || '内科') }
    );

    console.log(`🛏️ [ベッド割り当て] ${patient.name} (${patient.patientId}) ➔ ${patient.ward} ${patient.room}`);
    let successMsg = `患者「${patient.name}」を [${ward} ${room}] に割り当てました。`;
    if (occupied) {
      successMsg += ` (※元々入床していた「${occupied.name}」様は仮置きスロットへ移動しました)`;
    }
    res.redirect(`/bed-board?ward=${encodeURIComponent(ward)}&success=` + encodeURIComponent(successMsg));
  } catch (err) {
    console.error('ベッド割り当てエラー:', err);
    res.redirect('/bed-board?error=' + encodeURIComponent('ベッド割り当て処理に失敗しました: ' + err.message));
  }
});

// 病棟全ベッド一括解放（空床化）API
app.post('/api/bed-board/clear-all', requireAuth, async (req, res) => {
  try {
    const ward = req.body.ward || '2F医療病棟';
    let query = {};
    if (ward === 'ALL') {
      query = { $or: [{ room: { $exists: true, $ne: '' } }, { ward: { $exists: true, $nin: ['外来', ''] } }] };
    } else if (ward === '2F医療病棟') {
      query = { ward: { $regex: '^2F' } };
    } else {
      query = { ward };
    }

    const patients = await Patient.find(query);
    for (const p of patients) {
      p.ward = '外来';
      p.room = '';
      await p.save();
      await TargetPerson.findOneAndUpdate(
        { customId: p.patientId },
        { department: '外来 ' + (p.department || '内科') }
      );
    }
    console.log(`🛏️ [全床解放] ${ward} の患者 ${patients.length} 名の入床を解除しました`);
    res.redirect(`/bed-board?ward=${encodeURIComponent(ward === 'ALL' ? '2F医療病棟' : ward)}&success=` + encodeURIComponent(`${patients.length} 名のベッド割り当てを解除し、全床を空床にしました。`));
  } catch (err) {
    res.redirect('/bed-board?error=' + encodeURIComponent('全床解放処理に失敗しました: ' + err.message));
  }
});

// 初期写真データの一括復元API
app.post('/api/bed-board/seed-photo-patients', requireAuth, async (req, res) => {
  try {
    const seedScript = path.join(__dirname, 'seed2FPhotoPatients.js');
    const { execSync } = require('child_process');
    execSync(`node "${seedScript}"`, { cwd: __dirname });
    res.redirect('/bed-board?ward=2F医療病棟&success=' + encodeURIComponent('2F実機写真データ（59名）の入床配置を復元しました。'));
  } catch (err) {
    res.redirect('/bed-board?error=' + encodeURIComponent('初期データ復元に失敗しました: ' + err.message));
  }
});

// サンプル患者の一括インポート
app.post('/patients/seed-samples', requireAuth, async (req, res) => {
  try {
    let count = 0;
    for (const sp of SamplePatients) {
      const existing = await Patient.findOne({ patientId: sp.id });
      if (!existing) {
        const p = new Patient({
          patientId: sp.id,
          name: sp.name,
          kana: sp.kana || '',
          age: sp.age || null,
          gender: sp.gender || '男',
          birthDate: sp.birthDate || '',
          ward: sp.ward || '外来',
          room: sp.room || '',
          department: sp.department || '内科',
          infection: sp.infection || '無',
          mobility: sp.mobility || '徒歩',
          height: sp.height || null,
          weight: sp.weight || null,
          allergies: 'なし',
          notes: sp.examCategory || ''
        });
        await p.save();

        await TargetPerson.findOneAndUpdate(
          { customId: sp.id },
          { customId: sp.id, name: sp.name, department: (sp.ward || '外来') + ' ' + (sp.department || '内科') },
          { upsert: true, new: true }
        );
        count++;
      }
    }
    res.redirect('/patients?success=' + encodeURIComponent(`サンプル患者 ${count} 名を新規追加・カルテ連動同期しました。`));
  } catch (err) {
    res.redirect('/patients?error=' + encodeURIComponent('サンプル登録エラー: ' + err.message));
  }
});

// 患者一覧 JSON API（他システムからのAjax参照用）
app.get('/api/patients', async (req, res) => {
  try {
    const q = req.query.q;
    let filter = {};
    if (q) {
      filter = {
        $or: [
          { patientId: new RegExp(q, 'i') },
          { name: new RegExp(q, 'i') },
          { kana: new RegExp(q, 'i') }
        ]
      };
    }
    const list = await Patient.find(filter).sort({ patientId: 1 });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// サーバー起動
app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`🏥 医療統合ポータル 稼働中: http://localhost:${PORT}`);
  console.log(`   ログイン画面 : http://localhost:${PORT}/login`);
  console.log(`   権限メニュー : http://localhost:${PORT}/menu`);
  console.log(`   患者管理画面 : http://localhost:${PORT}/patients`);
  console.log(`   職員権限管理 : http://localhost:${PORT}/admin/users`);
  console.log('================================================================');
});
