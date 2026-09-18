const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Article = require('../models/Article');
const User = require('../models/User');
const TargetPerson = require('../models/TargetPerson');
const { authenticateToken } = require('../middleware/auth');
const { signArticle, verifyArticle, getSystemPublicKeyArmor } = require('../utils/pgpSigner');

// 記事一覧取得 API
router.get('/articles', async (req, res) => {
  try {
    const articles = await Article.find()
      .populate('author', 'userName loginId department')
      .populate('targetPerson')
      .sort({ createdAt: 1 });

    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: '記事一覧の取得に失敗しました: ' + err.message });
  }
});

// PGP公開鍵取得 API (GET /api/pgp/public-key)
router.get('/pgp/public-key', (req, res) => {
  try {
    const publicKeyArmor = getSystemPublicKeyArmor();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(publicKeyArmor);
  } catch (err) {
    res.status(500).json({ error: '公開鍵の取得に失敗しました: ' + err.message });
  }
});

// 個別記事のPGP署名検証 API (GET /api/articles/:id/verify-pgp)
router.get('/articles/:id/verify-pgp', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id)
      .populate('author', 'userName loginId department')
      .populate('originalAuthor', 'userName loginId department')
      .populate('targetPerson');

    if (!article) {
      return res.status(404).json({ success: false, message: '記事が見つかりません。' });
    }

    const verifyResult = verifyArticle(article);
    const origAuthorName = article.originalAuthor ? (article.originalAuthor.userName || article.originalAuthor.loginId) : null;
    const origAuthorDept = article.originalAuthor ? article.originalAuthor.department : null;

    res.json({
      success: true,
      articleId: article._id,
      title: article.title,
      isOverride: Boolean(article.isOverride),
      proxyBy: (origAuthorName ? `${origAuthorName} (${origAuthorDept || '一般'})` : null) || (article.pgpSignature ? article.pgpSignature.proxyBy : null),
      ...verifyResult
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '検証エラー: ' + err.message });
  }
});

// 全記事のPGP署名一括検証 API (GET /api/articles/verify-all-pgp)
router.get('/articles-verify-all-pgp', async (req, res) => {
  try {
    const articles = await Article.find()
      .populate('author', 'userName loginId department')
      .populate('targetPerson')
      .sort({ createdAt: 1 });

    const results = articles.map(art => {
      const v = verifyArticle(art);
      return {
        articleId: art._id,
        title: art.title,
        isValid: v.isValid,
        tampered: v.tampered,
        signedBy: v.signedBy,
        keyId: v.keyId,
        message: v.message
      };
    });

    const total = results.length;
    const validCount = results.filter(r => r.isValid).length;
    const tamperedCount = results.filter(r => r.tampered).length;
    const unsignedCount = total - validCount - tamperedCount;

    res.json({
      success: true,
      summary: { total, validCount, tamperedCount, unsignedCount },
      results
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '一括検証エラー: ' + err.message });
  }
});

