const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Incident = require('../models/Incident');
const TargetPerson = require('../models/TargetPerson');
const Article = require('../models/Article');
const { redirectIfLoggedIn } = require('../middleware/auth');
const { signArticle, verifyArticle } = require('../utils/pgpSigner');

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1. ログイン画面
router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.render('login');
});

// 2. 新規ユーザー登録画面
router.get('/register', redirectIfLoggedIn, (req, res) => {
  res.render('register');
});

// 3. トップ画面（対象者管理画面を初期メニューとして表示）
router.get('/', async (req, res) => {
  res.redirect('/target-people');
});

// 旧メニュー画面（念のためのバックアップ画面として保持）
router.get('/menu', async (req, res) => {
  const user = req.session ? req.session.user : null;
  res.render('index', { user });
});

// 4. ダッシュボード（インシデント管理専用画面）
router.get('/dashboard', async (req, res) => {
  try {
    const incidents = await Incident.find()
      .populate('patient.targetPersonRef')
      .sort({ createdAt: -1 });

    const targetPeople = await TargetPerson.find().sort({ customId: 1 });
    const user = req.session ? req.session.user : null;

    res.render('dashboard', {
      user: user ? user.name : 'ゲスト',
      incidents,
      targetPeople
    });
  } catch (err) {
    res.status(500).send('ダッシュボードデータ取得エラー: ' + err.message);
  }
});

