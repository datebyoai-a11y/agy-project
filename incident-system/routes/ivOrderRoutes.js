const express = require('express');
const router = express.Router();
const Article = require('../models/Article');
const TargetPerson = require('../models/TargetPerson');
const User = require('../models/User');
const { signArticle } = require('../utils/pgpSigner');

// 1. 点滴オーダー作成 & 別ホストへ送信 API (内部用)
router.post('/iv-orders', async (req, res) => {
  try {
    const { targetPersonId, medicine, dose, rate, route, remarks, remoteHostUrl, scheduledAt } = req.body;

    if (!medicine || !medicine.trim()) {
      if (req.accepts('html')) {
        return res.send('<script>alert("薬剤名を入力してください。"); window.history.back();</script>');
      }
      return res.status(400).json({ success: false, message: '薬剤名は必須です。' });
    }

    // ログインユーザーの取得
    let authorUser = null;
    if (req.session && req.session.user) {
      authorUser = await User.findOne({ loginId: req.session.user.id });
    } else if (req.user) {
      authorUser = req.user;
    }

    // 対象者の取得
    let targetDoc = null;
    if (targetPersonId) {
      targetDoc = await TargetPerson.findById(targetPersonId);
    }

    const targetInfoStr = targetDoc ? `[${targetDoc.customId}] ${targetDoc.name} (${targetDoc.department || '未設定'})` : '全体/特定対象者なし';
    const authorNameStr = authorUser ? (authorUser.userName || authorUser.loginId) : '不明';

    const scheduleDateObj = scheduledAt ? new Date(scheduledAt) : new Date();
    const scheduledTimeStr = scheduleDateObj.toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    // 記事本文の自動整形
    const formattedContent = 
`【💉 点滴指示オーダー】
・開始日時: 🕒 ${scheduledTimeStr}
・対象者: ${targetInfoStr}
・薬剤名: ${medicine.trim()}
・投与量: ${dose ? dose.trim() : '規定量'}
・投与速度・時間: ${rate ? rate.trim() : '指示通り'}
・投与経路: ${route ? route.trim() : '点滴静注'}
・指示・備考: ${remarks ? remarks.trim() : '特記事項なし'}`;

    const title = `💉 点滴指示: ${medicine.trim()} (${targetDoc ? targetDoc.name : '全体'})`;

    // 記事オブジェクトの生成
    const newArticle = new Article({
      title,
      content: formattedContent,
      targetPerson: targetDoc ? targetDoc._id : null,
      author: authorUser ? authorUser._id : null,
      category: '💉 点滴オーダー',
      ivOrderDetails: {
        medicine: medicine.trim(),
        dose: dose ? dose.trim() : '',
        rate: rate ? rate.trim() : '',
        route: route ? route.trim() : '',
        remarks: remarks ? remarks.trim() : '',
        scheduledAt: scheduleDateObj
      },
      remoteSync: {
        isRemoteOrder: false,
        remoteHost: remoteHostUrl ? remoteHostUrl.trim() : '',
        syncStatus: remoteHostUrl ? 'PENDING' : 'NONE',
        syncedAt: null
      }
    });

    await newArticle.save();

    // 🌐 別ホストへの送信処理（remoteHostUrl が指定されている場合）
    if (remoteHostUrl && remoteHostUrl.trim() !== '') {
      let targetUrl = remoteHostUrl.trim();
      // パス補完 ( /api/iv-orders/receive が含まれていなければ付与 )
      if (!targetUrl.endsWith('/api/iv-orders/receive')) {
        targetUrl = targetUrl.replace(/\/+$/, '') + '/api/iv-orders/receive';
      }

      const payload = {
        orderId: newArticle._id.toString(),
        targetCustomId: targetDoc ? targetDoc.customId : '',
        targetName: targetDoc ? targetDoc.name : '',
        targetDepartment: targetDoc ? targetDoc.department : '',
        medicine: medicine.trim(),
        dose: dose ? dose.trim() : '',
        rate: rate ? rate.trim() : '',
        route: route ? route.trim() : '',
        remarks: remarks ? remarks.trim() : '',
        senderHost: req.protocol + '://' + req.get('host'),
        senderUser: authorNameStr,
        createdAt: newArticle.createdAt
      };

      try {
        console.log(`[別ホスト送信指示] 送信先: ${targetUrl}`);
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000) // 6秒タイムアウト
        });

        if (response.ok) {
          const resData = await response.json();
          newArticle.remoteSync.syncStatus = 'SUCCESS';
          newArticle.remoteSync.syncedAt = new Date();
          newArticle.remoteSync.errorMessage = '';
          console.log(`[別ホスト送信成功] レスポンス:`, resData);
        } else {
          newArticle.remoteSync.syncStatus = 'FAILED';
          newArticle.remoteSync.errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
          console.error(`[別ホスト送信失敗] HTTP ${response.status}`);
        }
      } catch (sendErr) {
        newArticle.remoteSync.syncStatus = 'FAILED';
        newArticle.remoteSync.errorMessage = `送信失敗: ${sendErr.message}`;
        console.error(`[別ホスト送信例外]`, sendErr.message);
      }

      await newArticle.save();
    }

    if (req.accepts('html')) {
      return res.redirect('/articles');
    }
    res.status(201).json({ success: true, message: '点滴オーダーを発行しました。', article: newArticle });

  } catch (err) {
    console.error('点滴オーダー登録エラー:', err);
    res.status(500).send('点滴オーダー登録エラー: ' + err.message);
  }
});