// 入力者切り替え API (POST /api/switch-author)
router.post('/switch-author', async (req, res) => {
  try {
    const { authorId, password, mode } = req.body;
    if (!authorId || !mongoose.isValidObjectId(authorId)) {
      return res.status(400).json({ success: false, error: '無効なユーザーIDです。' });
    }

    const selectedUser = await User.findById(authorId);
    if (!selectedUser) {
      return res.status(404).json({ success: false, error: '指定されたユーザーが見つかりません。' });
    }

    // 🔐 パスワード認証（切り替え先のパスワード必須）
    if (!password) {
      return res.status(400).json({ success: false, error: '切り替え先のパスワードを入力してください。' });
    }

    const isMatch = await selectedUser.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'パスワードが正しくありません。' });
    }

    const switchMode = (mode === 'complete') ? 'complete' : 'override';

    // セッション更新
    if (req.session) {
      if (!req.session.originalUser && req.session.user) {
        req.session.originalUser = { ...req.session.user };
      }

      if (switchMode === 'override') {
        // 一時的オーバーライド: 元のログインセッションは保持し、入力者情報のみオーバーライド
        req.session.isOverride = true;
        req.session.overrideAuthorId = selectedUser._id.toString();
        req.session.overrideAuthorName = selectedUser.userName;
        req.session.overrideAuthorDept = selectedUser.department;
        req.session.currentAuthorId = selectedUser._id.toString();
        req.session.currentAuthorName = selectedUser.userName;
        req.session.currentAuthorDept = selectedUser.department;
      } else {
        // 完全切り替え: セッション自体を切り替え先ユーザーに交代
        req.session.isOverride = false;
        req.session.overrideAuthorId = null;
        req.session.user = {
          id: selectedUser.loginId,
          name: selectedUser.userName,
          role: selectedUser.role,
          department: selectedUser.department
        };
        req.session.originalUser = { ...req.session.user };
        req.session.currentAuthorId = selectedUser._id.toString();
        req.session.currentAuthorName = selectedUser.userName;
        req.session.currentAuthorDept = selectedUser.department;
      }
    }

    res.json({
      success: true,
      mode: switchMode,
      message: switchMode === 'override'
        ? `入力者を ${selectedUser.userName} 様に一時オーバーライド（代行）しました。`
        : `入力者を ${selectedUser.userName} 様に完全に切り替えました。`,
      user: {
        id: selectedUser._id,
        userName: selectedUser.userName,
        loginId: selectedUser.loginId,
        department: selectedUser.department
      },
      originalUser: req.session ? req.session.originalUser : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: '入力者の切り替えに失敗しました: ' + err.message });
  }
});

// 一時的オーバーライド解除 API (POST /api/revert-override)
router.post('/revert-override', async (req, res) => {
  try {
    if (!req.session) {
      return res.status(400).json({ success: false, error: 'セッションが見つかりません。' });
    }

    req.session.isOverride = false;
    req.session.overrideAuthorId = null;

    let originalUserDoc = null;
    const origLoginId = req.session.originalUser ? req.session.originalUser.id : (req.session.user ? req.session.user.id : null);
    if (origLoginId) {
      originalUserDoc = await User.findOne({ loginId: origLoginId });
    }

    if (originalUserDoc) {
      req.session.currentAuthorId = originalUserDoc._id.toString();
      req.session.currentAuthorName = originalUserDoc.userName;
      req.session.currentAuthorDept = originalUserDoc.department;
    }

    res.json({
      success: true,
      message: '一時オーバーライドを解除し、元の入力者に戻しました。',
      user: originalUserDoc ? {
        id: originalUserDoc._id,
        userName: originalUserDoc.userName,
        loginId: originalUserDoc.loginId,
        department: originalUserDoc.department
      } : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'オーバーライド解除エラー: ' + err.message });
  }
});

