'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const radiologyOrderRepository = require('../repositories/radiologyOrderRepository');
const roleOrderRepository = require('../repositories/roleOrderRepository');
const {
  PATIENT_CATEGORIES,
  getSwitchableMenus
} = require('../config/constants');
const {
  getEffectiveRoleCode,
  formatActorForRecord,
  buildElevationMeta
} = require('../utils/actorHelper');

const router = express.Router();

const CATEGORY_LABEL_MAP = Object.fromEntries(PATIENT_CATEGORIES.map((c) => [c.code, c.name]));

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

async function getRadiologyRolePerm(roleCode) {
  const all = await roleOrderRepository.findAll();
  const found = all.find((p) => p.roleCode === roleCode && p.orderTypeCode === 'radiology');
  return found || { canCreate: false, canExecute: false };
}

function normalizeOrderPayload(body, sessionUser) {
  const formType = ['CT', 'FLUORO', 'XRAY'].includes(String(body.formType || '').toUpperCase())
    ? String(body.formType).toUpperCase()
    : 'CT';

  const patientId = String(body.patientId || '').trim();
  const patientName = String(body.patientName || '').trim();
  if (!patientId || !patientName) {
    return { error: '対象患者（ID・氏名）を選択または入力してください。' };
  }

  const rawParts = Array.isArray(body.parts)
    ? body.parts.map((v) => String(v).trim()).filter(Boolean)
    : body.parts
      ? [String(body.parts).trim()].filter(Boolean)
      : [];

  let formName = 'ＣＴ検査依頼書';
  let modality = 'CT';
  let contrast = String(body.contrast || '単純').trim() || '単純';
  let examType = '';

  if (formType === 'CT') {
    formName = 'ＣＴ検査依頼書';
    modality = 'CT';
    examType = `${contrast}CT (${rawParts.join('・') || body.partsDetail || '精査'})`;
  } else if (formType === 'FLUORO') {
    formName = '透視検査依頼書';
    modality = '透視';
    contrast = String(body.contrast || '造影').trim() || '造影';
    examType = rawParts.join('・') || body.partsDetail || '透視検査';
  } else {
    formName = '診療Ｘ線照射録';
    modality = '一般X線';
    contrast = '単純';
    examType = rawParts.join('・') || body.partsDetail || '一般撮影';
  }

  const parsedAge = body.age !== '' && body.age != null && !Number.isNaN(Number(body.age))
    ? Number(body.age)
    : null;

  const scheduledDate = body.scheduledDate ? new Date(body.scheduledDate) : new Date();
  const validScheduled = Number.isNaN(scheduledDate.getTime()) ? new Date() : scheduledDate;

  return {
    record: {
      scheduled_date: validScheduled,
      patient_id: patientId,
      patient_name: patientName,
      patient_kana: String(body.patientKana || '').trim(),
      gender: String(body.gender || '不明').trim(),
      age: parsedAge,
      birth_date: String(body.birthDate || '').trim(),
      ward: String(body.ward || '外来').trim(),
      room: String(body.room || '').trim(),
      source_department: String(body.sourceDepartment || sessionUser.departmentCode || '').trim(),
      request_department: String(body.requestDepartment || '内科').trim(),
      mobility: String(body.mobility || '徒歩').trim(),
      infection: String(body.infection || '無').trim(),
      height: String(body.height || '').trim(),
      weight: String(body.weight || '').trim(),
      doctor_name: formatActorForRecord(sessionUser, body.doctorName),
      ordered_by_staff_id: sessionUser.staffId,
      ...buildElevationMeta(sessionUser),
      form_type: formType,
      form_name: formName,
      modality,
      exam_type: examType,
      contrast,
      dynamic_phase: String(body.dynamicPhase || '').trim(),
      is_portable: body.isPortable === true || body.isPortable === 'true',
      portable_room: String(body.portableRoom || '').trim(),
      is_urgent: body.isUrgent === true || body.isUrgent === 'true',
      parts: rawParts,
      parts_detail: String(body.partsDetail || '').trim(),
      medications: String(body.medications || '').trim(),
      materials: String(body.materials || '').trim(),
      condition_kv: String(body.conditionKv || '').trim(),
      condition_ma: String(body.conditionMa || '').trim(),
      condition_sec: String(body.conditionSec || '').trim(),
      purpose: String(body.purpose || '').trim(),
      remarks: String(body.remarks || '').trim(),
      media_dvd: String(body.mediaDvd || '未').trim(),
      elec_img_add: body.elecImgAdd !== false && body.elecImgAdd !== 'false'
    }
  };
}

