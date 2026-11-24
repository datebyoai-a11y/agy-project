'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const patientRepository = require('../repositories/patientRepository');
const radiologyOrderRepository = require('../repositories/radiologyOrderRepository');
const prescriptionRepository = require('../repositories/prescriptionRepository');
const injectionRepository = require('../repositories/injectionRepository');
const mealOrderRepository = require('../repositories/mealOrderRepository');
const rehabOrderRepository = require('../repositories/rehabOrderRepository');
const roleOrderRepository = require('../repositories/roleOrderRepository');
const {
  PATIENT_CATEGORIES,
  getDepartmentByCode,
  isCareFacilityCode,
  resolveLandingScreen,
  getSwitchableMenus,
  buildWorkspaceLeftMenu
} = require('../config/constants');
const { getEffectiveRoleCode } = require('../utils/actorHelper');

const router = express.Router();

const CATEGORY_LABEL_MAP = Object.fromEntries(PATIENT_CATEGORIES.map((c) => [c.code, c.name]));

router.get('/', (req, res) => {
  if (req.session && req.session.user && req.session.user.landingPath) {
    return res.redirect(req.session.user.landingPath);
  }
  return res.redirect('/login');
});

router.get('/menu', requireAuth, (req, res) => {
  return res.redirect(req.session.user.landingPath);
});