// 新規記事作成処理 (POST /api/articles)
router.post('/articles', async (req, res) => {
  try {
    const { title, content, targetPersonId, category, medicine, dose, rate, route, remarks, remoteHostUrl, parentArticleId, authorId: customAuthorId } = req.body;

    // 入力者 (author) の取得:
    // 1. リクエストで明示された authorId
    let authorUser = null;
    let authorId = null;
    const targetAuthorId = customAuthorId || (req.session ? req.session.currentAuthorId : null);

    if (targetAuthorId && mongoose.isValidObjectId(targetAuthorId)) {
      authorUser = await User.findById(targetAuthorId);
      if (authorUser) authorId = authorUser._id;
    }

    // 2. セッションのログインユーザー
    if (!authorId) {
      if (req.session && req.session.user) {
        authorUser = await User.findOne({ loginId: req.session.user.id });
        if (authorUser) authorId = authorUser._id;
      } else if (req.user) {
        authorUser = req.user;
        authorId = req.user._id;
      }
    }

    if (!authorId) {
      return res.status(401).send('<script>alert("投稿にはログインが必要です。"); window.location.href="/login";</script>');
    }

    // 3. 一時的オーバーライド（代行入力）判定と元の入力者 (originalAuthor) の取得
    const isOverride = Boolean(req.session && req.session.isOverride);
    let originalAuthorId = null;
    let originalAuthorUser = null;
    if (isOverride && req.session && req.session.originalUser) {
      const origLogin = req.session.originalUser.id || req.session.originalUser.loginId;
      if (origLogin) {
        originalAuthorUser = await User.findOne({ loginId: origLogin });
        if (originalAuthorUser) originalAuthorId = originalAuthorUser._id;
      }
    }

    // 対象者の取得
    let targetDoc = null;
    if (targetPersonId) {
      targetDoc = await TargetPerson.findById(targetPersonId);
    }

    // 区分判定
    const isIvCategory = category && category.includes('点滴');
    const isMealCategory = category && category.includes('食事');
    const isRadCategory = category && (category.includes('放射線') || category.includes('レントゲン') || category.includes('CT') || category.includes('MRI'));

    let finalContent = content ? content.trim() : '';
    let finalCategory = category || '共有メモ';
    let ivOrderObj = null;
    let mealOrderObj = null;
    let radOrderObj = null;
    const { mealType, timing, stapleFood, sideDish, allergies, scheduledAt, examType, modality, contrast, portable, purpose } = req.body;

    // 開始日時のフォーマット（デフォルト: 現在時刻）
    const scheduleDateObj = scheduledAt ? new Date(scheduledAt) : new Date();
    const scheduledTimeStr = scheduleDateObj.toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    if (isIvCategory) {
      finalCategory = '💉 点滴オーダー';
      const medStr = medicine ? medicine.trim() : (content ? content.trim() : '指定なし');
      const targetInfoStr = targetDoc ? `[${targetDoc.customId}] ${targetDoc.name} (${targetDoc.department || '未設定'})` : '全体/特定対象者なし';
      
      finalContent = 
`【💉 点滴指示オーダー】
・開始日時: 🕒 ${scheduledTimeStr}
・対象者: ${targetInfoStr}
・薬剤名: ${medStr}
・投与量: ${dose ? dose.trim() : '規定量'}
・投与速度・時間: ${rate ? rate.trim() : '指示通り'}
・投与経路: ${route ? route.trim() : '点滴静注'}
・指示・備考: ${remarks ? remarks.trim() : (content ? content.trim() : '特記事項なし')}`;

      ivOrderObj = {
        medicine: medStr,
        dose: dose ? dose.trim() : '',
        rate: rate ? rate.trim() : '',
        route: route ? route.trim() : '',
        remarks: remarks ? remarks.trim() : '',
        scheduledAt: scheduleDateObj
      };
    } else if (isMealCategory) {
      finalCategory = '🍱 食事選択オーダー';
      const mTypeStr = mealType ? mealType.trim() : (content ? content.trim() : '常食');
      const targetInfoStr = targetDoc ? `[${targetDoc.customId}] ${targetDoc.name} (${targetDoc.department || '未設定'})` : '全体/特定対象者なし';

      finalContent = 
`【🍱 食事選択指示オーダー】
・開始日時: 🕒 ${scheduledTimeStr}
・対象者: ${targetInfoStr}
・食形態・食種: ${mTypeStr}
・提供区分: ${timing ? timing.trim() : '毎食'}
・主食/副食: 主食: ${stapleFood ? stapleFood.trim() : '標準'} / 副食: ${sideDish ? sideDish.trim() : '標準'}
・アレルギー・禁止食: ${allergies ? allergies.trim() : 'なし'}
・指示・備考: ${remarks ? remarks.trim() : (content ? content.trim() : '特記事項なし')}`;

      mealOrderObj = {
        mealType: mTypeStr,
        timing: timing ? timing.trim() : '毎食',
        stapleFood: stapleFood ? stapleFood.trim() : '',
        sideDish: sideDish ? sideDish.trim() : '',
        allergies: allergies ? allergies.trim() : '',
        remarks: remarks ? remarks.trim() : '',
        scheduledAt: scheduleDateObj
      };
    } else if (isRadCategory) {
      finalCategory = '🩻 放射線科オーダー';
      const examStr = examType ? examType.trim() : (content ? content.trim() : '胸部X線');
      const targetInfoStr = targetDoc ? `[${targetDoc.customId}] ${targetDoc.name} (${targetDoc.department || '未設定'})` : '全体/特定対象者なし';

      finalContent = 
`【🩻 放射線科検査指示オーダー】
・開始日時: 🕒 ${scheduledTimeStr}
・対象者: ${targetInfoStr}
・検査種別・部位: ${examStr}
・モダリティ: ${modality ? modality.trim() : '一般撮影 (X-Ray)'}
・造影有無: ${contrast ? contrast.trim() : '単純 (造影なし)'}
・撮影場所: ${portable ? portable.trim() : '放射線科撮影室'}
・検査目的・臨床情報: ${purpose ? purpose.trim() : '経過観察・精査'}
・指示・注意事項: ${remarks ? remarks.trim() : (content ? content.trim() : '特記事項なし')}`;

      radOrderObj = {
        examType: examStr,
        modality: modality ? modality.trim() : 'X-Ray',
        contrast: contrast ? contrast.trim() : '単純',
        portable: portable ? portable.trim() : '撮影室',
        purpose: purpose ? purpose.trim() : '',
        remarks: remarks ? remarks.trim() : '',
        scheduledAt: scheduleDateObj
      };
    }

    if (!finalContent) {
      return res.send('<script>alert("本文、薬剤名、食種、または検査種別を入力してください。"); window.history.back();</script>');
    }

    const articleTitle = (title && title.trim()) 
      ? title.trim() 
      : (finalContent.length > 20 ? finalContent.substring(0, 20) + '...' : finalContent);

    // 🔏 PGP電子署名の自動生成
    const authorNameStr = authorUser ? (authorUser.userName || authorUser.loginId) : '担当者';
    const authorLoginIdStr = authorUser ? authorUser.loginId : 'unknown';
    const authorDeptStr = authorUser ? (authorUser.department || '一般') : '一般';
    const nowTime = new Date();

    const pgpSig = signArticle({
      title: articleTitle,
      content: finalContent,
      targetPersonId: targetDoc ? targetDoc._id.toString() : 'NONE',
      authorName: authorNameStr,
      authorLoginId: authorLoginIdStr,
      authorDept: authorDeptStr,
      category: finalCategory,
      createdAt: nowTime
    });

    if (isOverride && originalAuthorUser) {
      pgpSig.isOverride = true;
      pgpSig.proxyBy = `${originalAuthorUser.userName || originalAuthorUser.loginId} (${originalAuthorUser.department || '一般'})`;
    }

    const isValidParentId = Boolean(
      parentArticleId &&
      typeof parentArticleId === 'string' &&
      parentArticleId.trim() !== '' &&
      parentArticleId !== 'null' &&
      parentArticleId !== 'undefined' &&
      mongoose.isValidObjectId(parentArticleId.trim())
    );
    const newArticle = new Article({
      title: articleTitle,
      content: finalContent,
      targetPerson: targetDoc ? targetDoc._id : null,
      author: authorId,
      isOverride: isOverride,
      originalAuthor: originalAuthorId,
      category: finalCategory,
      parentArticle: isValidParentId ? parentArticleId.trim() : null,
      isCorrection: isValidParentId,
      ivOrderDetails: ivOrderObj,
      mealOrderDetails: mealOrderObj,
      radiologyOrderDetails: radOrderObj,
      remoteSync: {
        isRemoteOrder: false,
        remoteHost: remoteHostUrl ? remoteHostUrl.trim() : '',
        syncStatus: remoteHostUrl ? 'PENDING' : 'NONE',
        syncedAt: null
      },
      pgpSignature: pgpSig,
      createdAt: nowTime
    });

    await newArticle.save();

    // 🌐 別ホスト送信処理 (点滴・食事・放射線オーダー時 & remoteHostUrl 指定時)
    if ((isIvCategory || isMealCategory || isRadCategory) && remoteHostUrl && remoteHostUrl.trim() !== '') {
      let targetUrl = remoteHostUrl.trim();
      let endpoint = '/api/iv-orders/receive';
      if (isMealCategory) endpoint = '/api/meal-orders/receive';
      if (isRadCategory) endpoint = '/api/radiology-orders/receive';

      if (!targetUrl.endsWith(endpoint)) {
        targetUrl = targetUrl.replace(/\/+$/, '') + endpoint;
      }

      const authorNameStr = authorUser ? (authorUser.userName || authorUser.loginId) : '不明';

      let payload = {
        orderId: newArticle._id.toString(),
        targetCustomId: targetDoc ? targetDoc.customId : '',
        targetName: targetDoc ? targetDoc.name : '',
        targetDepartment: targetDoc ? targetDoc.department : '',
        scheduledAt: scheduleDateObj.toISOString(),
        senderHost: req.protocol + '://' + req.get('host'),
        senderUser: authorNameStr,
        createdAt: newArticle.createdAt
      };

      if (isIvCategory) {
        payload.medicine = medicine ? medicine.trim() : (content ? content.trim() : '');
        payload.dose = dose ? dose.trim() : '';
        payload.rate = rate ? rate.trim() : '';
        payload.route = route ? route.trim() : '';
        payload.remarks = remarks ? remarks.trim() : '';
      } else if (isMealCategory) {
        payload.mealType = mealType ? mealType.trim() : (content ? content.trim() : '常食');
        payload.timing = timing ? timing.trim() : '';
        payload.stapleFood = stapleFood ? stapleFood.trim() : '';
        payload.sideDish = sideDish ? sideDish.trim() : '';
        payload.allergies = allergies ? allergies.trim() : '';
        payload.remarks = remarks ? remarks.trim() : '';
      } else if (isRadCategory) {
        payload.examType = examType ? examType.trim() : (content ? content.trim() : '胸部X線');
        payload.modality = modality ? modality.trim() : '';
        payload.contrast = contrast ? contrast.trim() : '';
        payload.portable = portable ? portable.trim() : '';
        payload.purpose = purpose ? purpose.trim() : '';
        payload.remarks = remarks ? remarks.trim() : '';
      }

      try {
        console.log(`[別ホストオーダー送信指示] 送信先: ${targetUrl}`);
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000)
        });

        if (response.ok) {
          const resData = await response.json();
          newArticle.remoteSync.syncStatus = 'SUCCESS';
          newArticle.remoteSync.syncedAt = new Date();
          console.log(`[別ホスト送信成功]`, resData);
        } else {
          newArticle.remoteSync.syncStatus = 'FAILED';
          newArticle.remoteSync.errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
        }
      } catch (sendErr) {
        newArticle.remoteSync.syncStatus = 'FAILED';
        newArticle.remoteSync.errorMessage = `送信失敗: ${sendErr.message}`;
      }

      await newArticle.save();
    }
    
    // 関連データのpopulate（作成者・代行元作成者・対象者・親記事情報）
    await newArticle.populate([
      { path: 'author', select: 'userName loginId department' },
      { path: 'originalAuthor', select: 'userName loginId department' },
      { path: 'targetPerson', select: 'customId name department' },
      { 
        path: 'parentArticle', 
        select: 'title createdAt content author',
        populate: { path: 'author', select: 'userName loginId department' }
      }
    ]);

    // リクエストに応じたレスポンス（API/fetch の場合は JSON、通常フォームはリダイレクト）
    if (req.headers['accept'] && req.headers['accept'].includes('application/json')) {
      return res.status(201).json({ success: true, article: newArticle });
    }
    if (req.accepts('html')) {
      const redirectUrl = targetDoc ? `/articles?targetId=${targetDoc._id}` : '/articles';
      return res.redirect(redirectUrl);
    }
    res.status(201).json({ success: true, article: newArticle });
  } catch (err) {
    res.status(500).send('記事投稿エラー: ' + err.message);
  }
});

// 🔒 電子カルテ真正性保護：記事の削除要求を恒久的に拒絶 (POST /api/articles/:id/delete および DELETE /api/articles/:id)
router.post('/articles/:id/delete', (req, res) => {
  return res.status(403).send('<script>alert("【真正性保護・削除禁止】電子カルテ診療記録および記事は、医療情報安全管理指針および法令に基づき事後削除が禁止されています。修正が必要な場合は「引用して修正」機能をご利用ください。"); window.location.href="/articles";</script>');
});

router.delete('/articles/:id', (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'DELETION_FORBIDDEN',
    message: '【真正性保護・削除禁止】電子カルテ診療記録および記事の事後削除は禁止されています。修正が必要な場合は引用ツリー形式で追記してください。'
  });
});

module.exports = router;
