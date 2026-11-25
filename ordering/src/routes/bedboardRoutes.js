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

// 実機アイホンフロアマップ準拠（2F: 医療病棟 / 3F: 介護医療院しおかぜ / 4F: 介護医療院うみかぜ）
const FLOOR_META = {
  ward: { floor: '2', floorLabel: '2F', theme: 'floor-2', name: CATEGORY_LABEL_MAP.ward || '医療病棟' },
  care_shiokaze: {
    floor: '3',
    floorLabel: '3F',
    theme: 'floor-3',
    name: CATEGORY_LABEL_MAP.care_shiokaze || '介護医療院(しおかぜ)'
  },
  care_umikaze: {
    floor: '4',
    floorLabel: '4F',
    theme: 'floor-4',
    name: CATEGORY_LABEL_MAP.care_umikaze || '介護医療院(うみかぜ)'
  }
};

const INPATIENT_DEPARTMENTS = [
  { code: 'ward', name: `2F ${FLOOR_META.ward.name}` },
  { code: 'care_shiokaze', name: `3F ${FLOOR_META.care_shiokaze.name}` },
  { code: 'care_umikaze', name: `4F ${FLOOR_META.care_umikaze.name}` }
];

const INPATIENT_DEPT_SET = new Set(INPATIENT_DEPARTMENTS.map((d) => d.code));

/**
 * 実機写真（IMG_20261002_094618497_HDR.jpg / IMG_20261002_101624869_HDR.jpg）準拠の
 * 2F医療病棟（20部屋・62床）および 3Fしおかぜ・4Fうみかぜ（21部屋・60床）の病室定義を生成する。
 */
