'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const bedMovementRepository = require('../repositories/bedMovementRepository');
const prescriptionRepository = require('../repositories/prescriptionRepository');
const injectionRepository = require('../repositories/injectionRepository');
const radiologyOrderRepository = require('../repositories/radiologyOrderRepository');
const mealOrderRepository = require('../repositories/mealOrderRepository');
const rehabOrderRepository = require('../repositories/rehabOrderRepository');
const {
  PATIENT_CATEGORIES,
  getDepartmentByCode,
  isCareFacilityCode,
  resolveLandingScreen,
  getSwitchableMenus
} = require('../config/constants');
const { getEffectiveRoleCode, formatActorForRecord } = require('../utils/actorHelper');

const router = express.Router();

const CATEGORY_LABEL_MAP = Object.fromEntries(PATIENT_CATEGORIES.map((c) => [c.code, c.name]));

const INPATIENT_DEPARTMENTS = [
  { code: 'ward', name: CATEGORY_LABEL_MAP.ward || '医療病棟' },
  { code: 'care_umikaze', name: CATEGORY_LABEL_MAP.care_umikaze || '介護医療院(うみかぜ)' },
  { code: 'care_shiokaze', name: CATEGORY_LABEL_MAP.care_shiokaze || '介護医療院(しおかぜ)' }
];

const INPATIENT_DEPT_SET = new Set(INPATIENT_DEPARTMENTS.map((d) => d.code));

// 標準病室レイアウト定義（未登録病室・病室未割当の患者も動的に追加表示）
const DEFAULT_ROOM_LAYOUTS = {
  ward: [
    { roomNo: '201', roomType: '4床室', beds: ['201-1', '201-2', '201-3', '201-4'] },
    { roomNo: '202', roomType: '4床室', beds: ['202-1', '202-2', '202-3', '202-4'] },
    { roomNo: '203', roomType: '4床室', beds: ['203-1', '203-2', '203-3', '203-4'] },
    { roomNo: '205', roomType: '個室', beds: ['205-1'] },
    { roomNo: '206', roomType: '2床室', beds: ['206-1', '206-2'] },
    { roomNo: '207', roomType: '4床室', beds: ['207-1', '207-2', '207-3', '207-4'] },
    { roomNo: '208', roomType: '2床室', beds: ['208-1', '208-2'] },
    { roomNo: '209', roomType: '個室', beds: ['209-1'] },
    { roomNo: '210', roomType: '個室', beds: ['210-1'] }
  ],
  care_umikaze: [
    { roomNo: '301', roomType: '4床室', beds: ['301-1', '301-2', '301-3', '301-4'] },
    { roomNo: '302', roomType: '4床室', beds: ['302-1', '302-2', '302-3', '302-4'] },
    { roomNo: '305', roomType: '2床室', beds: ['305-1', '305-2'] },
    { roomNo: '306', roomType: '個室', beds: ['306-1'] }
  ],
  care_shiokaze: [
    { roomNo: '401', roomType: '4床室', beds: ['401-1', '401-2', '401-3', '401-4'] },
    { roomNo: '402', roomType: '4床室', beds: ['402-1', '402-2', '402-3', '402-4'] },
    { roomNo: '405', roomType: '2床室', beds: ['405-1', '405-2'] },
    { roomNo: '406', roomType: '個室', beds: ['406-1'] }
  ]
};

function buildOrderCountMap(records) {
  const map = {};
  for (const r of records || []) {
    if (r.isCancelled || r.isSuperseded) continue;
    const pid = r.patientId;
    if (!pid) continue;
    map[pid] = (map[pid] || 0) + 1;
  }
  return map;
}