// 4.5. 記事管理画面
router.get('/articles', async (req, res) => {
  try {
    const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const targetPeople = await TargetPerson.find().sort({ customId: 1 });
    const users = await User.find({}, 'userName loginId department').sort({ userName: 1, loginId: 1 });
    const articleFilter = {};

    if (searchQuery) {
      const searchRegex = new RegExp(escapeRegex(searchQuery), 'i');
      const matchingTargetPeople = targetPeople.filter(target =>
        searchRegex.test(target.customId) || searchRegex.test(target.name) || searchRegex.test(target.department || '')
      );
      const matchingUsers = users.filter(author =>
        searchRegex.test(author.userName || '') ||
        searchRegex.test(author.loginId || '') ||
        searchRegex.test(author.department || '')
      );
      const textFields = [
        'title',
        'content',
        'category',
        'ivOrderDetails.medicine',
        'ivOrderDetails.dose',
        'ivOrderDetails.rate',
        'ivOrderDetails.route',
        'ivOrderDetails.remarks',
        'mealOrderDetails.mealType',
        'mealOrderDetails.timing',
        'mealOrderDetails.stapleFood',
        'mealOrderDetails.sideDish',
        'mealOrderDetails.allergies',
        'mealOrderDetails.remarks',
        'radiologyOrderDetails.examType',
        'radiologyOrderDetails.modality',
        'radiologyOrderDetails.contrast',
        'radiologyOrderDetails.portable',
        'radiologyOrderDetails.purpose',
        'radiologyOrderDetails.remarks',
        'remoteSync.remoteHost',
        'remoteSync.syncStatus'
      ];

      articleFilter.$or = [
        ...textFields.map(field => ({ [field]: searchRegex })),
        ...(matchingTargetPeople.length > 0
          ? [{ targetPerson: { $in: matchingTargetPeople.map(target => target._id) } }]
          : []),
        ...(matchingUsers.length > 0
          ? [{ author: { $in: matchingUsers.map(author => author._id) } }]
          : [])
      ];
    }

    const articles = await Article.find(articleFilter)
      .populate('author')
      .populate('originalAuthor')
      .populate('targetPerson')
      .populate({
        path: 'parentArticle',
        populate: [
          { path: 'author', select: 'userName loginId department' },
          { path: 'originalAuthor', select: 'userName loginId department' }
        ]
      })
      .sort({ createdAt: -1 });

    // 既存記事で未署名データがあれば自動署名マイグレーション
    for (const art of articles) {
      if (!art.pgpSignature || !art.pgpSignature.rawSignature) {
        const authorNameStr = art.author ? (art.author.userName || art.author.loginId) : '担当者';
        const authorLoginIdStr = art.author ? art.author.loginId : 'system';
        const authorDeptStr = art.author ? (art.author.department || '一般') : '一般';

        const pgpSig = signArticle({
          title: art.title,
          content: art.content,
          targetPersonId: art.targetPerson ? art.targetPerson._id.toString() : 'NONE',
          authorName: authorNameStr,
          authorLoginId: authorLoginIdStr,
          authorDept: authorDeptStr,
          category: art.category || '共有メモ',
          createdAt: art.createdAt
        });

        art.pgpSignature = pgpSig;
        await art.save();
      }
    }

    // 署名検証結果を各記事オブジェクトに付与
    const articlesWithVerification = articles.map(art => {
      const v = verifyArticle(art);
      const artObj = art.toObject();
      artObj.pgpVerification = v;
      return artObj;
    });

    // 🌳 記事マップの初期化
    const articleMap = new Map();
    articlesWithVerification.forEach(art => {
      art.children = [];
      art.isOriginalHidden = false;
      art.isQuotedCorrection = false;
      articleMap.set(art._id.toString(), art);
    });

    // オーダー判定ヘルパー
    function checkIsOrder(art) {
      if (!art) return false;
      const cat = art.category || '';
      const title = art.title || '';
      return Boolean(
        (art.ivOrderDetails && art.ivOrderDetails.medicine) ||
        (art.radiologyOrderDetails && art.radiologyOrderDetails.examType) ||
        (art.mealOrderDetails && art.mealOrderDetails.mealType) ||
        cat.includes('処方') || cat.includes('点滴') || cat.includes('注射') ||
        cat.includes('オーダー') || cat.includes('放射線') || cat.includes('レントゲン') || cat.includes('CT') || cat.includes('MRI') ||
        title.includes('【処方】') || title.includes('【点滴オーダー】') || title.includes('【放射線オーダー】') || title.includes('【食事選択オーダー】') || title.includes('オーダー')
      );
    }

    // 実施確認判定ヘルパー (薬剤師・放射線技師等)
    function checkIsExecution(art) {
      if (!art) return false;
      const dept = (art.author && art.author.department) ? art.author.department : '';
      const cat = art.category || '';
      const title = art.title || '';
      return Boolean(
        dept === '薬剤師' || dept === '放射線技師' ||
        cat.includes('処方鑑査') || cat.includes('調剤') || cat.includes('服薬指導') || cat.includes('疑義照会') || cat.includes('TDM') ||
        cat.includes('放射線検査') || cat.includes('ポータブル撮影') || cat.includes('撮影実施') || cat.includes('造影剤') ||
        title.includes('薬剤師') || title.includes('処方鑑査') || title.includes('調剤') || title.includes('放射線技師') || title.includes('撮影実施') || title.includes('ポータブル撮影')
      );
    }

    // 判定関数: child が parent を更新・実施する記事であり、親を隠して最新ステータスのみ表示すべきか
    function shouldHideParentArticle(child, parent) {
      if (!parent) return false;

      const isParentOrder = checkIsOrder(parent);
      const isChildOrder = checkIsOrder(child);
      const isChildExecution = checkIsExecution(child);
      const isChildCorrection = Boolean(
        child.isCorrection ||
        (child.title && (child.title.includes('【修正】') || child.title.includes('【追記】'))) ||
        (child.content && (child.content.includes('【引用元:') || child.content.includes('【修正・追記内容】')))
      );

      // ケース1: 親がオーダー（処方・点滴・放射線・食事等）の場合
      if (isParentOrder) {
        // 薬剤師の鑑査調剤、技師の撮影確認、オーダー自体の修正・変更、または後続オーダーの場合
        // -> 親オーダー（古い未実施・変更前の指示）を隠し、最新ステータスの子記事のみを表示する！
        if (isChildExecution || isChildCorrection || isChildOrder) {
          return true;
        }
      }

      // ケース2: 親が通常のカルテ記事（診察録・申し送り等）の場合
      if (!isParentOrder) {
        // 子がカルテの修正記事であれば親カルテを隠す
        // （ただし子がカルテに付随して出された新規処方・点滴オーダー等の場合は親カルテは隠さない）
        if (isChildCorrection && !isChildOrder && !isChildExecution) {
          return true;
        }
      }

      return false;
    }

    // 🌳 親子関係の構築 & 最新ステータス判定と元記事(非表示)フラグの設定
    const hiddenOriginalIds = new Set();

    articlesWithVerification.forEach(art => {
      const parentId = art.parentArticle
        ? (art.parentArticle._id ? art.parentArticle._id.toString() : art.parentArticle.toString())
        : null;

      if (parentId && articleMap.has(parentId)) {
        const parentArt = articleMap.get(parentId);

        if (shouldHideParentArticle(art, parentArt)) {
          art.isQuotedCorrection = true; // 引用による最新更新記事フラグ
          
          // 親がオーダーで、子がオーダー詳細を持っていない場合は引き継ぐ
          if (!art.ivOrderDetails && parentArt.ivOrderDetails) art.ivOrderDetails = parentArt.ivOrderDetails;
          if (!art.radiologyOrderDetails && parentArt.radiologyOrderDetails) art.radiologyOrderDetails = parentArt.radiologyOrderDetails;
          if (!art.mealOrderDetails && parentArt.mealOrderDetails) art.mealOrderDetails = parentArt.mealOrderDetails;

          // 親オーダー種別の引き継ぎ（処方・放射線等の属性）
          const isParentOrder = checkIsOrder(parentArt);
          art.isParentOrder = isParentOrder;

          art.parentArticleData = {
            id: parentArt._id.toString(),
            title: parentArt.title,
            content: parentArt.content,
            createdAt: parentArt.createdAt,
            authorName: parentArt.author ? (parentArt.author.userName || parentArt.author.loginId) : '担当者',
            authorDept: parentArt.author ? (parentArt.author.department || '一般') : '一般',
            isOrder: isParentOrder
          };

          // 🔒 元記事はツリー表示で表示しない（最新ステータスのみ表示）
          hiddenOriginalIds.add(parentId);
          parentArt.isOriginalHidden = true;
        }
      }
    });

    // 🌳 有効な表示親（非表示になっていない直近の先祖）を探索する関数
    function findVisibleParent(node) {
      let curr = node;
      while (curr) {
        const parentId = curr.parentArticle
          ? (curr.parentArticle._id ? curr.parentArticle._id.toString() : curr.parentArticle.toString())
          : null;
        if (!parentId || !articleMap.has(parentId)) return null;
        const parent = articleMap.get(parentId);
        if (!parent.isOriginalHidden) return parent;
        curr = parent;
      }
      return null;
    }

    // 表示対象の記事のみを直近の表示親の children に登録し、親がいなければ rootArticles に登録
    const rootArticles = [];
    articlesWithVerification.forEach(art => {
      if (art.isOriginalHidden) return; // 非表示元記事はスキップ

      const visibleParent = findVisibleParent(art);
      if (visibleParent) {
        if (!visibleParent.children.some(c => c._id.toString() === art._id.toString())) {
          visibleParent.children.push(art);
        }
      } else {
        rootArticles.push(art);
      }
    });

    // 深さ優先探索でフラットなツリー順配列を作成（非表示の元記事は含めない）
    const treeOrderedArticles = [];
    const addedIds = new Set();

    function traverseTree(node, depth = 0, isLastChild = false) {
      if (node.isOriginalHidden || addedIds.has(node._id.toString())) {
        return;
      }
      addedIds.add(node._id.toString());
      node.treeDepth = depth;
      node.isLastChild = isLastChild;
      treeOrderedArticles.push(node);

      if (node.children && node.children.length > 0) {
        const visibleChildren = node.children.filter(c => !c.isOriginalHidden && !addedIds.has(c._id.toString()));
        visibleChildren.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const count = visibleChildren.length;
        visibleChildren.forEach((child, idx) => {
          traverseTree(child, depth + 1, idx === count - 1);
        });
      }
    }

    // ルート記事を作成日時順（最新順・上が最新）に並べ、各親の直下に追記ツリーを展開
    rootArticles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    rootArticles.forEach(root => traverseTree(root, 0, false));

    const user = req.session ? req.session.user : null;

    // 現在の入力者 (セッションで選択された currentAuthorId があれば優先、なければログインユーザー)
    let currentAuthor = null;
    if (req.session && req.session.currentAuthorId) {
      currentAuthor = await User.findById(req.session.currentAuthorId);
    }
    if (!currentAuthor) {
      if (req.user) {
        currentAuthor = req.user;
      } else if (user && user.id) {
        currentAuthor = await User.findOne({ loginId: user.id });
      }
    }

    let currentUserDept = '医師';
    if (currentAuthor && currentAuthor.department) {
      currentUserDept = currentAuthor.department;
    } else if (req.user && req.user.department) {
      currentUserDept = req.user.department;
    }

    const isOverride = Boolean(req.session && req.session.isOverride);
    const originalUser = (req.session && req.session.originalUser) ? req.session.originalUser : user;

    res.render('articles', {
      user: currentAuthor ? (currentAuthor.userName || currentAuthor.loginId) : (user ? user.name : 'ゲスト'),
      currentUserDoc: currentAuthor,
      currentUserDept,
      users,
      articles: treeOrderedArticles,
      targetPeople,
      searchQuery,
      isOverride,
      originalUser
    });
  } catch (err) {
    res.status(500).send('記事データ取得エラー: ' + err.message);
  }
});

