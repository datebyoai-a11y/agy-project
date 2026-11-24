'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');
const {
  DEPARTMENTS,
  ROLES,
  getDepartmentByCode,
  getRoleByCode,
  resolveLandingScreen
} = require('../config/constants');
const { requireAuth, redirectIfAuthenticated } = require('../middleware/auth');
const { getEffectiveAllowedDepartments } = require('../utils/actorHelper');

const router = express.Router();

async function getDemoAccountList() {
  const users = await userRepository.findAllActive();
  return users.map((u) => {
    const role = getRoleByCode(u.roleCode);
    const dept = getDepartmentByCode(u.defaultDepartmentCode);
    return {
      staffId: u.staffId,
      fullName: u.fullName,
      roleCode: u.roleCode,
      roleName: role ? role.name : u.roleCode,
      defaultDepartmentCode: u.defaultDepartmentCode,
      defaultDepartmentName: dept ? dept.name : u.defaultDepartmentCode,
      allowedDepartmentCodes: u.allowedDepartmentCodes
    };
  });
}

function wantsJson(req) {
  const accept = req.headers.accept || '';
  return req.is('application/json') || (accept.includes('application/json') && !accept.includes('text/html'));
}

router.get('/login', redirectIfAuthenticated, async (req, res, next) => {
  try {
    const demoAccounts = await getDemoAccountList();
    res.render('login', {
      statusBar: {
        screenTitle: 'ログイン',
        patient: null,
        user: null,
        homePath: '/login',
        switchableMenus: []
      },
      departments: DEPARTMENTS,
      roles: ROLES,
      demoAccounts,
      errorMessage: null,
      formValues: {
        staffId: '',
        departmentCode: ''
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  const staffId = String(req.body.staffId || '').trim();
  const password = String(req.body.password || '');
  const requestedDeptCode = String(req.body.departmentCode || '').trim();

  const renderError = async (statusCode, message) => {
    if (wantsJson(req)) {
      return res.status(statusCode).json({ ok: false, error: message });
    }
    const demoAccounts = await getDemoAccountList();
    return res.status(statusCode).render('login', {
      statusBar: {
        screenTitle: 'ログイン',
        patient: null,
        user: null,
        homePath: '/login',
        switchableMenus: []
      },
      departments: DEPARTMENTS,
      roles: ROLES,
      demoAccounts,
      errorMessage: message,
      formValues: {
        staffId,
        departmentCode: requestedDeptCode
      }
    });
  };

  try {
    if (!staffId || !password) {
      return await renderError(400, '職員IDとパスワードを入力してください。');
    }

    const user = await userRepository.findByStaffId(staffId);
    if (!user || !user.isActive) {
      return await renderError(401, '職員IDまたはパスワードが正しくありません。');
    }

    const matched = await bcrypt.compare(password, user.passwordHash);
    if (!matched) {
      return await renderError(401, '職員IDまたはパスワードが正しくありません。');
    }

    const targetDeptCode = requestedDeptCode || user.defaultDepartmentCode;
    const department = getDepartmentByCode(targetDeptCode);
    if (!department) {
      return await renderError(400, '選択された部署が正しくありません。');
    }

    if (!user.allowedDepartmentCodes.includes(targetDeptCode)) {
      const allowedNames = user.allowedDepartmentCodes
        .map((code) => {
          const d = getDepartmentByCode(code);
          return d ? d.name : code;
        })
        .join('・');
      return await renderError(
        403,
        `このアカウントでは「${department.name}」へログインできません（許可部署: ${allowedNames}）。`
      );
    }

    const landing = resolveLandingScreen(user.roleCode, targetDeptCode);
    if (!landing) {
      return await renderError(500, '遷移先画面の解決に失敗しました。');
    }

    await userRepository.updateLastLogin(user.staffId, targetDeptCode);

    const sessionUser = {
      staffId: user.staffId,
      fullName: user.fullName,
      roleCode: landing.roleCode,
      roleName: landing.roleName,
      defaultDepartmentCode: user.defaultDepartmentCode,
      departmentCode: landing.departmentCode,
      departmentName: landing.departmentName,
      allowedDepartmentCodes: user.allowedDepartmentCodes,
      landingPath: landing.path,
      screenTitle: landing.title,
      elevatedDoctor: null
    };

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return next(regenErr);
      }
      req.session.user = sessionUser;
      req.session.save((saveErr) => {
        if (saveErr) {
          return next(saveErr);
        }
        if (wantsJson(req)) {
          return res.json({ ok: true, redirectTo: landing.path, user: sessionUser });
        }
        return res.redirect(landing.path);
      });
    });
  } catch (err) {
    next(err);
  }
});

function handleLogout(req, res) {
  req.session.destroy(() => {
    res.clearCookie('ordering.sid');
    if (wantsJson(req)) {
      return res.json({ ok: true });
    }
    return res.redirect('/login');
  });
}

router.post('/logout', handleLogout);
router.get('/logout', handleLogout);

router.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: req.session.user });
});