function buildBedRooms(departmentCode, patients, countMaps) {
  const template = DEFAULT_ROOM_LAYOUTS[departmentCode] || DEFAULT_ROOM_LAYOUTS.ward;
  const rooms = template.map((r) => ({
    roomNo: r.roomNo,
    roomType: r.roomType,
    beds: r.beds.map((bedCode) => ({ bedCode, patient: null }))
  }));

  const bedLookup = new Map();
  const roomLookup = new Map();
  for (const room of rooms) {
    roomLookup.set(room.roomNo, room);
    for (const bed of room.beds) {
      bedLookup.set(bed.bedCode, bed);
    }
  }

  const unassigned = [];

  for (const p of patients) {
    const activeDiagnoses = (Array.isArray(p.diagnoses) ? p.diagnoses : []).filter(
      (d) => !d.endDate && (!d.outcome || d.outcome === '継続')
    );
    const enriched = {
      ...p,
      activeDiagnoses,
      counts: countMaps
        ? {
            rx: countMaps.rx[p.patientId] || 0,
            inj: countMaps.inj[p.patientId] || 0,
            rad: countMaps.rad[p.patientId] || 0,
            meal: countMaps.meal[p.patientId] || 0,
            rehab: countMaps.rehab[p.patientId] || 0
          }
        : { rx: 0, inj: 0, rad: 0, meal: 0, rehab: 0 }
    };

    const rawRoom = String(p.wardRoom || '').trim();
    if (!rawRoom) {
      unassigned.push({ bedCode: '未割当', patient: enriched });
      continue;
    }

    const exactBed = bedLookup.get(rawRoom);
    if (exactBed && !exactBed.patient) {
      exactBed.patient = enriched;
      continue;
    }

    const roomPrefix = rawRoom.split('-')[0];
    const targetRoom = roomLookup.get(roomPrefix);
    if (targetRoom) {
      const emptyBed = targetRoom.beds.find((b) => !b.patient);
      if (emptyBed) {
        emptyBed.patient = enriched;
      } else {
        targetRoom.beds.push({ bedCode: rawRoom, patient: enriched });
      }
      continue;
    }

    const newRoom = {
      roomNo: roomPrefix,
      roomType: '病室',
      beds: [{ bedCode: rawRoom, patient: enriched }]
    };
    rooms.push(newRoom);
    roomLookup.set(roomPrefix, newRoom);
  }

  if (unassigned.length > 0) {
    rooms.push({
      roomNo: '未割当',
      roomType: '病室未設定',
      beds: unassigned
    });
  }

  return rooms;
}

function getBedStatusList(departmentCode, allActivePatients) {
  const deptPatients = allActivePatients.filter((p) => p.careCategory === departmentCode);
  const rooms = buildBedRooms(departmentCode, deptPatients, null);
  const beds = [];
  for (const r of rooms) {
    if (r.roomNo === '未割当') continue;
    for (const b of r.beds) {
      beds.push({
        roomNo: r.roomNo,
        roomType: r.roomType,
        bedCode: b.bedCode,
        occupied: Boolean(b.patient),
        patientId: b.patient ? b.patient.patientId : '',
        patientName: b.patient ? b.patient.fullName : ''
      });
    }
  }
  return beds;
}

function findOccupant(allActivePatients, departmentCode, bedCode, excludePatientId) {
  const normalizedBed = String(bedCode || '').trim();
  if (!normalizedBed) return null;
  const beds = getBedStatusList(departmentCode, allActivePatients);
  const matched = beds.find((b) => b.bedCode === normalizedBed && b.occupied && b.patientId !== excludePatientId);
  return matched || null;
}

function syncSelectedPatientSession(req, updatedPatient) {
  if (!updatedPatient || !req.session.selectedPatient) return;
  if (req.session.selectedPatient.patientId === updatedPatient.patientId) {
    req.session.selectedPatient = {
      ...updatedPatient,
      careCategoryName: CATEGORY_LABEL_MAP[updatedPatient.careCategory] || updatedPatient.careCategory
    };
  }
}

router.get('/bedboard', requireAuth, (req, res) => {
  return res.redirect('/bedboard/ward');
});

