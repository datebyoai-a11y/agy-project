/**
 * 📝 交雄会だて病院 オーダリング総合ポータル サーバー (server.js)
 * 
 * 1. 医療統合ポータル (menu) スタイルを踏襲した統一オーダリング画面
 * 2. 現行の主要オーダリング機能:
 *    - 🩻 放射線科オーダー (CT / 透視 / 単純撮影 / 照射録 / PGP真正性署名)
 *    - 💉 注射・点滴オーダー (輸液 / 混注薬 / 指示箋・ラベル印刷 / カルテ連動)
 * 3. 共通リボン連携 & 患者選択引き継ぎ機能
 * 4. ポータル (Port 8000) からのリバースプロキシ (/ordering/) 完全対応
 */

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');

// モデル
const Patient = require('/home/a/Desktop/ai/agy-project/support/menu/sakusei/models/Patient');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');
const User = require('/home/a/Desktop/ai/agy-project/incident-system/models/User');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'incident-system-jwt-secret-key-2026';

// MongoDB 接続 (incident_db - レプリカセット rs0 対応)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [Ordering Portal] MongoDB レプリカセット (rs0) に正常接続しました。'))
  .catch(err => console.error('❌ [Ordering Portal] MongoDB 接続エラー:', err.message));

// ミドルウェア設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  name: 'ordering.sid',
  secret: 'ordering-portal-session-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Ordering Portal System', port: PORT });
});

// 認証ユーザー取得ヘルパー
function getSessionUser(req) {
  if (req.session && req.session.user) return req.session.user;
  // デフォルト医師アカウント（未認証・開発時のフォールバック）
  return {
    userId: 'doctor-default',
    loginId: 'doctor',
    userName: '山田 医師',
    department: '一般内科',
    role: 'doctor'
  };
}

/**
 * 🔑 SSO ログイン & 患者連携 API (GET /api/sso-login)
 */
app.get('/api/sso-login', async (req, res) => {
  try {
    const { token, patientId, redirect } = req.query;
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.session.user = {
        userId: decoded.userId,
        loginId: decoded.loginId,
        userName: decoded.userName,
        department: decoded.department,
        role: decoded.role
      };
      console.log(`🔑 [Ordering SSO] 職員認証成功: ${decoded.userName} (${decoded.department} / ${decoded.role})`);
    }

    const prefix = req.headers['x-forwarded-prefix'] || '';
    const baseTarget = prefix ? `${prefix}/` : '../';
    let targetUrl = redirect || baseTarget;
    if (patientId) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'patientId=' + encodeURIComponent(patientId);
    }
    res.redirect(targetUrl);
  } catch (err) {
    console.error('❌ [Ordering SSO] トークン認証エラー:', err.message);
    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.redirect(prefix ? `${prefix}/` : '../');
  }
});

/**
 * 🏠 オーダリング総合ポータル メイン画面 (GET /)
 */
