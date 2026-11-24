'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const rehabOrderRepository = require('../repositories/rehabOrderRepository');
const {
  PATIENT_CATEGORIES,
  getDepartmentByCode,
  isCareFacilityCode,
  getSwitchableMenus
} = require('../config/constants');
const { formatActorForRecord, buildElevationMeta } = require('../utils/actorHelper');

const router = express.Router();

const CATEGORY_LABEL_MAP = Object.fromEntries(PATIENT_CATEGORIES.map((c) => [c.code, c.name]));

const REHAB_OPTIONS = {
  categories: ['運動器', '脳血管疾患等', '廃用症候群', '呼吸器', '心大血管', '介護リハ'],
  frequencies: ['週5回', '週3回', '週2回', '週1回', '毎日'],
  units: ['1単位(20分)', '2単位(40分)', '3単位(60分)', '4単位(80分)'],
  durations: ['1ヶ月間', '3ヶ月間', '6ヶ月間', '退院まで'],
  locations: ['病棟内', 'リハ室', '病棟内・リハ室', '居室・フロア'],
  risks: [
    '循環器系異常（血圧変動・不整脈）',
    '呼吸不全（SpO2低値）',
    '薬剤影響（降圧・利尿・糖尿病薬）',
    '人工関節',
    '認知症・指示理解低下',
    '転倒リスク',
    '誤嚥リスク'
  ],
  ptItems: [
    '関節可動域訓練（ROM）',
    '筋力・体力増強',
    '神経筋促通',
    'バランス訓練',
    '基本動作（起居・立位）',
    '移乗動作',
    '歩行能力向上',
    'ADL改善',
    '車いす操作練習'
  ],
  otItems: [
    'ROM・筋力維持',
    '座位・立位保持訓練',
    '食事動作訓練',
    '更衣・整容・入浴動作',
    '排泄動作指導',
    '高次脳・注意・記憶・遂行訓練',
    'レクリエーション活動',
    '生活環境調整・福祉用具選定'
  ],
  stItems: [
    '嚥下造影検査（VF）',
    '嚥下・食事場面支援',
    '食事姿勢調整',
    '食形態評価',
    '食事介助指導',
    '誤嚥リスク観察',
    '構音障害改善',
    '失語症改善',
    'サクション・口腔ケア'
  ],
  evalItems: [
    '認知症評価（HDS-R・MMSE）',
    '6分間歩行テスト（6MD）',
    '筋力・ROM・ADL評価',
    'マッサージ',
    'ホットパック',
    'SSP・マイクロ波',
    'メドマー',
    '牽引'
  ]
};

function buildStatusBarPatient(patient) {
  if (!patient) return null;
  return {
    id: `${patient.patientId} ${patient.fullName}`,
    birthDate: patient.birthDate || '----/--/--',
    age: patient.age != null ? patient.age : '--',
    allergies: patient.allergies || '',
    cautions: patient.cautions || ''
  };
}

function normalizeStringArray(raw) {
  return Array.isArray(raw) ? raw.map((v) => String(v).trim()).filter(Boolean) : [];
}

/**
 * リハビリ指示画面 (GET /rehab)
 */
router.get('/rehab', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const isEmbed = req.query.embed === '1' || req.query.embed === 'true';

    const allPatients = await patientRepository.findAll();
    const activePatients = allPatients
      .filter((p) => p.isActive)
      .map((p) => ({
        ...p,
        careCategoryName: CATEGORY_LABEL_MAP[p.careCategory] || p.careCategory
      }));

    const hasPatientParam = Object.prototype.hasOwnProperty.call(req.query, 'patientId');
    let selectedPatient = null;
    if (hasPatientParam) {
      const pid = String(req.query.patientId || '').trim();
      if (pid) {
        selectedPatient = activePatients.find((p) => p.patientId === pid) || null;
        req.session.selectedPatient = selectedPatient;
      } else {
        req.session.selectedPatient = null;
      }
    } else if (req.session.selectedPatient) {
      selectedPatient =
        activePatients.find((p) => p.patientId === req.session.selectedPatient.patientId) ||
        req.session.selectedPatient;
    }

    const careDeptObj = isCareFacilityCode(sessionUser.departmentCode)
      ? getDepartmentByCode(sessionUser.departmentCode)
      : null;
    const fallbackWard = careDeptObj
      ? careDeptObj.name
      : sessionUser.departmentCode === 'outpatient'
        ? '外来'
        : '医療病棟';
    const initialWard =
      (selectedPatient && selectedPatient.careCategoryName) ||
      String(req.query.ward || '').trim() ||
      fallbackWard;
    const sourceDept = String(req.query.sourceDept || sessionUser.departmentCode || '').trim();
    const reviseOrderNumber = String(req.query.revise || '').trim();

    const pastOrders = isEmbed
      ? []
      : selectedPatient
        ? await rehabOrderRepository.findByPatientId(selectedPatient.patientId)
        : await rehabOrderRepository.findAll({ includeInactive: true });

    res.render('rehabOrder', {
      statusBar: {
        screenTitle: 'リハビリ指示',
        patient: buildStatusBarPatient(selectedPatient),
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      rehabOptions: REHAB_OPTIONS,
      patients: activePatients,
      selectedPatient,
      pastOrders,
      user: sessionUser,
      isEmbed,
      initialWard,
      sourceDept,
      reviseOrderNumber
    });
  } catch (err) {
    next(err);
  }
});

/**
 * リハビリ指示 印刷ビュー (GET /rehab/print/:orderNumber)
 */
