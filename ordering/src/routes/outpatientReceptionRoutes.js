'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const userRepository = require('../repositories/userRepository');
const outpatientReceptionRepository = require('../repositories/outpatientReceptionRepository');
const prescriptionRepository = require('../repositories/prescriptionRepository');
const injectionRepository = require('../repositories/injectionRepository');
const radiologyOrderRepository = require('../repositories/radiologyOrderRepository');
const rehabOrderRepository = require('../repositories/rehabOrderRepository');
const { PATIENT_CATEGORIES, getSwitchableMenus } = require('../config/constants');
const { getEffectiveRoleCode, formatActorForRecord } = require('../utils/actorHelper');

const router = express.Router();

const CATEGORY_LABEL_MAP = Object.fromEntries(PATIENT_CATEGORIES.map((c) => [c.code, c.name]));
const VISIT_TYPES = ['再診', '初診', '予約', '救急・時間外'];
const CLINIC_DEPARTMENTS = ['内科', '外科', '整形外科', 'リハビリ科', 'その他'];
const VALID_STATUSES = new Set(['WAITING', 'IN_EXAM', 'ACCOUNTING', 'DONE']);

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildOrderCountMap(records) {
  const map = {};
  for (const r of records || []) {
    if (r.isCancelled || r.isSuperseded) continue;
    if (!r.patientId) continue;
    map[r.patientId] = (map[r.patientId] || 0) + 1;
  }
  return map;
}

/**
 * 外来受付一覧画面 (GET /outpatient/reception)
 */