// 4.6. ユーザー管理画面
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    const user = req.session ? req.session.user : null;
    const currentUserDoc = req.user || null;

    res.render('users', {
      user: user ? user.name : 'ゲスト',
      userSession: user,
      currentUserDoc,
      users
    });
  } catch (err) {
    res.status(500).send('ユーザー画面データの取得エラー: ' + err.message);
  }
});

// 4.7. 対象者管理画面
router.get('/target-people', async (req, res) => {
  try {
    const targetPeople = await TargetPerson.find().sort({ customId: 1 });
    const user = req.session ? req.session.user : null;

    // 各対象者の記事カウントを集計
    const articles = await Article.find({}, 'targetPerson');
    const articleCounts = {};
    articles.forEach(a => {
      if (a.targetPerson) {
        const tid = a.targetPerson.toString();
        articleCounts[tid] = (articleCounts[tid] || 0) + 1;
      }
    });

    res.render('target-people', {
      user: user ? user.name : 'ゲスト',
      targetPeople,
      articleCounts
    });
  } catch (err) {
    res.status(500).send('対象者画面データの取得エラー: ' + err.message);
  }
});

// 5. レベル0 入力画面（ログイン者の氏名と対象者マスタ一覧を渡す）
router.get('/incident/report/level0', async (req, res) => {
  try {
    const targetPeople = await TargetPerson.find().sort({ customId: 1 });
    const defaultName = req.session && req.session.user ? req.session.user.name : '';
    res.render('level0-form', { defaultName, targetPeople });
  } catch (err) {
    res.status(500).send('フォームデータの読み込みエラー: ' + err.message);
  }
});

