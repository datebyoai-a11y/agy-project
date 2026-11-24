'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const userRepository = require('../repositories/userRepository');
const roleOrderRepository = require('../repositories/roleOrderRepository');
const patientRepository = require('../repositories/patientRepository');
const {
  DEPARTMENTS,
  ROLES,
  ORDER_TYPES,
  DEFAULT_ROLE_ORDER_PERMISSIONS,
  getDepartmentByCode,
  getRoleByCode,
  getSwitchableMenus
} = require('../config/constants');

const router = express.Router();

const VALID_ROLE_CODES = new Set(ROLES.map((r) => r.code));
const VALID_DEPT_CODES = new Set(DEPARTMENTS.map((d) => d.code));
const VALID_ORDER_CODES = new Set(ORDER_TYPES.map((o) => o.code));

function sanitizeUser(u) {
  const role = getRoleByCode(u.roleCode);
  const dept = getDepartmentByCode(u.defaultDepartmentCode);
  return {
    staffId: u.staffId,
    fullName: u.fullName,
    roleCode: u.roleCode,
    roleName: role ? role.name : u.roleCode,
    defaultDepartmentCode: u.defaultDepartmentCode,
    defaultDepartmentName: dept ? dept.name : u.defaultDepartmentCode,
    allowedDepartmentCodes: u.allowedDepartmentCodes,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt
  };
}

function normalizeAllowedDepartments(defaultDept, rawAllowed) {
  const list = Array.isArray(rawAllowed)
    ? rawAllowed.map((v) => String(v).trim()).filter((v) => VALID_DEPT_CODES.has(v))
    : [];
  if (!list.includes(defaultDept)) {
    list.unshift(defaultDept);
  }
  return Array.from(new Set(list));
}

function buildPermissionMap(permissions) {
  const map = {};
  for (const p of permissions) {
    map[`${p.roleCode}:${p.orderTypeCode}`] = {
      canCreate: Boolean(p.canCreate),
      canExecute: Boolean(p.canExecute)
    };
  }
  return map;
}

router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const [users, permissions] = await Promise.all([
      userRepository.findAll(),
      roleOrderRepository.findAll()
    ]);

    const sessionUser = req.session.user;
    const switchableMenus = getSwitchableMenus(sessionUser);
    let selectedPatient = null;
    if (req.session.selectedPatient && req.session.selectedPatient.patientId) {
      selectedPatient =
        (await patientRepository.findByPatientId(req.session.selectedPatient.patientId)) ||
        req.session.selectedPatient;
    }

    res.render('users', {
      statusBar: {
        screenTitle: 'ユーザー管理',
        patient: selectedPatient
          ? {
              id: `${selectedPatient.patientId} ${selectedPatient.fullName}`,
              birthDate: selectedPatient.birthDate || '----/--/--',
              age: selectedPatient.age != null ? selectedPatient.age : '--',
              allergies: selectedPatient.allergies || '',
              cautions: selectedPatient.cautions || ''
            }
          : null,
        user: sessionUser,
        homePath: sessionUser.landingPath,
        switchableMenus
      },
      users: users.map(sanitizeUser),
      departments: DEPARTMENTS,
      roles: ROLES,
      orderTypes: ORDER_TYPES,
      permissionMap: buildPermissionMap(permissions),
      currentStaffId: sessionUser.staffId
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/users', requireAuth, async (req, res, next) => {
  try {
    const users = await userRepository.findAll();
    return res.json({ ok: true, users: users.map(sanitizeUser) });
  } catch (err) {
    next(err);
  }
});

router.post('/api/users', requireAuth, async (req, res, next) => {
  try {
    const staffId = String(req.body.staffId || '').trim();
    const fullName = String(req.body.fullName || '').trim();
    const password = String(req.body.password || '');
    const roleCode = String(req.body.roleCode || '').trim();
    const defaultDepartmentCode = String(req.body.defaultDepartmentCode || '').trim();
    const isActive = req.body.isActive !== false && req.body.isActive !== 'false';

    if (!staffId || !/^[a-zA-Z0-9_-]{2,32}$/.test(staffId)) {
      return res.status(400).json({ ok: false, error: '職員IDは半角英数字・_-で2〜32文字で入力してください。' });
    }
    if (!fullName) {
      return res.status(400).json({ ok: false, error: '氏名を入力してください。' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ ok: false, error: 'パスワードは4文字以上で入力してください。' });
    }
    if (!VALID_ROLE_CODES.has(roleCode)) {
      return res.status(400).json({ ok: false, error: '職種が正しくありません。' });
    }
    if (!VALID_DEPT_CODES.has(defaultDepartmentCode)) {
      return res.status(400).json({ ok: false, error: '主所属部署が正しくありません。' });
    }

    const existing = await userRepository.findByStaffId(staffId);
    if (existing) {
      return res.status(409).json({ ok: false, error: `職員ID「${staffId}」は既に登録されています。` });
    }

    const allowedDepartmentCodes = normalizeAllowedDepartments(
      defaultDepartmentCode,
      req.body.allowedDepartmentCodes
    );
    const passwordHash = await bcrypt.hash(password, 10);

    const created = await userRepository.createUser({
      staff_id: staffId,
      full_name: fullName,
      password_hash: passwordHash,
      role_code: roleCode,
      default_department_code: defaultDepartmentCode,
      allowed_department_codes: allowedDepartmentCodes,
      is_active: isActive
    });

    return res.status(201).json({ ok: true, user: sanitizeUser(created) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: '同じ職員IDが既に存在します。' });
    }
    next(err);
  }
});