router.get('/bedboard/:departmentCode', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const { departmentCode } = req.params;
    const department = getDepartmentByCode(departmentCode);

    if (!department || (departmentCode !== 'ward' && !isCareFacilityCode(departmentCode))) {
      return res.redirect(sessionUser.landingPath || '/login');
    }

    const effectiveRoleCode = getEffectiveRoleCode(sessionUser);
    const screen = resolveLandingScreen(effectiveRoleCode, departmentCode);

    req.session.user.departmentCode = department.code;
    req.session.user.departmentName = department.name;
    req.session.user.landingPath = `/bedboard/${department.code}`;
    req.session.user.screenTitle = `${department.name} ベッドボード`;

    const [allPatients, rxList, injList, radList, mealList, rehabList, recentMovements] = await Promise.all([
      patientRepository.findAll(),
      prescriptionRepository.findAll({ includeInactive: false }),
      injectionRepository.findAll({ includeInactive: false }),
      radiologyOrderRepository.findOrders({ status: 'ALL', includeInactive: false }),
      mealOrderRepository.findAll({ includeInactive: false }),
      rehabOrderRepository.findAll({ includeInactive: false }),
      bedMovementRepository.findRecent({ departmentCode, limit: 25 })
    ]);

    const activePatients = allPatients
      .filter((p) => p.isActive)
      .map((p) => ({
        ...p,
        careCategoryName: CATEGORY_LABEL_MAP[p.careCategory] || p.careCategory
      }));

    const wardPatients = activePatients
      .filter((p) => p.careCategory === departmentCode)
      .sort((a, b) => {
        const roomCmp = String(a.wardRoom || 'zzz').localeCompare(String(b.wardRoom || 'zzz'));
        if (roomCmp !== 0) return roomCmp;
        return a.patientId.localeCompare(b.patientId);
      });

    // 入床候補（外来患者・病室未割当患者を上位表示、他病棟在床患者も参照可）
    const admitCandidates = activePatients
      .filter((p) => !(p.careCategory === departmentCode && p.wardRoom))
      .sort((a, b) => {
        const score = (p) => (p.careCategory === 'outpatient' ? 0 : !p.wardRoom ? 1 : 2);
        const diff = score(a) - score(b);
        if (diff !== 0) return diff;
        return a.patientId.localeCompare(b.patientId);
      });

    const countMaps = {
      rx: buildOrderCountMap(rxList),
      inj: buildOrderCountMap(injList),
      rad: buildOrderCountMap(radList),
      meal: buildOrderCountMap(mealList),
      rehab: buildOrderCountMap(rehabList)
    };

    const rooms = buildBedRooms(departmentCode, wardPatients, countMaps);
    const totalBeds = rooms.reduce((sum, r) => sum + r.beds.length, 0);
    const occupiedBeds = wardPatients.length;
    const workspaceBasePath = `/workspace/${departmentCode}/${effectiveRoleCode}`;
    const selectedPatientId =
      req.session.selectedPatient && req.session.selectedPatient.patientId
        ? req.session.selectedPatient.patientId
        : '';

    const emptyBeds = [];
    for (const r of rooms) {
      if (r.roomNo === '未割当') continue;
      for (const b of r.beds) {
        if (!b.patient) {
          emptyBeds.push({ roomNo: r.roomNo, roomType: r.roomType, bedCode: b.bedCode });
        }
      }
    }

    res.render('bedboard', {
      statusBar: {
        screenTitle: `${department.name} ベッドボード`,
        patient: null,
        user: req.session.user,
        homePath: `/bedboard/${department.code}`,
        switchableMenus: getSwitchableMenus(req.session.user)
      },
      department,
      screen,
      rooms,
      totalBeds,
      occupiedBeds,
      emptyBeds,
      admitCandidates,
      inpatientDepartments: INPATIENT_DEPARTMENTS,
      recentMovements,
      workspaceBasePath,
      selectedPatientId
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 指定病棟のベッド一覧（空床・在床状況）取得
 */
router.get('/api/bedboard/available-beds', requireAuth, async (req, res, next) => {
  try {
    const departmentCode = String(req.query.departmentCode || 'ward').trim();
    if (!INPATIENT_DEPT_SET.has(departmentCode)) {
      return res.status(400).json({ ok: false, error: '対象病棟コードが正しくありません。' });
    }
    const allPatients = await patientRepository.findAll();
    const activePatients = allPatients.filter((p) => p.isActive);
    const beds = getBedStatusList(departmentCode, activePatients);
    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      departmentCode,
      departmentName: CATEGORY_LABEL_MAP[departmentCode] || departmentCode,
      beds,
      emptyBeds: beds.filter((b) => !b.occupied)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 移動履歴一覧（追記ログ）
 */
router.get('/api/bedboard/movements', requireAuth, async (req, res, next) => {
  try {
    const departmentCode = String(req.query.departmentCode || '').trim();
    const limit = Number(req.query.limit || 30);
    const movements = await bedMovementRepository.findRecent({
      departmentCode: departmentCode || undefined,
      limit
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, movements });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 入床 (POST /api/bedboard/admit)
 */
router.post('/api/bedboard/admit', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.body.patientId || '').trim();
    const departmentCode = String(req.body.departmentCode || '').trim();
    const bedCode = String(req.body.bedCode || '').trim();
    const reason = String(req.body.reason || '入床').trim();

    if (!patientId || !bedCode || !INPATIENT_DEPT_SET.has(departmentCode)) {
      return res.status(400).json({ ok: false, error: '対象患者・入床先病棟・ベッドを指定してください。' });
    }

    const allPatients = await patientRepository.findAll();
    const activePatients = allPatients.filter((p) => p.isActive);
    const patient = activePatients.find((p) => p.patientId === patientId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }

    const occupant = findOccupant(activePatients, departmentCode, bedCode, patientId);
    if (occupant) {
      return res.status(409).json({
        ok: false,
        error: `ベッド ${bedCode} はすでに [${occupant.patientId}] ${occupant.patientName} さんが在床中です。`
      });
    }

    const actor = formatActorForRecord(req.session.user);
    const fromDept = patient.careCategory || 'outpatient';
    const fromRoom = patient.wardRoom || '';

    const updated = await patientRepository.updatePatientLocation(patientId, departmentCode, bedCode, actor);
    syncSelectedPatientSession(req, updated);

    const movement = await bedMovementRepository.appendMovement({
      action: 'ADMIT',
      action_label: '入床',
      patient_id: patient.patientId,
      patient_name: patient.fullName,
      from_department: fromDept,
      from_department_name: CATEGORY_LABEL_MAP[fromDept] || fromDept,
      from_room: fromRoom,
      to_department: departmentCode,
      to_department_name: CATEGORY_LABEL_MAP[departmentCode] || departmentCode,
      to_room: bedCode,
      reason,
      actor,
      actor_staff_id: req.session.user.staffId
    });

    return res.json({ ok: true, patient: updated, movement });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 退床 (POST /api/bedboard/discharge)
 */
router.post('/api/bedboard/discharge', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.body.patientId || '').trim();
    const reason = String(req.body.reason || '退床').trim();

    if (!patientId) {
      return res.status(400).json({ ok: false, error: '対象患者を指定してください。' });
    }

    const patient = await patientRepository.findByPatientId(patientId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }

    const actor = formatActorForRecord(req.session.user);
    const fromDept = patient.careCategory || 'ward';
    const fromRoom = patient.wardRoom || '';

    const updated = await patientRepository.updatePatientLocation(patientId, 'outpatient', '', actor);
    syncSelectedPatientSession(req, updated);

    const movement = await bedMovementRepository.appendMovement({
      action: 'DISCHARGE',
      action_label: '退床',
      patient_id: patient.patientId,
      patient_name: patient.fullName,
      from_department: fromDept,
      from_department_name: CATEGORY_LABEL_MAP[fromDept] || fromDept,
      from_room: fromRoom,
      to_department: 'outpatient',
      to_department_name: CATEGORY_LABEL_MAP.outpatient || '外来',
      to_room: '',
      reason,
      actor,
      actor_staff_id: req.session.user.staffId
    });

    return res.json({ ok: true, patient: updated, movement });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 同病棟内移動 (POST /api/bedboard/move)
 */
router.post('/api/bedboard/move', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.body.patientId || '').trim();
    const departmentCode = String(req.body.departmentCode || '').trim();
    const targetBedCode = String(req.body.targetBedCode || '').trim();
    const reason = String(req.body.reason || '転床・転室').trim();

    if (!patientId || !targetBedCode || !INPATIENT_DEPT_SET.has(departmentCode)) {
      return res.status(400).json({ ok: false, error: '対象患者と移動先ベッドを指定してください。' });
    }

    const allPatients = await patientRepository.findAll();
    const activePatients = allPatients.filter((p) => p.isActive);
    const patient = activePatients.find((p) => p.patientId === patientId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }

    if (patient.careCategory === departmentCode && patient.wardRoom === targetBedCode) {
      return res.status(400).json({ ok: false, error: '現在と同じベッドが指定されています。' });
    }

    const occupant = findOccupant(activePatients, departmentCode, targetBedCode, patientId);
    if (occupant) {
      return res.status(409).json({
        ok: false,
        error: `移動先ベッド ${targetBedCode} はすでに [${occupant.patientId}] ${occupant.patientName} さんが在床中です。`
      });
    }

    const actor = formatActorForRecord(req.session.user);
    const fromDept = patient.careCategory || departmentCode;
    const fromRoom = patient.wardRoom || '';

    const updated = await patientRepository.updatePatientLocation(patientId, departmentCode, targetBedCode, actor);
    syncSelectedPatientSession(req, updated);

    const movement = await bedMovementRepository.appendMovement({
      action: 'MOVE',
      action_label: '移動',
      patient_id: patient.patientId,
      patient_name: patient.fullName,
      from_department: fromDept,
      from_department_name: CATEGORY_LABEL_MAP[fromDept] || fromDept,
      from_room: fromRoom,
      to_department: departmentCode,
      to_department_name: CATEGORY_LABEL_MAP[departmentCode] || departmentCode,
      to_room: targetBedCode,
      reason,
      actor,
      actor_staff_id: req.session.user.staffId
    });

    return res.json({ ok: true, patient: updated, movement });
  } catch (err) {
    next(err);
  }
});

/**
 * API: 他病棟移動 (POST /api/bedboard/transfer)
 */
router.post('/api/bedboard/transfer', requireAuth, async (req, res, next) => {
  try {
    const patientId = String(req.body.patientId || '').trim();
    const targetDepartmentCode = String(req.body.targetDepartmentCode || '').trim();
    const targetBedCode = String(req.body.targetBedCode || '').trim();
    const reason = String(req.body.reason || '他病棟移動').trim();

    if (!patientId || !INPATIENT_DEPT_SET.has(targetDepartmentCode) || !targetBedCode) {
      return res.status(400).json({ ok: false, error: '対象患者・移動先病棟・ベッドを指定してください。' });
    }

    const allPatients = await patientRepository.findAll();
    const activePatients = allPatients.filter((p) => p.isActive);
    const patient = activePatients.find((p) => p.patientId === patientId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: '対象患者が見つかりません。' });
    }

    if (patient.careCategory === targetDepartmentCode) {
      return res.status(400).json({ ok: false, error: '他病棟移動では現在と異なる病棟・フロアを選択してください。' });
    }

    const occupant = findOccupant(activePatients, targetDepartmentCode, targetBedCode, patientId);
    if (occupant) {
      return res.status(409).json({
        ok: false,
        error: `移動先ベッド ${targetBedCode} はすでに [${occupant.patientId}] ${occupant.patientName} さんが在床中です。`
      });
    }

    const actor = formatActorForRecord(req.session.user);
    const fromDept = patient.careCategory || '';
    const fromRoom = patient.wardRoom || '';

    const updated = await patientRepository.updatePatientLocation(
      patientId,
      targetDepartmentCode,
      targetBedCode,
      actor
    );
    syncSelectedPatientSession(req, updated);

    const movement = await bedMovementRepository.appendMovement({
      action: 'TRANSFER_WARD',
      action_label: '他病棟',
      patient_id: patient.patientId,
      patient_name: patient.fullName,
      from_department: fromDept,
      from_department_name: CATEGORY_LABEL_MAP[fromDept] || fromDept,
      from_room: fromRoom,
      to_department: targetDepartmentCode,
      to_department_name: CATEGORY_LABEL_MAP[targetDepartmentCode] || targetDepartmentCode,
      to_room: targetBedCode,
      reason,
      actor,
      actor_staff_id: req.session.user.staffId
    });

    return res.json({ ok: true, patient: updated, movement });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