// 6. レベル1以上 入力画面
router.get('/incident/report/level1', async (req, res) => {
  try {
    const targetPeople = await TargetPerson.find().sort({ customId: 1 });
    const defaultName = req.session && req.session.user ? req.session.user.name : '';
    res.render('level1-form', { defaultName, targetPeople });
  } catch (err) {
    res.status(500).send('フォームデータの読み込みエラー: ' + err.message);
  }
});

// 7. 提出データ一覧画面
router.get('/incident/list', async (req, res) => {
  try {
    const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const targetPeople = await TargetPerson.find().sort({ customId: 1 });
    const incidentFilter = {};

    if (searchQuery) {
      const searchRegex = new RegExp(escapeRegex(searchQuery), 'i');
      const matchingTargetPeople = targetPeople.filter(target =>
        searchRegex.test(target.customId) || searchRegex.test(target.name)
      );
      const textFields = [
        'level',
        'location',
        'description',
        'reporter.loginId',
        'reporter.name',
        'reporter.jobTitle',
        'reporter.department',
        'patient.name',
        'patient.id',
        'patient.gender',
        'eventCategory',
        'eventSummary',
        'tubeDetails.type',
        'tubeDetails.cause',
        'fallDetails.triggerAction',
        'fallDetails.envFactor',
        'fallDetails.adl',
        'fallDetails.careLevel',
        'causes.environmentalPrimary',
        'causes.environmentalSecondary',
        'humanFactors.primary',
        'humanFactors.secondary',
        'postDiscoveryAction',
        'detailedCauseDescription',
        'resultStatus',
        'countermeasure'
      ];

      incidentFilter.$or = [
        ...textFields.map(field => ({ [field]: searchRegex })),
        ...(matchingTargetPeople.length > 0
          ? [{ 'patient.targetPersonRef': { $in: matchingTargetPeople.map(target => target._id) } }]
          : [])
      ];

      if (/^\d{4}-\d{2}-\d{2}$/.test(searchQuery)) {
        const start = new Date(`${searchQuery}T00:00:00.000Z`);
        if (!Number.isNaN(start.getTime())) {
          const end = new Date(start);
          end.setUTCDate(end.getUTCDate() + 1);
          incidentFilter.$or.push(
            { reportDate: { $gte: start, $lt: end } },
            { occurrenceDate: { $gte: start, $lt: end } }
          );
        }
      }
    }

    const incidents = await Incident.find(incidentFilter)
      .populate('patient.targetPersonRef')
      .sort({ createdAt: -1 });
    res.render('list', { incidents, targetPeople, searchQuery });
  } catch (err) {
    res.status(500).send('データ取得エラー: ' + err.message);
  }
});

// 8. データ修正画面
router.get('/incident/edit/:id', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id).populate('patient.targetPersonRef');
    if (!incident) return res.status(404).send('該当レポートなし');
    
    if (req.session && req.session.user && incident.reporter.loginId !== req.session.user.id) {
      return res.send('<script>alert("ご自身が提出したレポート以外は修正できません。"); window.location.href="/incident/list";</script>');
    }

    const targetPeople = await TargetPerson.find().sort({ customId: 1 });
    res.render('edit-form', { incident, targetPeople });
  } catch (err) {
    res.status(500).send('データ取得エラー: ' + err.message);
  }
});

module.exports = router;
