'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const prescriptionRepository = require('../repositories/prescriptionRepository');
const medicineRepository = require('../repositories/medicineRepository');
const {
  PATIENT_CATEGORIES,
  getDepartmentByCode,
  isCareFacilityCode,
  getSwitchableMenus
} = require('../config/constants');
const { formatActorForRecord, buildElevationMeta } = require('../utils/actorHelper');

const router = express.Router();

const CATEGORY_LABEL_MAP = Object.fromEntries(PATIENT_CATEGORIES.map((c) => [c.code, c.name]));

const ADMINISTRATION_METHODS = [
  '毎食後',
  '朝夕食後',
  '朝食後',
  '昼食後',
  '夕食後',
  '就寝前',
  '毎食前',
  '朝夕食前',
  '朝食前',
  '食間',
  '起床時',
  '発熱・疼痛時（頓用）',
  '不眠時（頓用）',
  '便秘時（頓用）',
  '嘔気時（頓用）',
  '患部塗布',
  '患部貼付',
  '点眼'
];

const DIVISION_OPTIONS = ['1', '2', '3', '4', '頓用', '外用'];

const PRESCRIPTION_KINDS = {
  adhoc: {
    kind: 'adhoc',
    path: '/prescriptions/adhoc',
    screenTitle: '臨時処方箋',
    prescriptionType: '臨時処方',
    defaultDispenseType: '院内処方',
    defaultWard: '医療病棟',
    defaultDays: 3
  },
  regular: {
    kind: 'regular',
    path: '/prescriptions/regular',
    screenTitle: '定期処方箋',
    prescriptionType: '定期処方',
    defaultDispenseType: '院内処方',
    defaultWard: '医療病棟',
    defaultDays: 14
  },
  outpatient: {
    kind: 'outpatient',
    path: '/prescriptions/outpatient',
    screenTitle: '外来処方箋',
    prescriptionType: '外来処方',
    defaultDispenseType: '院外処方箋',
    defaultWard: '外来',
    defaultDays: 14
  }
};

const VALID_PRESCRIPTION_TYPES = new Set(['臨時処方', '定期処方', '外来処方']);

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

function validateAndNormalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: '薬剤を1件以上入力してください。' };
  }

  const normalized = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const it = rawItems[i];
    const drugName = String(it.drugName || '').trim();
    const dailyDose = String(it.dailyDose || '').trim();
    const divisionCount = String(it.divisionCount || '').trim();
    const administrationMethod = String(it.administrationMethod || '').trim();
    const prescriptionDays = Number(it.prescriptionDays);
    const dayUnit = String(it.dayUnit || '日分').trim() || '日分';
    const note = String(it.note || '').trim();

    if (!drugName) {
      return { error: `${i + 1}行目の薬剤名を入力してください。` };
    }
    if (!dailyDose) {
      return { error: `${i + 1}行目「${drugName}」の1日量を入力してください。` };
    }
    if (!divisionCount) {
      return { error: `${i + 1}行目「${drugName}」の分割回数を選択または入力してください。` };
    }
    if (!administrationMethod) {
      return { error: `${i + 1}行目「${drugName}」の服用方法を選択または入力してください。` };
    }
    if (!Number.isFinite(prescriptionDays) || prescriptionDays <= 0) {
      return { error: `${i + 1}行目「${drugName}」の処方日数は1以上で入力してください。` };
    }

    normalized.push({
      line_no: i + 1,
      drug_id: String(it.drugId || '').trim(),
      drug_name: drugName,
      generic_name: String(it.genericName || '').trim(),
      spec: String(it.spec || '').trim(),
      unit: String(it.unit || '').trim(),
      category: String(it.category || '内服薬').trim(),
      daily_dose: dailyDose,
      division_count: divisionCount,
      administration_method: administrationMethod,
      prescription_days: prescriptionDays,
      day_unit: dayUnit,
      note,
      suspension_ok: String(it.suspensionOk || '').trim(),
      crush_ok: String(it.crushOk || '').trim()
    });
  }

  return { items: normalized };
}

/**
 * 処方箋 画面 (GET /prescriptions/adhoc | /prescriptions/regular | /prescriptions/outpatient)
 */