router.get('/api/auth/doctors', requireAuth, async (req, res, next) => {
  try {
    const doctors = await userRepository.findActiveDoctors();
    return res.json({
      ok: true,
      doctors: doctors.map((d) => ({
        staffId: d.staffId,
        fullName: d.fullName,
        defaultDepartmentCode: d.defaultDepartmentCode,
        allowedDepartmentCodes: d.allowedDepartmentCodes
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/auth/elevate', requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    const doctorStaffId = String(req.body.doctorStaffId || '').trim();
    if (!doctorStaffId) {
      return res.status(400).json({ ok: false, error: '代行先の医師を選択してください。' });
    }

    const doctor = await userRepository.findByStaffId(doctorStaffId);
    if (!doctor || !doctor.isActive || doctor.roleCode !== 'doctor') {
      return res.status(400).json({ ok: false, error: '指定された医師アカウントが見つからないか無効です。' });
    }

    sessionUser.elevatedDoctor = {
      staffId: doctor.staffId,
      fullName: doctor.fullName,
      roleCode: 'doctor',
      roleName: '医師',
      defaultDepartmentCode: doctor.defaultDepartmentCode,
      allowedDepartmentCodes: doctor.allowedDepartmentCodes
    };

    const effectiveAllowed = getEffectiveAllowedDepartments(sessionUser);
    const doctorClinicalDepts = new Set(['outpatient', 'ward', 'care_umikaze', 'care_shiokaze', 'rehabilitation']);
    const targetDept =
      doctorClinicalDepts.has(sessionUser.departmentCode) && effectiveAllowed.includes(sessionUser.departmentCode)
        ? sessionUser.departmentCode
        : doctor.defaultDepartmentCode;

    const landing = resolveLandingScreen('doctor', targetDept);
    if (landing) {
      sessionUser.departmentCode = landing.departmentCode;
      sessionUser.departmentName = landing.departmentName;
      sessionUser.landingPath = landing.path;
      sessionUser.screenTitle = landing.title;
    }

    req.session.save((err) => {
      if (err) return next(err);
      return res.json({
        ok: true,
        user: sessionUser,
        redirectTo: sessionUser.landingPath,
        workspacePath: landing ? landing.workspacePath : sessionUser.landingPath
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/auth/elevate/clear', requireAuth, (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    sessionUser.elevatedDoctor = null;

    const origAllowed = Array.isArray(sessionUser.allowedDepartmentCodes) && sessionUser.allowedDepartmentCodes.length > 0
      ? sessionUser.allowedDepartmentCodes
      : [sessionUser.defaultDepartmentCode || sessionUser.departmentCode];
    const targetDept = origAllowed.includes(sessionUser.departmentCode)
      ? sessionUser.departmentCode
      : (sessionUser.defaultDepartmentCode || origAllowed[0]);

    const landing = resolveLandingScreen(sessionUser.roleCode, targetDept);
    if (landing) {
      sessionUser.departmentCode = landing.departmentCode;
      sessionUser.departmentName = landing.departmentName;
      sessionUser.landingPath = landing.path;
      sessionUser.screenTitle = landing.title;
    }

    req.session.save((err) => {
      if (err) return next(err);
      return res.json({
        ok: true,
        user: sessionUser,
        redirectTo: sessionUser.landingPath,
        workspacePath: landing ? landing.workspacePath : sessionUser.landingPath
      });
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
