const express = require('express');
const router = express.Router();
const Article = require('../models/Article');
const TargetPerson = require('../models/TargetPerson');
const Patient = require('../models/Patient');
const User = require('../models/User');
const { signArticle } = require('../utils/pgpSigner');

const mongoose = require('mongoose');

// 患者マスタ一覧取得 API (MongoDB Patient から集中管理取得 & オーダリング送信側等との完全同期用)
router.get('/orders/patients', async (req, res) => {
  try {
    const patients = await Patient.find().sort({ patientId: 1 });
    if (patients && patients.length > 0) {
      return res.json({
        success: true,
        count: patients.length,
        source: 'mongodb_patient_master',
        patients: patients.map(p => ({
          id: p.patientId,
          patientId: p.patientId,
          _id: p._id.toString(),
          name: p.name,
          kana: p.kana || '',
          birthDate: p.birthDate || '',
          age: p.age !== null ? p.age : 65,
          gender: p.gender || '男',
          department: p.department || '内科',
          ward: p.ward || '外来',
          room: p.room || '',
          infection: p.infection || '無',
          mobility: p.mobility || '徒歩',
          height: p.height,
          weight: p.weight,
          bloodType: p.bloodType || '不明',
          allergies: p.allergies || 'なし',
          keyPersonName: p.keyPersonName || '',
          keyPersonPhone: p.keyPersonPhone || '',
          keyPersonRelation: p.keyPersonRelation || '',
          keyPersonNotes: p.keyPersonNotes || '',
          notes: p.notes || '',
          memo: p.memo || ''
        }))
      });
    }

    const targets = await TargetPerson.find().sort({ customId: 1 });
    res.json({
      success: true,
      count: targets.length,
      source: 'mongodb_target_people',
      patients: targets.map(t => ({
        id: t.customId,
        patientId: t.customId,
        _id: t._id.toString(),
        name: t.name,
        department: t.department || '',
        ward: t.ward || '一般病棟',
        room: t.room || '',
        age: t.age || 65,
        gender: t.gender || '男'
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: '患者一覧取得エラー: ' + err.message });
  }
});

// 外部・オーダリングシステムからの総合オーダー受信 API (POST /api/orders/receive)
router.post('/orders/receive', async (req, res) => {
  try {
    const data = req.body;
    console.log(`[カルテ連携] オーダー受信: [${data.orderId || '新規'}] 種別: ${data.orderType}, タイトル: ${data.title}`);

    // テスト疎通
    if (data.isTest) {
      return res.json({ success: true, isTest: true, message: '疎通テスト成功（カルテ記事には保存せずスキップ）' });
    }

    // 患者情報の取得・柔軟照合
    const pInfo = data.patient || {};
    const patientCustomId = String(pInfo.id || data.targetCustomId || data.patientId || '').trim();
    const patientName = String(pInfo.name || data.targetName || data.patientName || '未指定患者').trim();
    const patientDept = String(pInfo.department || data.targetDepartment || pInfo.ward || '一般病棟').trim();

    let targetDoc = null;

    // 1. customId による照合
    if (patientCustomId) {
      targetDoc = await TargetPerson.findOne({ customId: patientCustomId });
      // ObjectId 形式の場合の照合
      if (!targetDoc && mongoose.Types.ObjectId.isValid(patientCustomId)) {
        targetDoc = await TargetPerson.findById(patientCustomId);
      }
    }

    // 2. 氏名による柔軟照合 (空白・全角半角の差異を吸収)
    if (!targetDoc && patientName && patientName !== '未指定患者') {
      targetDoc = await TargetPerson.findOne({ name: patientName });
      if (!targetDoc) {
        const allTargets = await TargetPerson.find({});
        const normInput = patientName.replace(/[\s\u3000]+/g, '').toLowerCase();
        targetDoc = allTargets.find(t => t.name.replace(/[\s\u3000]+/g, '').toLowerCase() === normInput);
      }
    }

    // 3. 存在しない場合の新規患者登録 (customIdの重複競合を自動回避)
    if (!targetDoc && (patientCustomId || (patientName && patientName !== '未指定患者'))) {
      let finalCustomId = patientCustomId || `P-${Date.now().toString().slice(-4)}`;
      const idExists = await TargetPerson.findOne({ customId: finalCustomId });
      if (idExists) {
        finalCustomId = `${finalCustomId}-${Date.now().toString().slice(-4)}`;
      }

      targetDoc = new TargetPerson({
        customId: finalCustomId,
        name: patientName || 'カルテ連携患者',
        department: patientDept,
        ward: pInfo.ward || 'しおかぜ',
        room: pInfo.room || ''
      });
      await targetDoc.save();
      console.log(`[カルテ連携] 新規対象者自動登録: [${targetDoc.customId}] ${targetDoc.name}`);
    }

    const targetInfoStr = targetDoc
      ? `[${targetDoc.customId}] ${targetDoc.name} (${targetDoc.department || '未設定'})`
      : `${patientName} (${patientCustomId || 'IDなし'})`;

    const docInfo = data.doctor || {};
    const doctorName = docInfo.name || data.senderUser || data.doctorName || '担当医';
    const doctorDept = docInfo.department || data.doctorDept || '診療科';

    const orderType = (data.orderType || 'GENERAL').toUpperCase();
    const details = data.details || {};
    const now = new Date();
    const orderDateStr = data.orderDate || details.orderDate || now.toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    // 優先度および実施予定日時の統一フォーマット
    const rawPriority = data.priority || details.priority || 'ROUTINE';
    const priorityText = rawPriority === 'STAT'
      ? '🚨 至急 (STAT)'
      : (rawPriority === 'URGENT' ? '⚡ 急ぎ (URGENT)' : '通常 (ROUTINE)');

    const rawScheduledAt = details.scheduledAt || details.startDate || data.orderDate || details.orderDate;
    let scheduledAtDate = now;
    let scheduledAtStr = '指示通り即時実施';
    if (rawScheduledAt) {
      const d = new Date(rawScheduledAt);
      if (!isNaN(d.getTime())) {
        scheduledAtDate = d;
        scheduledAtStr = d.toLocaleString('ja-JP', {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
      } else {
        scheduledAtStr = String(rawScheduledAt);
      }
    }

    let category = '📋 オーダー記録';
    let formattedContent = '';
    let ivOrderObj = null;
    let mealOrderObj = null;
    let radOrderObj = null;

    if (orderType === 'IV') {
      category = '💉 点滴オーダー';
      const medList = details.medicines || [];
      const medLines = medList.length > 0
        ? medList.map((m, idx) => `  (${idx + 1}) ${m.medicine || m.name || ''} : ${m.dose || m.dosage || '指示量'} [${m.route || details.route || '点滴静注'}] (${m.timing || m.rate || details.rate || '指示速度'})`).join('\n')
        : `  ・薬剤: ${details.medicine || data.title || '指定なし'} (量: ${details.dose || '規定量'}, 速度: ${details.rate || '指示通り'}, 経路: ${details.route || '点滴静注'})`;

      formattedContent = 
`【💉 点滴・注射指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-IV'}
・優先度: ${priorityText}
・実施予定日時: 📅 ${scheduledAtStr}
・指示内容（薬剤・輸液）:
${medLines}
・投与経路: ${details.route || '点滴静注'}
・投与速度・時間: ${details.rate || '指示通り'}
・備考・特記事項: ${details.remarks || details.instruction || 'なし'}`;

      ivOrderObj = {
        medicine: details.medicine || (medList[0] ? medList[0].medicine : '点滴輸液'),
        dose: details.dose || (medList[0] ? medList[0].dose : ''),
        rate: details.rate || '',
        route: details.route || '点滴静注',
        remarks: details.remarks || '',
        scheduledAt: scheduledAtDate
      };

    } else if (orderType === 'PRESCRIPTION') {
      category = '💊 処方オーダー';
      const medList = details.medicines || [];
      const medLines = medList.length > 0
        ? medList.map((m, idx) => `  Rp${idx + 1}: ${m.medicine || m.name} ${m.dose || m.dosage || ''} ${m.instruction || ''} (${m.days || 7}日分)`).join('\n')
        : `  Rp1: ${details.medicine || data.title || '指定薬品'} ${details.dose || ''} (${details.days || 7}日分)`;

      formattedContent = 
`【💊 処方指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-RX'}
・優先度: ${priorityText}
・実施予定日時: 📅 ${scheduledAtStr}
・処方内容:
${medLines}
・用法・指示: ${details.timing || details.instruction || '指示通り'}
・備考・禁忌確認: ${details.remarks || '相互作用・重複投薬確認済み'}`;

    } else if (orderType === 'RADIOLOGY') {
      category = '🩻 放射線科オーダー';
      formattedContent = 
`【🩻 放射線科検査指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-RAD'}
・優先度: ${priorityText}
・実施予定日時: 📅 ${scheduledAtStr}
・検査種別・部位: ${details.examType || details.bodyPart || data.title || '一般撮影'}
・モダリティ: ${details.modality || '一般撮影 (X-Ray)'}
・造影有無: ${details.contrast || '単純 (造影なし)'}
・撮影場所: ${details.portable || details.location || '放射線科撮影室'}
・目的・臨床所見: ${details.purpose || details.clinicalInfo || '精査・経過観察'}
・注意事項・備考: ${details.remarks || '特記事項なし'}`;

      radOrderObj = {
        examType: details.examType || data.title || '胸部X線',
        modality: details.modality || 'X-Ray',
        contrast: details.contrast || '単純',
        portable: details.portable || '撮影室',
        purpose: details.purpose || '',
        remarks: details.remarks || '',
        scheduledAt: scheduledAtDate
      };

    } else if (orderType === 'LAB_EXAM') {
      category = '🔬 検査オーダー';
      formattedContent = 
`【🔬 臨床検査指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-LAB'}
・優先度: ${priorityText}
・実施予定日時: 📅 ${scheduledAtStr}
・検査項目: ${details.examItems || details.examType || data.title || '一般検体検査'}
・検体種別: ${details.sampleType || '血液・生化学'}
・備考・臨床情報: ${details.remarks || '特記事項なし'}`;

    } else if (orderType === 'MEAL') {
      category = '🍱 食事選択オーダー';
      formattedContent = 
`【🍱 食事指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-MEAL'}
・優先度: ${priorityText}
・実施予定日時: 📅 ${scheduledAtStr}
・食種・形態: ${details.mealType || '常食 (一般食)'}
・主食/副食: ${details.stapleFood || '米飯'} / ${details.sideDish || '普通菜'}
・アレルギー・禁止食: ${details.allergies || 'なし'}
・備考: ${details.remarks || '栄養科へオーダー伝達完了'}`;

      mealOrderObj = {
        mealType: details.mealType || '常食',
        timing: details.timing || '毎食',
        stapleFood: details.stapleFood || '',
        sideDish: details.sideDish || '',
        allergies: details.allergies || '',
        remarks: details.remarks || '',
        scheduledAt: scheduledAtDate
      };

    } else if (orderType === 'REHAB') {
      category = '🏃 リハビリ指示';
      formattedContent = 
`【🏃 リハビリテーション指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-REHAB'}
・優先度: ${priorityText}
・実施予定日時: 📅 ${scheduledAtStr}
・指示区分: ${details.rehabType || '理学療法 (PT) / 作業療法 (OT)'}
・運動負荷・リスク管理: ${details.riskCondition || 'バイタル確認後実施'}
・リハビリ目的・目標: ${details.purpose || '日常生活動作(ADL)向上・歩行訓練'}
・備考: ${details.remarks || '特記事項なし'}`;

    } else {
      category = '📋 一般オーダー';
      formattedContent = 
`【📋 オーダリング指示記録 (${orderType})】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-GEN'}
・優先度: ${priorityText}
・実施予定日時: 📅 ${scheduledAtStr}
・内容: ${data.title || '指示内容'}
・詳細: ${JSON.stringify(details, null, 2)}`;
    }

    const title = data.title || `${category}: ${data.orderId || 'ORD'} (${targetDoc ? targetDoc.name : patientName})`;

    // システムユーザーまたは担当医ユーザーを取得
    let authorUser = await User.findOne({ userName: doctorName });
    if (!authorUser) {
      authorUser = await User.findOne({ loginId: 'ordering_system' });
    }
    if (!authorUser) {
      authorUser = await User.findOne({ role: 'admin' }) || await User.findOne();
    }

    // PGP 電子署名を生成
    const pgpSig = signArticle({
      title,
      content: formattedContent,
      targetPersonId: targetDoc ? targetDoc._id.toString() : 'NONE',
      authorName: doctorName,
      authorLoginId: authorUser ? authorUser.loginId : 'ordering_sys',
      authorDept: doctorDept,
      category,
      createdAt: now
    });

    const newArticle = new Article({
      title,
      content: formattedContent,
      targetPerson: targetDoc ? targetDoc._id : null,
      author: authorUser ? authorUser._id : null,
      category,
      ivOrderDetails: ivOrderObj,
      mealOrderDetails: mealOrderObj,
      radiologyOrderDetails: radOrderObj,
      remoteSync: {
        isRemoteOrder: true,
        remoteHost: data.senderHost || 'http://localhost:4000',
        syncStatus: 'SUCCESS',
        syncedAt: now
      },
      pgpSignature: pgpSig,
      createdAt: now
    });

    await newArticle.save();
    console.log(`✅ [カルテ連携] カルテ記事作成・保存完了: [${newArticle._id}] ${title}`);

    res.status(201).json({
      success: true,
      message: 'オーダリング指示をカルテ記事として正常に保存しました',
      articleId: newArticle._id,
      title: newArticle.title,
      category: newArticle.category,
      targetPersonId: targetDoc ? targetDoc._id : null
    });

  } catch (err) {
    console.error('❌ [カルテ連携] オーダー受信・保存エラー:', err);
    res.status(500).json({ success: false, error: 'カルテ記事保存処理エラー: ' + err.message });
  }
});

// =========================================================================
// 🌟 部門実施ステータス連動ヘルパー (未撮影/未調剤 -> 撮影実施済/調剤済 への自動連動)
// =========================================================================
async function processOrderStatusUpdate(orderId, status, actor, note, updatedAt) {
  if (!orderId) return null;
  const now = updatedAt ? new Date(updatedAt) : new Date();

  // 1. 対象記事の検索
  let article = null;
  if (mongoose.Types.ObjectId.isValid(orderId)) {
    article = await Article.findById(orderId);
  }
  if (!article) {
    // タイトルまたは本文中のオーダーIDで照合
    article = await Article.findOne({
      $or: [
        { content: new RegExp(orderId, 'i') },
        { title: new RegExp(orderId, 'i') }
      ]
    });
  }

  if (!article) {
    console.log(`[カルテ連動] オーダー [${orderId}] に合致するカルテ記事が見つかりません`);
    return null;
  }

  // 2. 記事のステータス更新
  const executionInfo = {
    status,
    actor: actor || '部門担当者',
    note: note || '',
    completedAt: now
  };

  await Article.updateOne(
    { _id: article._id },
    {
      $set: {
        orderStatus: status,
        orderExecution: executionInfo,
        'remoteSync.syncStatus': status
      }
    }
  );
  console.log(`✅ [カルテ連動] 記事 [${article._id}] のステータスを更新: -> ${status}`);

  // 3. COMPLETED（実施完了）の場合、対になる実施確認子記事（ぶら下がり記事）を作成（未作成の場合）
  if (status === 'COMPLETED') {
    const existingChild = await Article.findOne({ parentArticle: article._id });
    if (!existingChild) {
      const isRadiology = (article.category && (article.category.includes('放射線') || article.category.includes('レントゲン') || article.category.includes('CT') || article.category.includes('MRI')))
        || (article.title && (article.title.includes('放射線') || article.title.includes('ポータブル') || article.title.includes('撮影')));
      const isPrescription = (article.category && (article.category.includes('処方') || article.category.includes('点滴')))
        || (article.title && (article.title.includes('処方') || article.title.includes('点滴')));

      let childCategory = '📋 実施確認';
      let childTitle = `【実施完了】${article.title.replace(/^【[^】]+】/, '')}`;
      let childContent = '';
      let authorDept = '部門担当';
      let authorName = actor || '部門担当者';

      const nowDateStr = now.toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      });

      if (isRadiology) {
        childCategory = '放射線検査実施';
        childTitle = `【放射線技師 撮影実施確認】${article.title.replace(/^【[^】]+】/, '')}`;
        authorDept = '放射線科';
        authorName = actor || '放射線技師';
        childContent = 
`【🩻 放射線技師 撮影実施・照射完了記録 (部門連携)】
・対象オーダー: ${article.title}
・オーダーID: 🏷️ ${orderId}
・撮影完了時刻: 🕒 ${nowDateStr}
・担当技師: 👤 ${authorName} (放射線科)
・撮影状況: 撮影完了・画像検像およびPACS送信終了
・特記事項・備考: ${note || '部門モニターより実施完了通知を受信'}`;

      } else if (isPrescription) {
        childCategory = '処方鑑査・調剤';
        childTitle = `【処方鑑査・調剤完了】${article.title.replace(/^【[^】]+】/, '')}`;
        authorDept = '薬剤部';
        authorName = actor || '薬剤師';
        childContent = 
`【💊 薬剤部 処方鑑査・調剤完了記録 (部門連携)】
・対象オーダー: ${article.title}
・オーダーID: 🏷️ ${orderId}
・調剤完了時刻: 🕒 ${nowDateStr}
・担当薬剤師: 👤 ${authorName} (薬剤部)
・調剤状況: 処方鑑査OK・ピッキング完了・病棟出庫済
・特記事項・備考: ${note || '部門モニターより調剤完了通知を受信'}`;

      } else {
        childCategory = '実施完了記録';
        childTitle = `【部門実施完了】${article.title.replace(/^【[^】]+】/, '')}`;
        childContent = 
`【📋 部門オーダー実施完了記録 (部門連携)】
・対象オーダー: ${article.title}
・オーダーID: 🏷️ ${orderId}
・実施完了時刻: 🕒 ${nowDateStr}
・担当者: 👤 ${authorName} (${authorDept})
・実施状況: 指示通り実施完了
・特記事項・備考: ${note || '部門モニターより実施完了通知を受信'}`;
      }

      // システムユーザーまたは担当者
      let authorUser = await User.findOne({ userName: authorName });
      if (!authorUser) authorUser = await User.findOne({ department: authorDept });
      if (!authorUser) authorUser = await User.findOne({ role: 'admin' }) || await User.findOne();

      const pgpSig = signArticle({
        title: childTitle,
        content: childContent,
        targetPersonId: article.targetPerson ? article.targetPerson.toString() : 'NONE',
        authorName: authorName,
        authorLoginId: authorUser ? authorUser.loginId : 'dept_actor',
        authorDept: authorDept,
        category: childCategory,
        createdAt: now
      });

      const childArticle = new Article({
        title: childTitle,
        content: childContent,
        targetPerson: article.targetPerson,
        author: authorUser ? authorUser._id : null,
        category: childCategory,
        parentArticle: article._id,
        isCorrection: true,
        orderStatus: 'COMPLETED',
        orderExecution: executionInfo,
        remoteSync: {
          isRemoteOrder: true,
          remoteHost: 'http://localhost:5000',
          syncStatus: 'COMPLETED',
          syncedAt: now
        },
        pgpSignature: pgpSig,
        createdAt: now
      });

      await childArticle.save();
      console.log(`✅ [カルテ連動] 実施確認子記事を自動生成・保存完了: [${childArticle._id}] ${childTitle}`);
    }
  }

  return { articleId: article._id, title: article.title, status };
}

// 4. 部門からのステータス通知コールバック受信 API (POST /api/orders/:id/status-callback)
router.post('/orders/:id/status-callback', async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status, actor, note, updatedAt } = req.body;
    console.log(`\n🔔 [カルテ連携] ステータス更新コールバック受信: [${orderId}] -> ${status} (${actor || '担当者'})`);

    const result = await processOrderStatusUpdate(orderId, status, actor, note, updatedAt);
    if (!result) {
      return res.status(404).json({ success: false, error: '対象のカルテ記事が見つかりません: ' + orderId });
    }

    res.json({
      success: true,
      message: 'カルテ記事のステータスを連動更新しました',
      ...result
    });
  } catch (err) {
    console.error('❌ [カルテ連携] ステータス更新コールバックエラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. 部門からのステータス更新 API (POST /api/orders/:id/status)
router.post('/orders/:id/status', async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status, actor, note, updatedAt } = req.body;
    console.log(`\n⚙️ [カルテ連携] 直接ステータス更新要求: [${orderId}] -> ${status} (${actor || '担当者'})`);

    const result = await processOrderStatusUpdate(orderId, status, actor, note, updatedAt);
    if (!result) {
      return res.status(404).json({ success: false, error: '対象のカルテ記事が見つかりません: ' + orderId });
    }

    res.json({
      success: true,
      message: 'カルテ記事のステータスを連動更新しました',
      ...result
    });
  } catch (err) {
    console.error('❌ [カルテ連携] ステータス更新エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. 受信側（Port 5000）の全オーダーからのステータス一括連動・同期 API (GET /api/orders/sync-from-receiver)
router.get('/orders/sync-from-receiver', async (req, res) => {
  try {
    const receiverUrl = process.env.ORDER_RECEIVER_URL || 'http://localhost:5000';
    console.log(`\n🔄 [カルテ連携] 受信側 (${receiverUrl}) から全オーダーステータス一括同期を開始...`);

    const fetchRes = await fetch(`${receiverUrl}/api/orders`, { signal: AbortSignal.timeout(5000) });
    if (!fetchRes.ok) {
      return res.status(502).json({ success: false, error: '受信側APIに接続できませんでした: HTTP ' + fetchRes.status });
    }

    const data = await fetchRes.json();
    const orders = data.orders || [];
    let syncedCount = 0;

    for (const ord of orders) {
      if (ord.orderId && ord.status) {
        const lastHist = (ord.executionHistory && ord.executionHistory.length > 0)
          ? ord.executionHistory[ord.executionHistory.length - 1]
          : null;
        const actor = lastHist ? lastHist.actor : '部門担当者';
        const note = lastHist ? lastHist.note : '';
        const updatedAt = lastHist ? lastHist.timestamp : ord.receivedAt;

        const updated = await processOrderStatusUpdate(ord.orderId, ord.status, actor, note, updatedAt);
        if (updated) syncedCount++;
      }
    }

    console.log(`✅ [カルテ連携] 一括同期完了: ${syncedCount} 件の記事ステータスを連動更新しました`);
    res.json({
      success: true,
      message: `受信側の ${orders.length} 件中、${syncedCount} 件のカルテ記事ステータスを連動更新しました`,
      totalOrders: orders.length,
      syncedCount
    });
  } catch (err) {
    console.error('❌ [カルテ連携] 一括同期エラー:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