router.get('/prescriptions/:kind(adhoc|regular|outpatient)', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const isEmbed = req.query.embed === '1' || req.query.embed === 'true';
    const prescriptionKind = PRESCRIPTION_KINDS[req.params.kind] || PRESCRIPTION_KINDS.adhoc;

    const [allPatients, categoryTree] = await Promise.all([
      patientRepository.findAll(),
      isEmbed ? Promise.resolve([]) : medicineRepository.getCategoryTree()
    ]);

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
    const fallbackWard = careDeptObj ? careDeptObj.name : prescriptionKind.defaultWard;
    // 患者の入院（介護医療院含む）/外来ステータスをデフォルトとして優先反映
    const initialWard =
      (selectedPatient && selectedPatient.careCategoryName) ||
      String(req.query.ward || '').trim() ||
      fallbackWard;
    const effectivePrescriptionKind = {
      ...prescriptionKind,
      defaultDispenseType: selectedPatient
        ? selectedPatient.careCategory === 'outpatient'
          ? '院外処方箋'
          : '院内処方'
        : prescriptionKind.defaultDispenseType
    };
    const sourceDept = String(req.query.sourceDept || sessionUser.departmentCode || '').trim();
    const reviseOrderNumber = String(req.query.revise || '').trim();
    const doOrderNumber = String(req.query.do || '').trim();

    const pastPrescriptions = isEmbed
      ? []
      : selectedPatient
        ? await prescriptionRepository.findByPatientId(selectedPatient.patientId)
        : await prescriptionRepository.findAll({ includeInactive: true });

    res.render('adhocPrescription', {
      statusBar: {
        screenTitle: prescriptionKind.screenTitle,
        patient: buildStatusBarPatient(selectedPatient),
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      prescriptionKind: effectivePrescriptionKind,
      patients: activePatients,
      selectedPatient,
      categoryTree,
      pastPrescriptions,
      administrationMethods: ADMINISTRATION_METHODS,
      divisionOptions: DIVISION_OPTIONS,
      user: sessionUser,
      isEmbed,
      initialWard,
      sourceDept,
      reviseOrderNumber,
      doOrderNumber
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 臨時処方箋 印刷ビュー (GET /prescriptions/print/:orderNumber)
 */
router.get('/prescriptions/print/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await prescriptionRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).send('指定された処方箋が見つかりません。');
    }
    res.render('prescriptionPrint', {
      order,
      autoPrint: req.query.autoprint === '1'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 臨時処方一覧 (GET /api/prescriptions)
 */
router.get('/api/prescriptions', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.query.patientId || '').trim();
    const includeInactive = req.query.includeInactive !== 'false';

    let prescriptions;
    if (patientId) {
      prescriptions = await prescriptionRepository.findByPatientId(patientId);
      if (!includeInactive) {
        prescriptions = prescriptions.filter((p) => !p.isCancelled && !p.isSuperseded);
      }
    } else {
      prescriptions = await prescriptionRepository.findAll({ includeInactive });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, count: prescriptions.length, prescriptions });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 単一処方取得 (GET /api/prescriptions/:orderNumber)
 */
router.get('/api/prescriptions/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await prescriptionRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).json({ ok: false, error: '対象処方箋が見つかりません。' });
    }
    return res.json({ ok: true, prescription: order });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 臨時処方箋 発行 / 訂正再発行（元処方へフラグを立て追記） (POST /api/prescriptions)
 */
router.post('/api/prescriptions', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const patientId = String(req.body.patientId || '').trim();
    const patientName = String(req.body.patientName || '').trim();
    if (!patientId || !patientName) {
      return res.status(400).json({ ok: false, error: '対象患者（ID・氏名）を選択または入力してください。' });
    }

    const validated = validateAndNormalizeItems(req.body.items);
    if (validated.error) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const parsedAge =
      req.body.age !== '' && req.body.age != null && !Number.isNaN(Number(req.body.age))
        ? Number(req.body.age)
        : null;

    const requestedType = String(req.body.prescriptionType || '').trim();
    const prescriptionType = VALID_PRESCRIPTION_TYPES.has(requestedType)
      ? requestedType
      : '臨時処方';

    const record = {
      prescription_type: prescriptionType,
      dispense_type: String(req.body.dispenseType || '院内処方').trim() || '院内処方',
      start_date: String(req.body.startDate || '').trim() || new Date().toISOString().slice(0, 10),
      patient_id: patientId,
      patient_name: patientName,
      patient_kana: String(req.body.patientKana || '').trim(),
      gender: String(req.body.gender || '不明').trim(),
      age: parsedAge,
      birth_date: String(req.body.birthDate || '').trim(),
      ward: String(req.body.ward || '外来').trim(),
      room: String(req.body.room || '').trim(),
      source_department: String(req.body.sourceDepartment || sessionUser.departmentCode || '').trim(),
      doctor_name: formatActorForRecord(sessionUser, req.body.doctorName),
      ordered_by_staff_id: sessionUser.staffId,
      ...buildElevationMeta(sessionUser),
      do_source_order_number: String(req.body.doSourceOrderNumber || '').trim(),
      items: validated.items,
      remarks: String(req.body.remarks || '').trim()
    };

    const parentOrderNumber = String(req.body.parentOrderNumber || '').trim();
    const revisionNote = String(req.body.revisionNote || '').trim();

    let saved;
    if (parentOrderNumber) {
      const parent = await prescriptionRepository.findByOrderNumber(parentOrderNumber);
      if (!parent) {
        return res.status(404).json({ ok: false, error: '訂正元の処方箋が見つかりません。' });
      }
      saved = await prescriptionRepository.supersedeAndAppend(
        parentOrderNumber,
        record,
        formatActorForRecord(sessionUser),
        revisionNote
      );
    } else {
      saved = await prescriptionRepository.createPrescription(record);
    }

    const patient = await patientRepository.findByPatientId(saved.patientId);
    if (patient) {
      req.session.selectedPatient = {
        ...patient,
        careCategoryName: CATEGORY_LABEL_MAP[patient.careCategory] || patient.careCategory
      };
    }

    return res.status(201).json({ ok: true, prescription: saved });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 臨時処方箋 中止フラグ設定（物理削除禁止） (POST /api/prescriptions/:orderNumber/cancel)
 */
router.post('/api/prescriptions/:orderNumber/cancel', requireAuth, async (req, res, next) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim();
    const reason = String(req.body.reason || '処方中止').trim();
    const existing = await prescriptionRepository.findByOrderNumber(orderNumber);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象処方箋が見つかりません。' });
    }
    const actor = formatActorForRecord(req.session.user);
    const updated = await prescriptionRepository.flagCancelled(orderNumber, reason, actor);
    return res.json({ ok: true, prescription: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