router.get('/rehab/print/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await rehabOrderRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).send('指定されたリハビリ指示が見つかりません。');
    }
    res.render('rehabPrint', {
      order,
      autoPrint: req.query.autoprint === '1'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: リハビリ指示一覧 (GET /api/rehab)
 */
router.get('/api/rehab', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.query.patientId || '').trim();
    const includeInactive = req.query.includeInactive !== 'false';

    let rehabs;
    if (patientId) {
      rehabs = await rehabOrderRepository.findByPatientId(patientId);
      if (!includeInactive) {
        rehabs = rehabs.filter((r) => !r.isCancelled && !r.isSuperseded);
      }
    } else {
      rehabs = await rehabOrderRepository.findAll({ includeInactive });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, count: rehabs.length, rehabs });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 単一リハビリ指示取得 (GET /api/rehab/:orderNumber)
 */
router.get('/api/rehab/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await rehabOrderRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).json({ ok: false, error: '対象リハビリ指示が見つかりません。' });
    }
    return res.json({ ok: true, rehab: order });
  } catch (err) {
    next(err);
  }
});

/**
 * API: リハビリ指示発行 / 訂正再発行 (POST /api/rehab)
 */
router.post('/api/rehab', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const patientId = String(req.body.patientId || '').trim();
    const patientName = String(req.body.patientName || '').trim();
    if (!patientId || !patientName) {
      return res.status(400).json({ ok: false, error: '対象患者（ID・氏名）を選択または入力してください。' });
    }

    const diagnosisName = String(req.body.diagnosisName || '').trim();
    if (!diagnosisName) {
      return res.status(400).json({ ok: false, error: '診断名・算定病名を入力してください。' });
    }

    const ptItems = normalizeStringArray(req.body.ptItems);
    const otItems = normalizeStringArray(req.body.otItems);
    const stItems = normalizeStringArray(req.body.stItems);
    const evalItems = normalizeStringArray(req.body.evalItems);
    if (ptItems.length + otItems.length + stItems.length + evalItems.length === 0) {
      return res.status(400).json({ ok: false, error: '訓練・評価内容（PT/OT/ST/評価）を1つ以上選択してください。' });
    }

    const parsedAge =
      req.body.age !== '' && req.body.age != null && !Number.isNaN(Number(req.body.age))
        ? Number(req.body.age)
        : null;

    const record = {
      order_date: String(req.body.orderDate || '').trim() || new Date().toISOString().slice(0, 10),
      onset_date: String(req.body.onsetDate || '').trim(),
      patient_id: patientId,
      patient_name: patientName,
      patient_kana: String(req.body.patientKana || '').trim(),
      gender: String(req.body.gender || '不明').trim(),
      age: parsedAge,
      birth_date: String(req.body.birthDate || '').trim(),
      ward: String(req.body.ward || '医療病棟').trim(),
      room: String(req.body.room || '').trim(),
      source_department: String(req.body.sourceDepartment || sessionUser.departmentCode || '').trim(),
      doctor_name: formatActorForRecord(sessionUser, req.body.doctorName),
      ordered_by_staff_id: sessionUser.staffId,
      ...buildElevationMeta(sessionUser),
      rehab_category: String(req.body.rehabCategory || '運動器').trim(),
      diagnosis_name: diagnosisName,
      frequency_per_week: String(req.body.frequencyPerWeek || '週3回').trim(),
      units_per_day: String(req.body.unitsPerDay || '2単位(40分)').trim(),
      duration_months: String(req.body.durationMonths || '3ヶ月間').trim(),
      location: String(req.body.location || '病棟内').trim(),
      risks: normalizeStringArray(req.body.risks),
      oxygen_flow: String(req.body.oxygenFlow || '').trim(),
      contraindications: String(req.body.contraindications || '').trim(),
      necessity_reason: String(req.body.necessityReason || '').trim(),
      pt_items: ptItems,
      ot_items: otItems,
      st_items: stItems,
      eval_items: evalItems,
      remarks: String(req.body.remarks || '').trim()
    };

    const parentOrderNumber = String(req.body.parentOrderNumber || '').trim();
    const revisionNote = String(req.body.revisionNote || '').trim();

    let saved;
    if (parentOrderNumber) {
      const parent = await rehabOrderRepository.findByOrderNumber(parentOrderNumber);
      if (!parent) {
        return res.status(404).json({ ok: false, error: '訂正元のリハビリ指示が見つかりません。' });
      }
      saved = await rehabOrderRepository.supersedeAndAppend(
        parentOrderNumber,
        record,
        formatActorForRecord(sessionUser),
        revisionNote
      );
    } else {
      saved = await rehabOrderRepository.createRehabOrder(record);
    }

    const patient = await patientRepository.findByPatientId(saved.patientId);
    if (patient) {
      req.session.selectedPatient = {
        ...patient,
        careCategoryName: CATEGORY_LABEL_MAP[patient.careCategory] || patient.careCategory
      };
    }

    return res.status(201).json({ ok: true, rehab: saved });
  } catch (err) {
    next(err);
  }
});

/**
 * API: リハビリ指示中止フラグ設定（物理削除禁止） (POST /api/rehab/:orderNumber/cancel)
 */
router.post('/api/rehab/:orderNumber/cancel', requireAuth, async (req, res, next) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim();
    const reason = String(req.body.reason || 'リハビリ指示中止').trim();
    const existing = await rehabOrderRepository.findByOrderNumber(orderNumber);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象リハビリ指示が見つかりません。' });
    }
    const actor = formatActorForRecord(req.session.user);
    const updated = await rehabOrderRepository.flagCancelled(orderNumber, reason, actor);
    return res.json({ ok: true, rehab: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