function createFloorRooms(departmentCode) {
  const meta = FLOOR_META[departmentCode] || FLOOR_META.ward;
  const f = meta.floor;
  const is2F = f === '2';

  const makeRoom = (num, roomType, isPrivate, wing, group) => {
    const roomNo = `${f}${num}`;
    const beds = isPrivate ? [`${roomNo}-1`] : [`${roomNo}-1`, `${roomNo}-2`, `${roomNo}-3`, `${roomNo}-4`];
    return { roomNo, roomType, isPrivate, wing, group, beds };
  };

  if (is2F) {
    // 2F医療病棟: 20部屋・計62床
    return [
      // 左翼（215, 213, 212, 211, [208, 207, 206], 205, 203, 202, 201）
      makeRoom('15', '個室(トイレ付)', true, 'left', 'top'),
      makeRoom('13', '4人部屋', false, 'left', 'top'),
      makeRoom('12', '4人部屋', false, 'left', 'top'),
      makeRoom('11', '4人部屋', false, 'left', 'top'),
      makeRoom('08', '個室', true, 'left', 'priv-row'),
      makeRoom('07', '個室', true, 'left', 'priv-row'),
      makeRoom('06', '個室', true, 'left', 'priv-row'),
      makeRoom('05', '4人部屋', false, 'left', 'bottom'),
      makeRoom('03', '4人部屋', false, 'left', 'bottom'),
      makeRoom('02', '4人部屋', false, 'left', 'bottom'),
      makeRoom('01', '4人部屋', false, 'left', 'bottom'),
      // 中央コア上部（216, 217）
      makeRoom('16', '個室(トイレ付)', true, 'center', 'center-top'),
      makeRoom('17', '個室(トイレ付)', true, 'center', 'center-top'),
      // 右翼（218, 220, 221, 222, [食堂兼談話室], 223, 225, 226）
      makeRoom('18', '4人部屋', false, 'right', 'right-top'),
      makeRoom('20', '4人部屋', false, 'right', 'right-top'),
      makeRoom('21', '4人部屋', false, 'right', 'right-top'),
      makeRoom('22', '4人部屋', false, 'right', 'right-top'),
      makeRoom('23', '4人部屋', false, 'right', 'right-bottom'),
      makeRoom('25', '4人部屋', false, 'right', 'right-bottom'),
      makeRoom('26', '4人部屋', false, 'right', 'right-bottom')
    ];
  }

  // 3Fしおかぜ / 4Fうみかぜ: 21部屋・計60床（実機写真完全準拠）
  return [
    // 左翼（x15, x13, x12, [x11, x10, x08, x07, x06], x05, x03, x02, x01）
    makeRoom('15', '個室(トイレ付)', true, 'left', 'top'),
    makeRoom('13', '4人部屋', false, 'left', 'top'),
    makeRoom('12', '4人部屋', false, 'left', 'top'),
    makeRoom('11', '個室', true, 'left', 'priv-row'),
    makeRoom('10', '個室', true, 'left', 'priv-row'),
    makeRoom('08', '個室', true, 'left', 'priv-row'),
    makeRoom('07', '個室', true, 'left', 'priv-row'),
    makeRoom('06', '個室', true, 'left', 'priv-row'),
    makeRoom('05', '4人部屋', false, 'left', 'bottom'),
    makeRoom('03', '4人部屋', false, 'left', 'bottom'),
    makeRoom('02', '4人部屋', false, 'left', 'bottom'),
    makeRoom('01', '4人部屋', false, 'left', 'bottom'),
    // 中央コア上部（x16, x17）
    makeRoom('16', '個室(トイレ付)', true, 'center', 'center-top'),
    makeRoom('17', '個室(トイレ付)', true, 'center', 'center-top'),
    // 右翼（x18, x20, x21, x22, [食堂兼談話室], x23, x25, x26）
    makeRoom('18', '4人部屋', false, 'right', 'right-top'),
    makeRoom('20', '4人部屋', false, 'right', 'right-top'),
    makeRoom('21', '4人部屋', false, 'right', 'right-top'),
    makeRoom('22', '4人部屋', false, 'right', 'right-top'),
    makeRoom('23', '4人部屋', false, 'right', 'right-bottom'),
    makeRoom('25', '4人部屋', false, 'right', 'right-bottom'),
    makeRoom('26', '4人部屋', false, 'right', 'right-bottom')
  ];
}

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
  const template = createFloorRooms(departmentCode);
  const rooms = template.map((r) => ({
    roomNo: r.roomNo,
    roomType: r.roomType,
    isPrivate: r.isPrivate,
    wing: r.wing,
    group: r.group,
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

  const extraRooms = [];
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

    // 定義外の病室番号（例: 旧設定番号）は中央下部の補助枠へ表示して見落としを防止
    let extra = extraRooms.find((r) => r.roomNo === roomPrefix);
    if (!extra) {
      extra = {
        roomNo: roomPrefix,
        roomType: 'その他病室',
        isPrivate: true,
        wing: 'extra',
        group: 'extra',
        beds: []
      };
      extraRooms.push(extra);
    }
    extra.beds.push({ bedCode: rawRoom, patient: enriched });
  }

  for (const ex of extraRooms) {
    rooms.push(ex);
  }

  if (unassigned.length > 0) {
    rooms.push({
      roomNo: '未割当',
      roomType: '病室未設定',
      isPrivate: false,
      wing: 'extra',
      group: 'extra',
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
    if (r.wing === 'extra') continue;
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

    const floorMeta = FLOOR_META[departmentCode] || FLOOR_META.ward;
    const effectiveRoleCode = getEffectiveRoleCode(sessionUser);
    const screen = resolveLandingScreen(effectiveRoleCode, departmentCode);

    const screenTitle = `${floorMeta.floorLabel} ${department.name} ベッドボード`;
    req.session.user.departmentCode = department.code;
    req.session.user.departmentName = department.name;
    req.session.user.landingPath = `/bedboard/${department.code}`;
    req.session.user.screenTitle = screenTitle;

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
    const standardRooms = rooms.filter((r) => r.wing !== 'extra');
    const totalBeds = standardRooms.reduce((sum, r) => sum + r.beds.length, 0);
    const occupiedBeds = wardPatients.length;
    const emptyBedCount = Math.max(totalBeds - occupiedBeds, 0);
    const maleCount = wardPatients.filter((p) => p.gender === '男').length;
    const femaleCount = wardPatients.filter((p) => p.gender === '女').length;
    const occupancyRate = totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(1) : '0.0';

    const workspaceBasePath = `/workspace/${departmentCode}/${effectiveRoleCode}`;
    const selectedPatientId =
      req.session.selectedPatient && req.session.selectedPatient.patientId
        ? req.session.selectedPatient.patientId
        : '';

    const emptyBeds = [];
    for (const r of standardRooms) {
      for (const b of r.beds) {
        if (!b.patient) {
          emptyBeds.push({ roomNo: r.roomNo, roomType: r.roomType, bedCode: b.bedCode });
        }
      }
    }

    const wingGroups = {
      leftTop: rooms.filter((r) => r.wing === 'left' && r.group === 'top'),
      leftPrivRow: rooms.filter((r) => r.wing === 'left' && r.group === 'priv-row'),
      leftBottom: rooms.filter((r) => r.wing === 'left' && r.group === 'bottom'),
      centerTop: rooms.filter((r) => r.wing === 'center' && r.group === 'center-top'),
      rightTop: rooms.filter((r) => r.wing === 'right' && r.group === 'right-top'),
      rightBottom: rooms.filter((r) => r.wing === 'right' && r.group === 'right-bottom'),
      extra: rooms.filter((r) => r.wing === 'extra')
    };

    res.render('bedboard', {
      statusBar: {
        screenTitle,
        patient: null,
        user: req.session.user,
        homePath: `/bedboard/${department.code}`,
        switchableMenus: getSwitchableMenus(req.session.user)
      },
      department,
      floorMeta,
      screen,
      rooms,
      wingGroups,
      stats: {
        totalBeds,
        occupiedBeds,
        emptyBedCount,
        maleCount,
        femaleCount,
        occupancyRate
      },
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