router.put('/api/users/:staffId', requireAuth, async (req, res, next) => {
  try {
    const staffId = String(req.params.staffId || '').trim();
    const existing = await userRepository.findByStaffId(staffId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: '対象ユーザーが見つかりません。' });
    }

    const fullName = String(req.body.fullName || '').trim();
    const roleCode = String(req.body.roleCode || '').trim();
    const defaultDepartmentCode = String(req.body.defaultDepartmentCode || '').trim();
    const newPassword = String(req.body.password || '');
    const isActive = req.body.isActive !== false && req.body.isActive !== 'false';

    if (!fullName) {
      return res.status(400).json({ ok: false, error: '氏名を入力してください。' });
    }
    if (!VALID_ROLE_CODES.has(roleCode)) {
      return res.status(400).json({ ok: false, error: '職種が正しくありません。' });
    }
    if (!VALID_DEPT_CODES.has(defaultDepartmentCode)) {
      return res.status(400).json({ ok: false, error: '主所属部署が正しくありません。' });
    }
    if (newPassword && newPassword.length < 4) {
      return res.status(400).json({ ok: false, error: '新しいパスワードは4文字以上で入力してください。' });
    }
    if (staffId === req.session.user.staffId && !isActive) {
      return res.status(400).json({ ok: false, error: '現在ログイン中の自身のアカウントは無効化できません。' });
    }

    const allowedDepartmentCodes = normalizeAllowedDepartments(
      defaultDepartmentCode,
      req.body.allowedDepartmentCodes
    );

    const updates = {
      full_name: fullName,
      role_code: roleCode,
      default_department_code: defaultDepartmentCode,
      allowed_department_codes: allowedDepartmentCodes,
      is_active: isActive
    };

    if (newPassword) {
      updates.password_hash = await bcrypt.hash(newPassword, 10);
    }

    const updated = await userRepository.updateUser(staffId, updates);
    return res.json({ ok: true, user: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});

router.patch('/api/users/:staffId/active', requireAuth, async (req, res, next) => {
  try {
    const staffId = String(req.params.staffId || '').trim();
    const isActive = req.body.isActive === true || req.body.isActive === 'true';

    if (staffId === req.session.user.staffId && !isActive) {
      return res.status(400).json({ ok: false, error: '現在ログイン中の自身のアカウントは無効化できません。' });
    }

    const updated = await userRepository.setUserActive(staffId, isActive);
    if (!updated) {
      return res.status(404).json({ ok: false, error: '対象ユーザーが見つかりません。' });
    }
    return res.json({ ok: true, user: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});

router.get('/api/role-orders', requireAuth, async (req, res, next) => {
  try {
    const permissions = await roleOrderRepository.findAll();
    return res.json({ ok: true, permissions });
  } catch (err) {
    next(err);
  }
});

router.put('/api/role-orders', requireAuth, async (req, res, next) => {
  try {
    const rawItems = Array.isArray(req.body.permissions) ? req.body.permissions : null;
    if (!rawItems) {
      return res.status(400).json({ ok: false, error: '権限データが不正です。' });
    }

    const sanitized = [];
    for (const item of rawItems) {
      const roleCode = String(item.roleCode || '').trim();
      const orderTypeCode = String(item.orderTypeCode || '').trim();
      if (!VALID_ROLE_CODES.has(roleCode) || !VALID_ORDER_CODES.has(orderTypeCode)) {
        return res.status(400).json({ ok: false, error: `不正な職種またはオーダー種別です (${roleCode}:${orderTypeCode})。` });
      }
      sanitized.push({
        roleCode,
        orderTypeCode,
        canCreate: Boolean(item.canCreate),
        canExecute: Boolean(item.canExecute)
      });
    }

    const saved = await roleOrderRepository.saveMatrix(sanitized, req.session.user.staffId);
    return res.json({ ok: true, permissions: saved });
  } catch (err) {
    next(err);
  }
});

router.post('/api/role-orders/reset', requireAuth, async (req, res, next) => {
  try {
    const entries = DEFAULT_ROLE_ORDER_PERMISSIONS.map((d) => ({
      roleCode: d.role_code,
      orderTypeCode: d.order_type_code,
      canCreate: d.can_create,
      canExecute: d.can_execute
    }));
    const saved = await roleOrderRepository.saveMatrix(entries, req.session.user.staffId);
    return res.json({ ok: true, permissions: saved });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