router.get('/workspace/:departmentCode/:roleCode', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const { departmentCode, roleCode } = req.params;
    const effectiveRoleCode = getEffectiveRoleCode(sessionUser);

    if (!getDepartmentByCode(departmentCode)) {
      return res.redirect(sessionUser.landingPath);
    }

    // 職種不一致の場合は現在の有効職種（権限代行時は医師）の同部署画面へ正規化
    if (roleCode !== effectiveRoleCode) {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return res.redirect(`/workspace/${departmentCode}/${effectiveRoleCode}${qs}`);
    }

    const screen = resolveLandingScreen(effectiveRoleCode, departmentCode);
    if (!screen) {
      return res.redirect(sessionUser.landingPath);
    }

    // セッションの現在部署を更新
    req.session.user.departmentCode = screen.departmentCode;
    req.session.user.departmentName = screen.departmentName;
    req.session.user.landingPath = screen.path;
    req.session.user.screenTitle = screen.title;

    const [allPatients, rolePerms] = await Promise.all([
      patientRepository.findAll(),
      roleOrderRepository.findAll()
    ]);

    const activePatients = allPatients
      .filter((p) => p.isActive)
      .map((p) => ({
        ...p,
        careCategoryName: CATEGORY_LABEL_MAP[p.careCategory] || p.careCategory
      }))
      // 現在部署（病棟・外来・介護医療院）に一致する患者を先頭に並べる
      .sort((a, b) => {
        const aMatch = a.careCategory === departmentCode ? 0 : 1;
        const bMatch = b.careCategory === departmentCode ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return a.patientId.localeCompare(b.patientId);
      });

    // 対象患者決定（クエリ優先 > セッション）
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

    // 医療病棟・介護医療院は患者未選択時はベッドボードへ遷移して患者を選択させる
    if ((departmentCode === 'ward' || isCareFacilityCode(departmentCode)) && !selectedPatient) {
      return res.redirect(`/bedboard/${departmentCode}`);
    }

    const leftMenuGroups = buildWorkspaceLeftMenu(departmentCode, effectiveRoleCode, rolePerms);

    // 全オーダー履歴（放射線・処方・注射・食事・リハビリ）を常時取得して中列へ時系列順で統合表示
    const isRadiologyLinked = true;
    const isClinicalDept =
      departmentCode === 'ward' ||
      departmentCode === 'outpatient' ||
      isCareFacilityCode(departmentCode);
    const deptLabel = CATEGORY_LABEL_MAP[departmentCode] || '';

    let radiologyOrders = [];
    let prescriptions = [];
    let injectionOrders = [];
    let mealOrders = [];
    let rehabOrders = [];

    if (selectedPatient) {
      [radiologyOrders, prescriptions, injectionOrders, mealOrders, rehabOrders] = await Promise.all([
        radiologyOrderRepository.findByPatientId(selectedPatient.patientId),
        prescriptionRepository.findByPatientId(selectedPatient.patientId),
        injectionRepository.findByPatientId(selectedPatient.patientId),
        mealOrderRepository.findByPatientId(selectedPatient.patientId),
        rehabOrderRepository.findByPatientId(selectedPatient.patientId)
      ]);
    } else {
      const [allRad, allRx, allInj, allMeals, allRehabs] = await Promise.all([
        radiologyOrderRepository.findOrders({ status: 'ALL', includeInactive: true }),
        prescriptionRepository.findAll({ includeInactive: true }),
        injectionRepository.findAll({ includeInactive: true }),
        mealOrderRepository.findAll({ includeInactive: true }),
        rehabOrderRepository.findAll({ includeInactive: true })
      ]);

      if (isClinicalDept) {
        const matchesDept = (rec) =>
          rec.ward === deptLabel ||
          (departmentCode === 'ward' && rec.ward === '病棟') ||
          rec.sourceDepartment === departmentCode;
        radiologyOrders = allRad.filter(matchesDept);
        prescriptions = allRx.filter(matchesDept);
        injectionOrders = allInj.filter(matchesDept);
        mealOrders = allMeals.filter(matchesDept);
        rehabOrders = allRehabs.filter(matchesDept);
      } else {
        radiologyOrders = allRad;
        prescriptions = allRx;
        injectionOrders = allInj;
        mealOrders = allMeals;
        rehabOrders = allRehabs;
      }
    }

    const activeRadiologyCount = radiologyOrders.filter(
      (o) => !o.isCancelled && !o.isSuperseded
    ).length;
    const activePrescriptionCount = prescriptions.filter(
      (rx) => !rx.isCancelled && !rx.isSuperseded
    ).length;
    const activeInjectionCount = injectionOrders.filter(
      (inj) => !inj.isCancelled && !inj.isSuperseded
    ).length;
    const activeMealCount = mealOrders.filter(
      (m) => !m.isCancelled && !m.isSuperseded
    ).length;
    const activeRehabCount = rehabOrders.filter(
      (r) => !r.isCancelled && !r.isSuperseded
    ).length;

    const toSortMs = (val) => {
      if (!val) return 0;
      const t = new Date(val).getTime();
      return Number.isNaN(t) ? 0 : t;
    };

    const combinedHistory = [
      ...prescriptions.map((rx) => ({
        kind: 'rx',
        sortMs: toSortMs(rx.createdAt || rx.startDate),
        data: rx
      })),
      ...injectionOrders.map((inj) => ({
        kind: 'inj',
        sortMs: toSortMs(inj.createdAt || inj.startDate),
        data: inj
      })),
      ...radiologyOrders.map((o) => ({
        kind: 'rad',
        sortMs: toSortMs(o.createdAt || o.scheduledDate),
        data: o
      })),
      ...mealOrders.map((m) => ({
        kind: 'meal',
        sortMs: toSortMs(m.createdAt || m.startDate),
        data: m
      })),
      ...rehabOrders.map((r) => ({
        kind: 'rehab',
        sortMs: toSortMs(r.createdAt || r.orderDate),
        data: r
      }))
    ].sort((a, b) => b.sortMs - a.sortMs);

    const radPerm = rolePerms.find(
      (p) => p.roleCode === effectiveRoleCode && p.orderTypeCode === 'radiology'
    ) || { canCreate: false, canExecute: false };

    const switchableMenus = getSwitchableMenus(req.session.user);
    const statusBarPatient = selectedPatient
      ? {
          id: `${selectedPatient.patientId} ${selectedPatient.fullName}`,
          birthDate: selectedPatient.birthDate || '----/--/--',
          age: selectedPatient.age != null ? selectedPatient.age : '--',
          allergies: selectedPatient.allergies || '',
          cautions: selectedPatient.cautions || ''
        }
      : {
          id: '未選択',
          birthDate: '----/--/--',
          age: '--',
          allergies: '',
          cautions: ''
        };

    res.render('workspace', {
      statusBar: {
        screenTitle: screen.title,
        patient: statusBarPatient,
        user: req.session.user,
        homePath: screen.path,
        switchableMenus
      },
      screen,
      leftMenuGroups,
      patients: activePatients,
      selectedPatient,
      isRadiologyLinked,
      radiologyOrders,
      activeRadiologyCount,
      prescriptions,
      activePrescriptionCount,
      injectionOrders,
      activeInjectionCount,
      mealOrders,
      activeMealCount,
      rehabOrders,
      activeRehabCount,
      combinedHistory,
      radPerm
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
