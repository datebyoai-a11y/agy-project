'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const mealOrderRepository = require('../repositories/mealOrderRepository');
const {
  PATIENT_CATEGORIES,
  getDepartmentByCode,
  isCareFacilityCode,
  getSwitchableMenus
} = require('../config/constants');
const { formatActorForRecord, buildElevationMeta } = require('../utils/actorHelper');

const router = express.Router();

const CATEGORY_LABEL_MAP = Object.fromEntries(PATIENT_CATEGORIES.map((c) => [c.code, c.name]));

const MEAL_OPTIONS = {
  startMeals: ['朝食', '昼食', '夕食', '即時変更'],
  dietTypes: [
    '常食',
    '軟菜食',
    '全粥食',
    '五分粥食',
    '流動食',
    '糖尿病食',
    '減塩食',
    '腎臓病食',
    '肝臓病食',
    '脂質異常症食',
    '経管栄養',
    '絶食（禁食）'
  ],
  stapleTypes: ['米飯', '軟飯', '全粥', '五分粥', '三分粥', 'パン', 'なし'],
  stapleAmounts: ['全量', '150g', '120g', '100g', '半量', 'なし'],
  sideTextures: ['常菜', '一口大', '刻み', '極刻み', 'ソフト食', 'ミキサー食', 'ゼリー食', 'なし'],
  thickeners: ['なし', '薄め', '中間', '濃いめ'],
  calories: ['標準', '1200kcal', '1400kcal', '1600kcal', '1800kcal', '2000kcal'],
  saltLimits: ['制限なし', '6g未満', '5g未満', '7g未満'],
  eatingAids: ['自立', '見守り', '一部介助', '全介助', 'スプーン', '自助具', '吸い飲み']
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

/**
 * 食事オーダー画面 (GET /meals)
 */
router.get('/meals', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const isEmbed = req.query.embed === '1' || req.query.embed === 'true';

    const allPatients = await patientRepository.findAll();
    const activePatients = allPatients
      .filter((p) => p.isActive)
      .map((p) => ({
        ...p,
        careCategoryName: CATEGORY_LABEL_MAP[p.careCategory] || p.careCategory
      }))
      .sort((a, b) => {
        const aIn = a.careCategory !== 'outpatient' ? 0 : 1;
        const bIn = b.careCategory !== 'outpatient' ? 0 : 1;
        if (aIn !== bIn) return aIn - bIn;
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
    const fallbackWard = careDeptObj ? careDeptObj.name : '医療病棟';
    const initialWard =
      (selectedPatient && selectedPatient.careCategoryName) ||
      String(req.query.ward || '').trim() ||
      fallbackWard;
    const sourceDept = String(req.query.sourceDept || sessionUser.departmentCode || '').trim();
    const reviseOrderNumber = String(req.query.revise || '').trim();

    const pastOrders = isEmbed
      ? []
      : selectedPatient
        ? await mealOrderRepository.findByPatientId(selectedPatient.patientId)
        : await mealOrderRepository.findAll({ includeInactive: true });

    res.render('mealOrder', {
      statusBar: {
        screenTitle: '食事オーダー',
        patient: buildStatusBarPatient(selectedPatient),
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      mealOptions: MEAL_OPTIONS,
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
 * 食事オーダー 印刷ビュー (GET /meals/print/:orderNumber)
 */
router.get('/meals/print/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await mealOrderRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).send('指定された食事オーダーが見つかりません。');
    }
    res.render('mealPrint', {
      order,
      autoPrint: req.query.autoprint === '1'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 食事オーダー一覧 (GET /api/meals)
 */
router.get('/api/meals', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.query.patientId || '').trim();
    const includeInactive = req.query.includeInactive !== 'false';

    let meals;
    if (patientId) {
      meals = await mealOrderRepository.findByPatientId(patientId);
      if (!includeInactive) {
        meals = meals.filter((m) => !m.isCancelled && !m.isSuperseded);
      }
    } else {
      meals = await mealOrderRepository.findAll({ includeInactive });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, count: meals.length, meals });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 単一食事オーダー取得 (GET /api/meals/:orderNumber)
 */
router.get('/api/meals/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await mealOrderRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).json({ ok: false, error: '対象食事オーダーが見つかりません。' });
    }
    return res.json({ ok: true, meal: order });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 食事オーダー発行 / 訂正再発行 (POST /api/meals)
 */
router.post('/api/meals', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const patientId = String(req.body.patientId || '').trim();
    const patientName = String(req.body.patientName || '').trim();
    if (!patientId || !patientName) {
      return res.status(400).json({ ok: false, error: '対象患者（ID・氏名）を選択または入力してください。' });
    }

    const dietType = String(req.body.dietType || '').trim();
    if (!dietType) {
      return res.status(400).json({ ok: false, error: '食種を選択してください。' });
    }

    const parsedAge =
      req.body.age !== '' && req.body.age != null && !Number.isNaN(Number(req.body.age))
        ? Number(req.body.age)
        : null;

    const eatingAid = Array.isArray(req.body.eatingAid)
      ? req.body.eatingAid.map((v) => String(v).trim()).filter(Boolean)
      : [];

    const record = {
      start_date: String(req.body.startDate || '').trim() || new Date().toISOString().slice(0, 10),
      start_meal: String(req.body.startMeal || '昼食').trim(),
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
      diet_type: dietType,
      staple_type: String(req.body.stapleType || '米飯').trim(),
      staple_amount: String(req.body.stapleAmount || '全量').trim(),
      side_texture: String(req.body.sideTexture || '常菜').trim(),
      thickener: String(req.body.thickener || 'なし').trim(),
      calories: String(req.body.calories || '').trim(),
      salt_limit: String(req.body.saltLimit || '').trim(),
      protein_limit: String(req.body.proteinLimit || '').trim(),
      water_limit: String(req.body.waterLimit || '').trim(),
      supplement: String(req.body.supplement || '').trim(),
      prohibited_foods: String(req.body.prohibitedFoods || '').trim(),
      eating_aid: eatingAid,
      remarks: String(req.body.remarks || '').trim()
    };

    const parentOrderNumber = String(req.body.parentOrderNumber || '').trim();
    const revisionNote = String(req.body.revisionNote || '').trim();

    let saved;
    if (parentOrderNumber) {
      const parent = await mealOrderRepository.findByOrderNumber(parentOrderNumber);
      if (!parent) {
        return res.status(404).json({ ok: false, error: '訂正元の食事オーダーが見つかりません。' });
      }
      saved = await mealOrderRepository.supersedeAndAppend(
        parentOrderNumber,
        record,
        formatActorForRecord(sessionUser),
        revisionNote
      );
    } else {
      saved = await mealOrderRepository.createMealOrder(record);
    }

    const patient = await patientRepository.findByPatientId(saved.patientId);
    if (patient) {
      req.session.selectedPatient = {
        ...patient,
        careCategoryName: CATEGORY_LABEL_MAP[patient.careCategory] || patient.careCategory
      };
    }

    return res.status(201).json({ ok: true, meal: saved });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 食事オーダー中止フラグ設定（物理削除禁止） (POST /api/meals/:orderNumber/cancel)
 */
router.post('/api/meals/:orderNumber/cancel', requireAuth, async (req, res, next) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim();
    const reason = String(req.body.reason || '食事オーダー中止').trim();
    const existing = await mealOrderRepository.findByOrderNumber(orderNumber);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象食事オーダーが見つかりません。' });
    }
    const actor = formatActorForRecord(req.session.user);
    const updated = await mealOrderRepository.flagCancelled(orderNumber, reason, actor);
    return res.json({ ok: true, meal: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