// 2. 外部ホストからの点滴オーダー受信 API (公開・認証不要エンドポイント)
router.post('/iv-orders/receive', async (req, res) => {
  try {
    const {
      isTest,
      targetCustomId,
      targetName,
      targetDepartment,
      scheduledAt,
      medicine,
      dose,
      rate,
      route,
      remarks,
      senderHost,
      senderUser
    } = req.body;

    console.log(`[外部点滴オーダー受信] 送信元: ${senderHost || '未知ホスト'}, 担当: ${senderUser || '不明'}, 薬剤: ${medicine}, テストフラグ: ${isTest}`);

    // 💡 疎通テストの場合は記事として保存せず、テスト成功応答を返して捨てる
    if (isTest) {
      console.log(`[疎通テスト受信] 送信元: ${senderHost} からの接続テストを確認。記事には保存せず捨てます。`);
      return res.json({
        success: true,
        isTest: true,
        message: '疎通テスト成功：送信先ホストは正常に応答しました（記事には保存せずスキップしました）。'
      });
    }

    if (!medicine) {
      return res.status(400).json({ success: false, message: '薬剤名データが必要です。' });
    }

    // 対象者の照合または自動検索
    let targetDoc = null;
    if (targetCustomId) {
      targetDoc = await TargetPerson.findOne({ customId: targetCustomId });
      if (!targetDoc && targetName) {
        targetDoc = new TargetPerson({
          customId: targetCustomId,
          name: targetName,
          department: targetDepartment || '外部共有'
        });
        await targetDoc.save();
        console.log(`[外部連携] 新規対象者 [${targetCustomId}] ${targetName} を自動登録しました。`);
      }
    }

    const targetInfoStr = targetDoc 
      ? `[${targetDoc.customId}] ${targetDoc.name} (${targetDoc.department || '未設定'})`
      : (targetName ? `${targetName} (${targetCustomId || 'IDなし'})` : '全体/対象者指定なし');

    const scheduleDateObj = scheduledAt ? new Date(scheduledAt) : new Date();
    const scheduledTimeStr = scheduleDateObj.toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    const formattedContent = 
`【📥 受信点滴オーダー (外部システム連携)】
・開始日時: 🕒 ${scheduledTimeStr}
・送信元ホスト: ${senderHost || '未知の送信元'}
・オーダー送信者: ${senderUser || '外部システム'}
・対象者: ${targetInfoStr}
・薬剤名: ${medicine}
・投与量: ${dose || '規定量'}
・投与速度・時間: ${rate || '指示通り'}
・投与経路: ${route || '点滴静注'}
・指示・備考: ${remarks || 'なし'}`;

    const title = `📥 外部受信点滴: ${medicine} (${targetDoc ? targetDoc.name : '外部対象'})`;

    // システム用ユーザーの取得または登録
    let systemUser = await User.findOne({ loginId: 'remote_system' });
    if (!systemUser) {
      systemUser = new User({
        loginId: 'remote_system',
        userName: '🌐 外部連携システム',
        password: 'system_generated_password_2026',
        role: 'user',
        department: '外部連携'
      });
      await systemUser.save();
    }

    const nowTime = new Date();
    const pgpSig = signArticle({
      title,
      content: formattedContent,
      targetPersonId: targetDoc ? targetDoc._id.toString() : 'NONE',
      authorName: systemUser.userName,
      authorLoginId: systemUser.loginId,
      authorDept: systemUser.department || '外部連携',
      category: '💉 点滴オーダー (外部受信)',
      createdAt: nowTime
    });

    const receivedArticle = new Article({
      title,
      content: formattedContent,
      targetPerson: targetDoc ? targetDoc._id : null,
      author: systemUser._id,
      category: '💉 点滴オーダー (外部受信)',
      ivOrderDetails: {
        medicine,
        dose: dose || '',
        rate: rate || '',
        route: route || '',
        remarks: remarks || '',
        scheduledAt: scheduleDateObj
      },
      remoteSync: {
        isRemoteOrder: true,
        remoteHost: senderHost || '',
        syncStatus: 'RECEIVED',
        syncedAt: nowTime
      },
      pgpSignature: pgpSig,
      createdAt: nowTime
    });

    await receivedArticle.save();

    res.status(201).json({
      success: true,
      message: '点滴オーダーを正常に受信し記録しました。',
      articleId: receivedArticle._id
    });

  } catch (err) {
    console.error('点滴オーダー受信処理エラー:', err);
    res.status(500).json({ success: false, message: '受信処理エラー: ' + err.message });
  }
});

// 3. 別ホストへの接続疎通テスト API
router.post('/iv-orders/test-connection', async (req, res) => {
  try {
    const { targetUrl } = req.body;
    if (!targetUrl) {
      return res.status(400).json({ success: false, message: 'URLが指定されていません。' });
    }

    let url = targetUrl.trim();
    if (!url.endsWith('/api/iv-orders/receive')) {
      url = url.replace(/\/+$/, '') + '/api/iv-orders/receive';
    }

    const startTime = Date.now();
    // 疎通確認用テストペイロード（ping）
    const testPayload = {
      isTest: true,
      medicine: '疎通確認テスト薬剤 100ml',
      senderHost: req.protocol + '://' + req.get('host'),
      senderUser: '疎通テスト'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
      signal: AbortSignal.timeout(4000)
    });

    const duration = Date.now() - startTime;

    if (response.ok) {
      res.json({ success: true, message: `接続成功 (${duration}ms): 送信先ホストは正常に応答しています。`, status: response.status });
    } else {
      res.json({ success: false, message: `接続応答エラー HTTP ${response.status}: ${response.statusText}`, status: response.status });
    }
  } catch (err) {
    res.json({ success: false, message: `接続失敗: ${err.message}` });
  }
});

module.exports = router;