app.get('/', async (req, res) => {
  try {
    const user = getSessionUser(req);
    const queryPatientId = req.query.patientId || req.query.targetId || '';

    // 患者マスタ一覧取得
    const patients = await Patient.find({}).sort({ ward: 1, roomNo: 1, patientId: 1 }).lean();

    // 選択中患者の検索 (患者選択不要: 未指定時は先頭患者を自動バインド)
    let selectedPatient = null;
    if (queryPatientId) {
      selectedPatient = patients.find(p => p.patientId === queryPatientId) || null;
    }
    if (!selectedPatient && patients.length > 0) {
      selectedPatient = patients[0];
    }

    // オーダリングメニューカード定義（放射線と注射を中心に構成）
    const orderMenus = [
      {
        id: 'radiology',
        title: '放射線科オーダー【発行・帳票印刷】',
        shortName: '放射線オーダー',
        subtitle: 'CT検査・X線透視・単純撮影・照射録オーダー入力。原本・病棟控えのA4正副2分割印刷対応。',
        url: '/radiology/',
        icon: '🩻',
        status: 'active',
        badgeText: 'Ed25519 PGP電子署名対応',
        badgeColor: '#7c3aed',
        features: ['CT (単純/造影/ダイナミック)', 'X線透視 (TV/嚥下造影/PEG交換)', '一般X線撮影 / 照射録', '正・控え2分割自動印刷', '電子カルテ自動連動']
      },
      {
        id: 'injection',
        title: '注射・点滴オーダー【指示・ラベル印刷】',
        shortName: '注射オーダー',
        subtitle: '維持輸液・抗生剤・混注・側管指示発行。Dr指示票＆輸液ボトル・シリンジ貼付用ラベル自動生成。',
        url: '/injection/',
        icon: '💉',
        status: 'active',
        badgeText: 'ワンクリック薬剤プリセット連動',
        badgeColor: '#059669',
        features: ['ソルデム / ビーフリード等の輸液プリセット', '抗生剤・制吐剤の混注・側管指示', 'A4指示票＆ボトル貼付ラベル印刷', '三点照合スタンプ枠完備', '電子カルテ(Article)自動記録']
      },
      {
        id: 'rehabili',
        title: 'リハビリテーション指示オーダー【指示書Ver3.0】',
        shortName: 'リハビリ指示',
        subtitle: 'PT/OT/ST指示・急変リスク・医学的必要性・頻度・消炎鎮痛。原本忠実A4印刷＆カルテ自動連動。',
        url: '/rehabili/',
        icon: '🤸',
        status: 'active',
        badgeText: '原本指示書Ver3.0 Excel準拠',
        badgeColor: '#0d9488',
        features: ['理学療法 (PT) / 作業療法 (OT) / 言語聴覚 (ST)', '急変リスク・禁忌事項・酸素使用管理', '医学的改善見込み・頻度・場所指定', 'Excel原本準拠 A4縦1枚帳票印刷', '電子カルテ(Article)自動記録連動']
      },
      {
        id: 'prescription',
        title: '内服・外用処方オーダー【処方箋・調剤指示】',
        shortName: '内服・外用処方',
        subtitle: 'Rp別複数薬品・服用タイミング・一包化/粉砕指示・DO処方・院内処方箋印刷・カルテ連動 (SSO自動ログイン)',
        url: '/naifuku/',
        icon: '💊',
        status: 'active',
        badgeText: 'Rp/一包化/粉砕対応',
        badgeColor: '#0284c7',
        features: ['Rp1〜10複数薬品まとめ処方', '用法・服用タイミング・日数指定', '一包化指示・粉砕/簡易懸濁判定', '前回DO処方・A4処方箋印刷', '電子カルテ(Article)自動記録連動']
      },
      {
        id: 'laboratory',
        title: '検体・臨床検査オーダー【検査依頼】',
        shortName: '検体検査オーダー',
        subtitle: '血液生化学・血算・凝固・尿一般・心電図オーダー。検査室バーコードラベル連動。',
        url: '#',
        icon: '🧪',
        status: 'upcoming',
        badgeText: '新システムへ移行準備中',
        badgeColor: '#475569',
        features: ['血液生化学・血算', '尿一般・沈渣', '心電図・生理機能検査', 'バーコード検体ラベル印刷']
      }
    ];

    const prefix = req.headers['x-forwarded-prefix'] || '';
    res.render('index', {
      user,
      patients,
      selectedPatient,
      orderMenus,
      prefix,
      patientId: queryPatientId
    });
  } catch (err) {
    console.error('❌ [Ordering Portal] メイン画面表示エラー:', err.message);
    res.status(500).send('オーダリングポータルエラー: ' + err.message);
  }
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(`📝 交雄会だて病院 オーダリング総合ポータル 起動完了`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 Local URL: http://localhost:${PORT}/`);
  console.log(`========================================================`);
});
