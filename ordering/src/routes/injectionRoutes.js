'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const injectionRepository = require('../repositories/injectionRepository');
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

const INJECTION_KINDS = {
  inpatient: {
    kind: 'inpatient',
    path: '/injections/inpatient',
    screenTitle: '入院注射箋',
    injectionType: '入院注射',
    defaultWard: '医療病棟',
    defaultDays: 3,
    defaultDayUnit: '日間',
    defaultTimings: [],
    timingOptions: []
  },
  outpatient: {
    kind: 'outpatient',
    path: '/injections/outpatient',
    screenTitle: '外来注射箋',
    injectionType: '外来注射',
    defaultWard: '外来',
    defaultDays: 1,
    defaultDayUnit: '回',
    defaultTimings: ['来院時'],
    timingOptions: ['来院時', '午前', '午後', '随時']
  }
};

const VALID_INJECTION_TYPES = new Set(['入院注射', '外来注射']);

const INJECTION_ROUTES = [
  '点滴静注(DIV)',
  '静脈注射(IV)',
  '側管注',
  '皮下注射(SC)',
  '筋肉注射(IM)',
  '中心静脈(CV)',
  '関節腔内注射'
];

const INJECTION_RATE_PRESETS = [
  '30分かけて',
  '1時間かけて',
  '2時間かけて',
  '60mL/h',
  '80mL/h',
  '100mL/h',
  '緩徐に静注',
  'ワンショット',
  '持続投与'
];

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

function addDaysIso(isoDate, offset) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  const base = m
    ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    : new Date();
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

function normalizeScheduleInput(rawSchedule, startDate, days, injectionType) {
  if (Array.isArray(rawSchedule) && rawSchedule.length > 0) {
    const map = new Map();
    for (const entry of rawSchedule) {
      const dateStr = String(entry && entry.date ? entry.date : '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      const status = entry.status === 'DELETE' ? 'DELETE' : 'CONTINUE';
      map.set(dateStr, {
        date: dateStr,
        status,
        note: String(entry.note || '').trim()
      });
    }
    if (map.size > 0) {
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  if (injectionType === '入院注射') {
    const count = Math.max(1, Math.min(31, Number(days) || 1));
    const list = [];
    for (let i = 0; i < count; i += 1) {
      list.push({ date: addDaysIso(startDate, i), status: 'CONTINUE', note: '' });
    }
    return list;
  }
  return [];
}

function validateAndNormalizeItems(rawItems, startDate, injectionType) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: '注射薬剤を1件以上入力してください。' };
  }

  const normalized = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const it = rawItems[i];
    const drugName = String(it.drugName || '').trim();
    const dose = String(it.dose || '').trim();
    const route = String(it.route || '').trim();
    const timing = String(it.timing || '').trim();
    const rate = String(it.rate || '').trim();
    const rawDays = Number(it.days);
    const dayUnit = String(it.dayUnit || '日間').trim() || '日間';
    const rpNo = Math.max(1, Number(it.rpNo) || 1);
    const note = String(it.note || '').trim();

    if (!drugName) {
      return { error: `${i + 1}行目の薬剤名を入力してください。` };
    }
    if (!dose) {
      return { error: `${i + 1}行目「${drugName}」の投与量を入力してください。` };
    }
    if (!route) {
      return { error: `${i + 1}行目「${drugName}」の投与経路を選択してください。` };
    }

    const dailySchedule = normalizeScheduleInput(it.dailySchedule, startDate, rawDays, injectionType);
    const continueCount = dailySchedule.filter((d) => d.status === 'CONTINUE').length;
    const effectiveDays =
      dailySchedule.length > 0
        ? continueCount
        : Number.isFinite(rawDays) && rawDays > 0
          ? rawDays
          : 0;

    if (dailySchedule.length === 0 && effectiveDays <= 0) {
      return { error: `${i + 1}行目「${drugName}」の日数/回数は1以上で入力してください。` };
    }

    normalized.push({
      line_no: i + 1,
      rp_no: rpNo,
      drug_id: String(it.drugId || '').trim(),
      drug_name: drugName,
      generic_name: String(it.genericName || '').trim(),
      spec: String(it.spec || '').trim(),
      unit: String(it.unit || '').trim(),
      category: String(it.category || '注射剤').trim(),
      dose,
      route,
      timing,
      rate,
      days: effectiveDays,
      day_unit: dayUnit,
      note,
      daily_schedule: dailySchedule
    });
  }

  return { items: normalized };
}

/**
 * 注射箋 画面 (GET /injections/inpatient | /injections/outpatient)
 */
