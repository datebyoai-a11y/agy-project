const express = require('express');
const router = express.Router();
const Article = require('../models/Article');
const TargetPerson = require('../models/TargetPerson');
const User = require('../models/User');
const { signArticle } = require('../utils/pgpSigner');

// 1. 放射線科オーダー作成 & 別ホストへ送信 API (内部用)
router.post('/radiology-orders', async (req, res) => {
  try {
    const {
      targetPersonId,
      examType,
      modality,
      contrast,
      portable,
      purpose,
      remarks,
      remoteHostUrl,
      scheduledAt
    } = req.body;

    if (!examType || !examType.trim()) {
      if (req.accepts('html')) {
        return res.send('<script>alert("検査種別・部位を入力してください。"); window.history.back();</script>');
      }
      return res.status(400).json({ success: false, message: '検査種別・部位は必須です。' });
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
`【🩻 放射線科検査指示オーダー】
・開始日時: 🕒 ${scheduledTimeStr}
・対象者: ${targetInfoStr}
・検査種別・部位: ${examType.trim()}
・モダリティ: ${modality ? modality.trim() : '一般撮影 (X-Ray)'}
・造影有無: ${contrast ? contrast.trim() : '単純 (造影なし)'}
・撮影場所: ${portable ? portable.trim() : '放射線科撮影室'}
・検査目的・臨床情報: ${purpose ? purpose.trim() : '経過観察・精査'}
・指示・注意事項: ${remarks ? remarks.trim() : '特記事項なし'}`;

    const title = `🩻 放射線指示: ${examType.trim()} (${targetDoc ? targetDoc.name : '全体'})`;

    const newArticle = new Article({
      title,
      content: formattedContent,
      targetPerson: targetDoc ? targetDoc._id : null,
      author: authorUser ? authorUser._id : null,
      category: '🩻 放射線科オーダー',
      radiologyOrderDetails: {
        examType: examType.trim(),
        modality: modality ? modality.trim() : 'X-Ray',
        contrast: contrast ? contrast.trim() : '単純',
        portable: portable ? portable.trim() : '撮影室',
        purpose: purpose ? purpose.trim() : '',
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

    // 🌐 別ホストへの送信処理
    if (remoteHostUrl && remoteHostUrl.trim() !== '') {
      let targetUrl = remoteHostUrl.trim();
      if (!targetUrl.endsWith('/api/radiology-orders/receive')) {
        targetUrl = targetUrl.replace(/\/+$/, '') + '/api/radiology-orders/receive';
      }

      const payload = {
        orderId: newArticle._id.toString(),
        targetCustomId: targetDoc ? targetDoc.customId : '',
        targetName: targetDoc ? targetDoc.name : '',
        targetDepartment: targetDoc ? targetDoc.department : '',
        scheduledAt: scheduleDateObj.toISOString(),
        examType: examType.trim(),
        modality: modality ? modality.trim() : '',
        contrast: contrast ? contrast.trim() : '',
        portable: portable ? portable.trim() : '',
        purpose: purpose ? purpose.trim() : '',
        remarks: remarks ? remarks.trim() : '',
        senderHost: req.protocol + '://' + req.get('host'),
        senderUser: authorNameStr,
        createdAt: newArticle.createdAt
      };

      try {
        console.log(`[別ホスト放射線オーダー送信] 送信先: ${targetUrl}`);
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
          console.log(`[別ホスト放射線オーダー送信成功]`, resData);
        } else {
          newArticle.remoteSync.syncStatus = 'FAILED';
          newArticle.remoteSync.errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
        }
      } catch (sendErr) {
        newArticle.remoteSync.syncStatus = 'FAILED';
        newArticle.remoteSync.errorMessage = `送信失敗: ${sendErr.message}`;
        console.error(`[別ホスト放射線オーダー送信例外]`, sendErr.message);
      }

      await newArticle.save();
    }

    if (req.accepts('html')) {
      const redirectUrl = targetDoc ? `/articles?targetId=${targetDoc._id}` : '/articles';
      return res.redirect(redirectUrl);
    }
    res.status(201).json({ success: true, message: '放射線科オーダーを発行しました。', article: newArticle });

  } catch (err) {
    console.error('放射線科オーダー登録エラー:', err);
    res.status(500).send('放射線科オーダー登録エラー: ' + err.message);
  }
});

// 2. 外部ホストからの放射線科オーダー受信 API (公開・認証不要エンドポイント)
router.post('/radiology-orders/receive', async (req, res) => {
  try {
    const {
      isTest,
      targetCustomId,
      targetName,
      targetDepartment,
      scheduledAt,
      examType,
      modality,
      contrast,
      portable,
      purpose,
      remarks,
      senderHost,
      senderUser
    } = req.body;

    console.log(`[外部放射線オーダー受信] 送信元: ${senderHost || '未知ホスト'}, 担当: ${senderUser || '不明'}, 検査: ${examType}, テストフラグ: ${isTest}`);

    // 💡 疎通テストの場合は記事として保存せず、テスト成功応答を返して捨てる
    if (isTest) {
      console.log(`[疎通テスト受信] 送信元: ${senderHost} からの放射線オーダー接続テストを確認。記事には保存せず捨てます。`);
      return res.json({
        success: true,
        isTest: true,
        message: '疎通テスト成功：送信先ホストは正常に応答しました（記事には保存せずスキップしました）。'
      });
    }

    if (!examType) {
      return res.status(400).json({ success: false, message: '検査種別・部位データが必要です。' });
    }

    // 対象者の照合
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
`【🩻 受信放射線科検査オーダー (外部システム連携)】
・開始日時: 🕒 ${scheduledTimeStr}
・送信元ホスト: ${senderHost || '未知の送信元'}
・オーダー送信者: ${senderUser || '外部システム'}
・対象者: ${targetInfoStr}
・検査種別・部位: ${examType}
・モダリティ: ${modality || '一般撮影'}
・造影有無: ${contrast || '単純'}
・撮影場所: ${portable || '撮影室'}
・検査目的・臨床情報: ${purpose || 'なし'}
・指示・注意事項: ${remarks || 'なし'}`;

    const title = `🩻 外部受信放射線: ${examType} (${targetDoc ? targetDoc.name : '外部対象'})`;

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
      category: '🩻 放射線科オーダー (外部受信)',
      createdAt: nowTime
    });

    const receivedArticle = new Article({
      title,
      content: formattedContent,
      targetPerson: targetDoc ? targetDoc._id : null,
      author: systemUser._id,
      category: '🩻 放射線科オーダー (外部受信)',
      radiologyOrderDetails: {
        examType,
        modality: modality || '',
        contrast: contrast || '',
        portable: portable || '',
        purpose: purpose || '',
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
      message: '放射線科オーダーを正常に受信し記録しました。',
      articleId: receivedArticle._id
    });

  } catch (err) {
    console.error('放射線科オーダー受信処理エラー:', err);
    res.status(500).json({ success: false, message: '受信処理エラー: ' + err.message });
  }
});

// 3. 放射線科オーダー用接続疎通テスト API (記事保存なしでテスト確認)
router.post('/radiology-orders/test-connection', async (req, res) => {
  try {
    const { targetUrl } = req.body;
    if (!targetUrl) {
      return res.status(400).json({ success: false, message: 'URLが指定されていません。' });
    }

    let url = targetUrl.trim();
    if (!url.endsWith('/api/radiology-orders/receive')) {
      url = url.replace(/\/+$/, '') + '/api/radiology-orders/receive';
    }

    const startTime = Date.now();
    const testPayload = {
      isTest: true,
      examType: '疎通確認テスト（胸部レントゲン）',
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
      const resData = await response.json();
      res.json({ success: true, message: `接続成功 (${duration}ms): ${resData.message || '送信先ホストは正常に応答しています。'}`, status: response.status });
    } else {
      res.json({ success: false, message: `接続応答エラー HTTP ${response.status}: ${response.statusText}`, status: response.status });
    }
  } catch (err) {
    res.json({ success: false, message: `接続失敗: ${err.message}` });
  }
});

module.exports = router;