router.get('/outpatient/reception', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const effectiveRoleCode = getEffectiveRoleCode(sessionUser);
    const rawDate = String(req.query.date || '').trim();
    const visitDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayIso();

    const [allPatients, doctors, rawReceptions, rxList, injList, radList, rehabList] = await Promise.all([
      patientRepository.findAll(),
      userRepository.findActiveDoctors(),
      outpatientReceptionRepository.findByDate(visitDate, { includeCancelled: true }),
      prescriptionRepository.findAll({ includeInactive: false }),
      injectionRepository.findAll({ includeInactive: false }),
      radiologyOrderRepository.findOrders({ status: 'ALL', includeInactive: false }),
      rehabOrderRepository.findAll({ includeInactive: false })
    ]);

    const activePatients = allPatients
      .filter((p) => p.isActive)
      .map((p) => ({
        ...p,
        careCategoryName: CATEGORY_LABEL_MAP[p.careCategory] || p.careCategory
      }))
      .sort((a, b) => {
        const aOut = a.careCategory === 'outpatient' ? 0 : 1;
        const bOut = b.careCategory === 'outpatient' ? 0 : 1;
        if (aOut !== bOut) return aOut - bOut;
        return a.patientId.localeCompare(b.patientId);
      });

    const patientMap = Object.fromEntries(allPatients.map((p) => [p.patientId, p]));
    const countMaps = {
      rx: buildOrderCountMap(rxList),
      inj: buildOrderCountMap(injList),
      rad: buildOrderCountMap(radList),
      rehab: buildOrderCountMap(rehabList)
    };

    const receptions = rawReceptions.map((rcp) => {
      const p = patientMap[rcp.patientId] || null;
      return {
        ...rcp,
        allergies: p ? p.allergies || '' : '',
        cautions: p ? p.cautions || '' : '',
        insuranceType: p ? p.insuranceType || '' : '',
        counts: {
          rx: countMaps.rx[rcp.patientId] || 0,
          inj: countMaps.inj[rcp.patientId] || 0,
          rad: countMaps.rad[rcp.patientId] || 0,
          rehab: countMaps.rehab[rcp.patientId] || 0
        }
      };
    });

    const activeList = receptions.filter((r) => !r.isCancelled);
    const summary = {
      total: activeList.length,
      waiting: activeList.filter((r) => r.status === 'WAITING').length,
      inExam: activeList.filter((r) => r.status === 'IN_EXAM').length,
      accounting: activeList.filter((r) => r.status === 'ACCOUNTING').length,
      done: activeList.filter((r) => r.status === 'DONE').length
    };

    const workspaceBasePath = `/workspace/outpatient/${effectiveRoleCode}`;

    res.render('outpatientReception', {
      statusBar: {
        screenTitle: '外来受付一覧',
        patient: null,
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus: getSwitchableMenus(sessionUser)
      },
      visitDate,
      receptions,
      summary,
      patients: activePatients,
      doctors,
      visitTypes: VISIT_TYPES,
      clinicDepartments: CLINIC_DEPARTMENTS,
      workspaceBasePath
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 外来受付一覧取得 (GET /api/outpatient-receptions)
 */
router.get('/api/outpatient-receptions', requireAuth, async (req, res, next) => {
  try {
    const rawDate = String(req.query.date || '').trim();
    const visitDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayIso();
    const includeCancelled = req.query.includeCancelled !== 'false';
    const receptions = await outpatientReceptionRepository.findByDate(visitDate, { includeCancelled });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, visitDate, count: receptions.length, receptions });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 新規外来受付登録 (POST /api/outpatient-receptions)
 */
router.post('/api/outpatient-receptions', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.body.patientId || '').trim();
    if (!patientId) {
      return res.status(400).json({ ok: false, error: '対象患者を選択してください。' });
    }

    const patient = await patientRepository.findByPatientId(patientId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }

    const rawDate = String(req.body.visitDate || '').trim();
    const visitDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayIso();
    const visitType = VISIT_TYPES.includes(req.body.visitType) ? req.body.visitType : '再診';
    const clinicDepartment = CLINIC_DEPARTMENTS.includes(req.body.clinicDepartment)
      ? req.body.clinicDepartment
      : '内科';
    const assignedDoctor = String(req.body.assignedDoctor || '').trim();
    const chiefComplaint = String(req.body.chiefComplaint || '').trim();

    const actor = formatActorForRecord(req.session.user);
    const created = await outpatientReceptionRepository.createReception(
      {
        visit_date: visitDate,
        patient_id: patient.patientId,
        patient_name: patient.fullName,
        patient_kana: patient.kana || '',
        gender: patient.gender || '不明',
        age: patient.age,
        birth_date: patient.birthDate || '',
        visit_type: visitType,
        clinic_department: clinicDepartment,
        assigned_doctor: assignedDoctor,
        chief_complaint: chiefComplaint
      },
      actor
    );

    return res.status(201).json({ ok: true, reception: created });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 外来受付ステータス更新 (PATCH /api/outpatient-receptions/:receptionNumber/status)
 */
router.patch('/api/outpatient-receptions/:receptionNumber/status', requireAuth, async (req, res, next) => {
  try {
    const receptionNumber = String(req.params.receptionNumber || '').trim();
    const nextStatus = String(req.body.status || '').trim().toUpperCase();
    const note = String(req.body.note || '').trim();

    if (!VALID_STATUSES.has(nextStatus)) {
      return res.status(400).json({ ok: false, error: 'ステータス値が正しくありません。' });
    }

    const existing = await outpatientReceptionRepository.findByReceptionNumber(receptionNumber);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象受付レコードが見つかりません。' });
    }
    if (existing.isCancelled) {
      return res.status(400).json({ ok: false, error: '取消済みの受付はステータス変更できません。' });
    }

    const actor = formatActorForRecord(req.session.user);
    const updated = await outpatientReceptionRepository.updateStatus(receptionNumber, nextStatus, actor, note);
    return res.json({ ok: true, reception: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 外来受付取消フラグ設定（物理削除禁止） (POST /api/outpatient-receptions/:receptionNumber/cancel)
 */
router.post('/api/outpatient-receptions/:receptionNumber/cancel', requireAuth, async (req, res, next) => {
  try {
    const receptionNumber = String(req.params.receptionNumber || '').trim();
    const reason = String(req.body.reason || '受付取消').trim();

    const existing = await outpatientReceptionRepository.findByReceptionNumber(receptionNumber);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象受付レコードが見つかりません。' });
    }

    const actor = formatActorForRecord(req.session.user);
    const updated = await outpatientReceptionRepository.flagCancelled(receptionNumber, reason, actor);
    return res.json({ ok: true, reception: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
