const express = require('express');
const router = express.Router();
const Article = require('../models/Article');
const TargetPerson = require('../models/TargetPerson');
const User = require('../models/User');
const { signArticle } = require('../utils/pgpSigner');

// 外部・オーダリングシステムからの総合オーダー受信 API (POST /api/orders/receive)
router.post('/orders/receive', async (req, res) => {
  try {
    const data = req.body;
    console.log(`[カルテ連携] オーダー受信: [${data.orderId || '新規'}] 種別: ${data.orderType}, タイトル: ${data.title}`);

    // テスト疎通
    if (data.isTest) {
      return res.json({ success: true, isTest: true, message: '疎通テスト成功（カルテ記事には保存せずスキップ）' });
    }

    // 患者情報の取得・照合
    const pInfo = data.patient || {};
    const patientCustomId = pInfo.id || data.targetCustomId || data.patientId || '';
    const patientName = pInfo.name || data.targetName || data.patientName || '未指定患者';
    const patientDept = pInfo.department || data.targetDepartment || pInfo.ward || '一般病棟';

    let targetDoc = null;
    if (patientCustomId) {
      targetDoc = await TargetPerson.findOne({ customId: patientCustomId });
    }
    if (!targetDoc && patientName && patientName !== '未指定患者') {
      targetDoc = await TargetPerson.findOne({ name: patientName });
    }
    if (!targetDoc && (patientCustomId || patientName)) {
      targetDoc = new TargetPerson({
        customId: patientCustomId || `P-${Date.now().toString().slice(-4)}`,
        name: patientName,
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
・優先度: ${data.priority === 'STAT' ? '🚨 至急 (STAT)' : (data.priority === 'URGENT' ? '⚡ 急ぎ' : '通常')}
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
        scheduledAt: now
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
        scheduledAt: now
      };

    } else if (orderType === 'LAB_EXAM') {
      category = '🔬 検査オーダー';
      formattedContent = 
`【🔬 臨床検査指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-LAB'}
・検査項目: ${details.examItems || details.examType || data.title || '一般検体検査'}
・検体種別: ${details.sampleType || '血液・生化学'}
・至急度: ${data.priority === 'STAT' ? '🚨 至急検体' : '通常'}
・備考・臨床情報: ${details.remarks || '特記事項なし'}`;

    } else if (orderType === 'MEAL') {
      category = '🍱 食事選択オーダー';
      formattedContent = 
`【🍱 食事指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-MEAL'}
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
        scheduledAt: now
      };

    } else if (orderType === 'REHAB') {
      category = '🏃 リハビリ指示';
      formattedContent = 
`【🏃 リハビリテーション指示オーダー (オーダリングシステム連携)】
・指示日時: 🕒 ${orderDateStr}
・指示医: 👨‍⚕️ ${doctorName} 先生 (${doctorDept})
・対象患者: 👤 ${targetInfoStr}
・オーダーID: 🏷️ ${data.orderId || 'ORD-REHAB'}
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

module.exports = router;
