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

// 🛏️ 病棟・病室・ベッドマスタ定義（全機能共通）
const BED_MASTER = {
  'しおかぜ病棟': {
    name: '4F しおかぜ病棟 (一般・地域包括ケア 24床)',
    wardKey: 'しおかぜ病棟',
    rooms: [
      { roomNo: '401', type: '2人部屋', beds: ['401-A', '401-B'] },
      { roomNo: '402', type: '2人部屋', beds: ['402-A', '402-B'] },
      { roomNo: '403', type: '4人部屋', beds: ['403-A', '403-B', '403-C', '403-D'] },
      { roomNo: '405', type: '個室 (特室)', beds: ['405-A'] },
      { roomNo: '406', type: '4人部屋', beds: ['406-A', '406-B', '406-C', '406-D'] },
      { roomNo: '407', type: '個室', beds: ['407-A'] },
      { roomNo: '408', type: '4人部屋', beds: ['408-A', '408-B', '408-C', '408-D'] },
      { roomNo: '410', type: '4人部屋', beds: ['410-A', '410-B', '410-C', '410-D'] }
    ]
  },
  'うみかぜ病棟': {
    name: '3F うみかぜ病棟 (医療療養病棟 24床)',
    wardKey: 'うみかぜ病棟',
    rooms: [
      { roomNo: '301', type: '個室 (特室)', beds: ['301-A'] },
      { roomNo: '302', type: '4人部屋', beds: ['302-A', '302-B', '302-C', '302-D'] },
      { roomNo: '303', type: '4人部屋', beds: ['303-A', '303-B', '303-C', '303-D'] },
      { roomNo: '305', type: '個室', beds: ['305-A'] },
      { roomNo: '306', type: '4人部屋', beds: ['306-A', '306-B', '306-C', '306-D'] },
      { roomNo: '307', type: '個室', beds: ['307-A'] },
      { roomNo: '308', type: '4人部屋', beds: ['308-A', '308-B', '308-C', '308-D'] },
      { roomNo: '310', type: '4人部屋', beds: ['310-A', '310-B', '310-C', '310-D'] }
    ]
  }
};

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
  })
  .catch(err => console.warn('⚠️ [Portal] MongoDB 接続警告:', err.message));

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

// 📝 2. オーダリング【送信側】(Port 4000) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/ordering') {
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

// 📥 3. オーダリング【受信側】部門モニター (Port 5000) へのリバースプロキシ
app.use((req, res, next) => {
  if (req.path === '/monitor') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, '/monitor/' + q);
  }
  next();
});

app.use('/monitor', createProxyMiddleware({
  target: 'http://127.0.0.1:5000',
  changeOrigin: true,
  pathRewrite: {
    '^/monitor': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('x-forwarded-prefix', '/monitor');
    }
  }
}));

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

    // 📝 オーダリング【送信側】へのプロキシ遷移
    if (appKey === 'ordering' || appKey === 'order_sender') {
      const patientId = req.query.patientId || req.query.targetId;
      const targetQuery = patientId ? `?patientId=${encodeURIComponent(patientId)}` : '';
      const targetUrl = `/ordering/${targetQuery}`;
      console.log(`🔗 [SSO Launch -> Ordering Sender (Proxy)] ${user.userName} ➔ ${targetUrl}`);
      return res.redirect(targetUrl);
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
      error: req.query.error || null
    });
  } catch (err) {
    res.status(500).send('患者一覧の取得に失敗しました: ' + err.message);
  }
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
    const selectedWard = req.query.ward || 'しおかぜ病棟';

    // ベッド外・一時待機エリアの患者（ベッド移動・入替え作業中）
    const stagingPatients = patients.filter(p => p.ward === '一時待機' || p.room === '一時待機');

    // 病棟ごとの空床・入床統計を算出
    const currentWardMaster = BED_MASTER[selectedWard] || BED_MASTER['しおかぜ病棟'];
    let totalBeds = 0;
    currentWardMaster.rooms.forEach(r => totalBeds += r.beds.length);

    // 現在の病棟に入床している患者
    const wardPatients = patients.filter(p => p.ward && p.ward.includes(currentWardMaster.wardKey.slice(0, 4)));
    const occupiedCount = wardPatients.filter(p => p.room && p.room.trim() !== '').length;
    const emptyCount = Math.max(0, totalBeds - occupiedCount);
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedCount / totalBeds) * 100) : 0;

    res.render('bed-board', {
      user: req.session.user,
      patients,
      stagingPatients,
      bedMaster: BED_MASTER,
      selectedWard,
      currentWardMaster,
      stats: { totalBeds, occupiedCount, emptyCount, occupancyRate },
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

    // ⚠️ 一時待機（ベッド外へ退避・入替え待機）
    if (action === 'stage' || ward === '一時待機' || room === '一時待機') {
      const oldLocation = `${patient.ward || '外来'} ${patient.room || '未入床'}`;
      patient.ward = '一時待機';
      patient.room = '';
      await patient.save();

      console.log(`🛏️ [ベッド外一時退避] ${patient.name} (${patient.patientId}) [元: ${oldLocation}] ➔ 一時待機エリア`);
      return res.redirect(`/bed-board?ward=${encodeURIComponent(req.body.currentWard || 'しおかぜ病棟')}&success=` + encodeURIComponent(`患者「${patient.name}」をベッド外一時待機エリアへ移動しました。ベッド再配置が完了するまで画面遷移は制限されます。`));
    }

    // 退院・外来へ移動（ベッド解放）
    if (action === 'discharge' || !ward || ward === '外来' || !room || room.trim() === '') {
      patient.ward = '外来';
      patient.room = '';
      await patient.save();

      await TargetPerson.findOneAndUpdate(
        { customId: patient.patientId },
        { department: '外来 ' + (patient.department || '内科') }
      );

      console.log(`🛏️ [ベッド解放] ${patient.name} (${patient.patientId}) を外来（退院・未入床）に移動しました`);
      return res.redirect(`/bed-board?ward=${encodeURIComponent(req.body.currentWard || 'しおかぜ病棟')}&success=` + encodeURIComponent(`患者「${patient.name}」のベッド割り当てを解除しました（外来へ移動）。`));
    }

    // 同じ部屋・ベッドに既に別の患者がいる場合は、その患者を一時待機エリアへ自動退避
    const occupied = await Patient.findOne({ ward, room, patientId: { $ne: patientId } });
    if (occupied) {
      occupied.ward = '一時待機';
      occupied.room = '';
      await occupied.save();
      console.log(`🛏️ [自動退避] 競合した患者「${occupied.name}」を一時待機エリアへ退避させました`);
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
      successMsg += ` (※元々入床していた「${occupied.name}」様は一時待機エリアへ退避されました)`;
    }
    res.redirect(`/bed-board?ward=${encodeURIComponent(ward)}&success=` + encodeURIComponent(successMsg));
  } catch (err) {
    console.error('ベッド割り当てエラー:', err);
    res.redirect('/bed-board?error=' + encodeURIComponent('ベッド割り当て処理に失敗しました: ' + err.message));
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