router.get('/injections/:kind(inpatient|outpatient)', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const isEmbed = req.query.embed === '1' || req.query.embed === 'true';
    const injectionKind = INJECTION_KINDS[req.params.kind] || INJECTION_KINDS.inpatient;

    const [allPatients, categoryTree] = await Promise.all([
      patientRepository.findAll(),
      isEmbed ? Promise.resolve([]) : medicineRepository.getCategoryTree()
    ]);

    const activePatients = allPatients
      .filter((p) => p.isActive)
      .map((p) => ({
        ...p,
        careCategoryName: CATEGORY_LABEL_MAP[p.careCategory] || p.careCategory
      }))
      .sort((a, b) => {
        const targetCat = injectionKind.kind === 'outpatient' ? 'outpatient' : 'ward';
        const aMatch = a.careCategory === targetCat ? 0 : 1;
        const bMatch = b.careCategory === targetCat ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return a.patientId.localeCompare(b.patientId);
      });

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
    const fallbackWard = careDeptObj ? careDeptObj.name : injectionKind.defaultWard;
    // 患者の入院（介護医療院含む）/外来ステータスをデフォルトとして優先反映
    const initialWard =
      (selectedPatient && selectedPatient.careCategoryName) ||
      String(req.query.ward || '').trim() ||
      fallbackWard;
    const sourceDept = String(req.query.sourceDept || sessionUser.departmentCode || '').trim();
    const reviseOrderNumber = String(req.query.revise || '').trim();

    const pastInjections = isEmbed
      ? []
      : selectedPatient
        ? await injectionRepository.findByPatientId(selectedPatient.patientId, {
            injectionType: injectionKind.injectionType
          })
        : await injectionRepository.findAll({
            includeInactive: true,
            injectionType: injectionKind.injectionType
          });

    res.render('injectionOrder', {
      statusBar: {
        screenTitle: injectionKind.screenTitle,
        patient: buildStatusBarPatient(selectedPatient),
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      injectionKind,
      injectionRoutes: INJECTION_ROUTES,
      ratePresets: INJECTION_RATE_PRESETS,
      patients: activePatients,
      selectedPatient,
      categoryTree,
      pastInjections,
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
 * 注射箋 印刷ビュー (GET /injections/print/:orderNumber)
 */
router.get('/injections/print/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await injectionRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).send('指定された注射箋が見つかりません。');
    }
    res.render('injectionPrint', {
      order,
      autoPrint: req.query.autoprint === '1'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 注射箋一覧 (GET /api/injections)
 */
router.get('/api/injections', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.query.patientId || '').trim();
    const injectionType = String(req.query.injectionType || '').trim();
    const includeInactive = req.query.includeInactive !== 'false';

    let injections;
    if (patientId) {
      injections = await injectionRepository.findByPatientId(patientId, { injectionType });
      if (!includeInactive) {
        injections = injections.filter((inj) => !inj.isCancelled && !inj.isSuperseded);
      }
    } else {
      injections = await injectionRepository.findAll({ includeInactive, injectionType });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, count: injections.length, injections });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 単一注射箋取得 (GET /api/injections/:orderNumber)
 */
router.get('/api/injections/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await injectionRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).json({ ok: false, error: '対象注射箋が見つかりません。' });
    }
    return res.json({ ok: true, injection: order });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 注射箋 発行 / 訂正再発行（元注射箋へフラグを立て追記） (POST /api/injections)
 */
router.post('/api/injections', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const patientId = String(req.body.patientId || '').trim();
    const patientName = String(req.body.patientName || '').trim();
    if (!patientId || !patientName) {
      return res.status(400).json({ ok: false, error: '対象患者（ID・氏名）を選択または入力してください。' });
    }

    const requestedType = String(req.body.injectionType || '').trim();
    const injectionType = VALID_INJECTION_TYPES.has(requestedType)
      ? requestedType
      : '入院注射';
    const startDate = String(req.body.startDate || '').trim() || new Date().toISOString().slice(0, 10);

    const validated = validateAndNormalizeItems(req.body.items, startDate, injectionType);
    if (validated.error) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const parsedAge =
      req.body.age !== '' && req.body.age != null && !Number.isNaN(Number(req.body.age))
        ? Number(req.body.age)
        : null;

    const record = {
      injection_type: injectionType,
      start_date: startDate,
      patient_id: patientId,
      patient_name: patientName,
      patient_kana: String(req.body.patientKana || '').trim(),
      gender: String(req.body.gender || '不明').trim(),
      age: parsedAge,
      birth_date: String(req.body.birthDate || '').trim(),
      ward: String(req.body.ward || (injectionType === '外来注射' ? '外来' : '医療病棟')).trim(),
      room: String(req.body.room || '').trim(),
      source_department: String(req.body.sourceDepartment || sessionUser.departmentCode || '').trim(),
      doctor_name: formatActorForRecord(sessionUser, req.body.doctorName),
      ordered_by_staff_id: sessionUser.staffId,
      ...buildElevationMeta(sessionUser),
      items: validated.items,
      remarks: String(req.body.remarks || '').trim()
    };

    const parentOrderNumber = String(req.body.parentOrderNumber || '').trim();
    const revisionNote = String(req.body.revisionNote || '').trim();

    let saved;
    if (parentOrderNumber) {
      const parent = await injectionRepository.findByOrderNumber(parentOrderNumber);
      if (!parent) {
        return res.status(404).json({ ok: false, error: '訂正元の注射箋が見つかりません。' });
      }
      saved = await injectionRepository.supersedeAndAppend(
        parentOrderNumber,
        record,
        formatActorForRecord(sessionUser),
        revisionNote
      );
    } else {
      saved = await injectionRepository.createInjection(record);
    }

    const patient = await patientRepository.findByPatientId(saved.patientId);
    if (patient) {
      req.session.selectedPatient = {
        ...patient,
        careCategoryName: CATEGORY_LABEL_MAP[patient.careCategory] || patient.careCategory
      };
    }

    return res.status(201).json({ ok: true, injection: saved });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 注射箋 中止フラグ設定（物理削除禁止） (POST /api/injections/:orderNumber/cancel)
 */
router.post('/api/injections/:orderNumber/cancel', requireAuth, async (req, res, next) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim();
    const reason = String(req.body.reason || '注射中止').trim();
    const existing = await injectionRepository.findByOrderNumber(orderNumber);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象注射箋が見つかりません。' });
    }
    const actor = formatActorForRecord(req.session.user);
    const updated = await injectionRepository.flagCancelled(orderNumber, reason, actor);
    return res.json({ ok: true, injection: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