/**
 * 放射線科オーダー入力画面 (GET /radiology)
 */
router.get('/radiology', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const [patients, rolePerm] = await Promise.all([
      patientRepository.findAll(),
      getRadiologyRolePerm(getEffectiveRoleCode(sessionUser))
    ]);

    const activePatients = patients
      .filter((p) => p.isActive)
      .map((p) => ({
        ...p,
        careCategoryName: CATEGORY_LABEL_MAP[p.careCategory] || p.careCategory
      }));

    // 対象患者決定（クエリ > セッション > 先頭患者なし）
    const queryPid = String(req.query.patientId || '').trim();
    let selectedPatient = null;
    if (queryPid) {
      selectedPatient = activePatients.find((p) => p.patientId === queryPid) || null;
      if (selectedPatient) {
        req.session.selectedPatient = selectedPatient;
      }
    } else if (req.session.selectedPatient) {
      selectedPatient =
        activePatients.find((p) => p.patientId === req.session.selectedPatient.patientId) ||
        req.session.selectedPatient;
    }

    const isEmbed = req.query.embed === '1' || req.query.embed === 'true';
    // 患者の入院（介護医療院含む）/外来ステータスをデフォルトとして優先反映
    const initialWard =
      (selectedPatient && selectedPatient.careCategoryName) ||
      String(req.query.ward || '').trim() ||
      '外来';
    const sourceDept = String(req.query.sourceDept || sessionUser.departmentCode || '').trim();
    const reviseOrderNumber = String(req.query.revise || '').trim();

    const pastOrders = isEmbed
      ? []
      : selectedPatient
        ? await radiologyOrderRepository.findByPatientId(selectedPatient.patientId)
        : await radiologyOrderRepository.findOrders({ status: 'ALL', includeInactive: true });

    res.render('radiologyOrder', {
      statusBar: {
        screenTitle: '放射線科オーダー',
        patient: buildStatusBarPatient(selectedPatient),
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      patients: activePatients,
      selectedPatient,
      pastOrders,
      rolePerm,
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
 * 放射線科 指示受け・実施モニター画面 (GET /radiology/monitor)
 */
router.get('/radiology/monitor', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    let selectedPatient = null;
    if (req.session.selectedPatient && req.session.selectedPatient.patientId) {
      selectedPatient =
        (await patientRepository.findByPatientId(req.session.selectedPatient.patientId)) ||
        req.session.selectedPatient;
      req.session.selectedPatient = selectedPatient;
    }
    const rolePerm = await getRadiologyRolePerm(getEffectiveRoleCode(sessionUser));

    res.render('radiologyMonitor', {
      statusBar: {
        screenTitle: '放射線科 指示受け・実施モニター',
        patient: buildStatusBarPatient(selectedPatient),
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      rolePerm,
      user: sessionUser
    });
  } catch (err) {
    next(err);
  }
});

/**
 * A4 正・控え2枚組 伝票印刷ビュー (GET /radiology/print/:orderNumber)
 */
router.get('/radiology/print/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await radiologyOrderRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).send('指定された放射線オーダーが見つかりません。');
    }
    res.render('radiologyPrint', {
      order,
      autoPrint: req.query.autoprint === '1'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 放射線オーダー一覧取得 (GET /api/radiology-orders)
 */
router.get('/api/radiology-orders', requireAuth, async (req, res, next) => {
  try {
    const { status = 'ACTIVE', search = '', patientId = '', includeInactive = 'false' } = req.query;
    const showInactive = includeInactive === 'true' || includeInactive === '1';

    let orders;
    if (patientId) {
      orders = await radiologyOrderRepository.findByPatientId(patientId);
      if (!showInactive) {
        orders = orders.filter((o) => !o.isSuperseded);
      }
    } else {
      orders = await radiologyOrderRepository.findOrders({
        status,
        search,
        includeInactive: showInactive
      });
    }

    const grouped = { xray: [], ct: [], fluoro: [] };
    for (const o of orders) {
      const key = o.modalityKey || 'xray';
      if (grouped[key]) grouped[key].push(o);
    }

    const counts = await radiologyOrderRepository.countSummary();

    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      counts,
      orders,
      grouped
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 単一オーダー取得 (GET /api/radiology-orders/:orderNumber)
 */
router.get('/api/radiology-orders/:orderNumber', requireAuth, async (req, res, next) => {
  try {
    const order = await radiologyOrderRepository.findByOrderNumber(req.params.orderNumber);
    if (!order) {
      return res.status(404).json({ ok: false, error: '対象オーダーが見つかりません。' });
    }
    return res.json({ ok: true, order });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 新規オーダー発行 / 訂正再発行（元オーダーへフラグを立て追記） (POST /api/radiology-orders)
 */
router.post('/api/radiology-orders', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const validated = normalizeOrderPayload(req.body, sessionUser);
    if (validated.error) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    const parentOrderNumber = String(req.body.parentOrderNumber || '').trim();
    const revisionNote = String(req.body.revisionNote || '').trim();

    let saved;
    if (parentOrderNumber) {
      const parent = await radiologyOrderRepository.findByOrderNumber(parentOrderNumber);
      if (!parent) {
        return res.status(404).json({ ok: false, error: '訂正元のオーダーが見つかりません。' });
      }
      saved = await radiologyOrderRepository.supersedeAndAppend(
        parentOrderNumber,
        validated.record,
        formatActorForRecord(sessionUser),
        revisionNote
      );
    } else {
      saved = await radiologyOrderRepository.createOrder(validated.record);
    }

    // 選択患者セッションも最新に合わせる
    const patient = await patientRepository.findByPatientId(saved.patientId);
    if (patient) {
      req.session.selectedPatient = {
        ...patient,
        careCategoryName: CATEGORY_LABEL_MAP[patient.careCategory] || patient.careCategory
      };
    }

    return res.status(201).json({ ok: true, order: saved });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 実施ステータス遷移（受付 / 実施済 / 戻す） (POST /api/radiology-orders/:orderNumber/status)
 */
router.post('/api/radiology-orders/:orderNumber/status', requireAuth, async (req, res, next) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim();
    const nextStatus = String(req.body.status || '').toUpperCase();
    const technicianNotes = typeof req.body.technicianNotes === 'string' ? req.body.technicianNotes.trim() : undefined;

    if (!['ORDERED', 'ACCEPTED', 'COMPLETED'].includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: '不正なステータス指定です。' });
    }

    const existing = await radiologyOrderRepository.findByOrderNumber(orderNumber);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象オーダーが見つかりません。' });
    }
    if (existing.isCancelled || existing.isSuperseded) {
      return res.status(400).json({ ok: false, error: '中止または訂正済のオーダーはステータス変更できません。' });
    }

    const actor = formatActorForRecord(req.session.user);
    const updated = await radiologyOrderRepository.updateExecutionStatus(
      orderNumber,
      nextStatus,
      actor,
      technicianNotes
    );
    return res.json({ ok: true, order: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 中止フラグ設定（物理削除せず元オーダーへフラグを立て追記） (POST /api/radiology-orders/:orderNumber/cancel)
 */
router.post('/api/radiology-orders/:orderNumber/cancel', requireAuth, async (req, res, next) => {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim();
    const reason = String(req.body.reason || 'オーダー中止').trim();
    const existing = await radiologyOrderRepository.findByOrderNumber(orderNumber);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象オーダーが見つかりません。' });
    }

    const actor = formatActorForRecord(req.session.user);
    const updated = await radiologyOrderRepository.flagCancelled(orderNumber, reason, actor);
    return res.json({ ok: true, order: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
