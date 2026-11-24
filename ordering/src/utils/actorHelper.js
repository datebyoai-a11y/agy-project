'use strict';

function getEffectiveRoleCode(sessionUser) {
  if (!sessionUser) return '';
  return sessionUser.elevatedDoctor ? 'doctor' : sessionUser.roleCode;
}

function getEffectiveAllowedDepartments(sessionUser) {
  if (!sessionUser) return [];
  const base = Array.isArray(sessionUser.allowedDepartmentCodes) && sessionUser.allowedDepartmentCodes.length > 0
    ? sessionUser.allowedDepartmentCodes
    : [sessionUser.departmentCode].filter(Boolean);
  const docDepts =
    sessionUser.elevatedDoctor && Array.isArray(sessionUser.elevatedDoctor.allowedDepartmentCodes)
      ? sessionUser.elevatedDoctor.allowedDepartmentCodes
      : [];
  return Array.from(new Set([...base, ...docDepts]));
}

/**
 * 記録・伝票・履歴に表示する担当者表記を生成する。
 * - 通常時: 医師/職員の氏名
 * - 権限代行時: 「代行医師名（代行: 操作職員名/職種）」のように両方を明記
 */
function formatActorForRecord(sessionUser, overrideDoctorName) {
  const custom = String(overrideDoctorName || '').trim();
  if (!sessionUser) return custom || '担当医師';

  if (sessionUser.elevatedDoctor) {
    const docName = custom || sessionUser.elevatedDoctor.fullName || '担当医師';
    const proxySuffix = `（代行: ${sessionUser.fullName}/${sessionUser.roleName}）`;
    if (docName.includes('（代行:')) {
      return docName;
    }
    return `${docName}${proxySuffix}`;
  }

  return custom || sessionUser.fullName || sessionUser.staffId || '担当医師';
}

function buildElevationMeta(sessionUser) {
  if (!sessionUser) {
    return {
      elevated_doctor_staff_id: '',
      elevated_doctor_name: '',
      operator_staff_id: '',
      operator_name: '',
      operator_role_name: ''
    };
  }
  return {
    elevated_doctor_staff_id: sessionUser.elevatedDoctor ? sessionUser.elevatedDoctor.staffId : '',
    elevated_doctor_name: sessionUser.elevatedDoctor ? sessionUser.elevatedDoctor.fullName : '',
    operator_staff_id: sessionUser.staffId || '',
    operator_name: sessionUser.fullName || '',
    operator_role_name: sessionUser.roleName || ''
  };
}

module.exports = {
  getEffectiveRoleCode,
  getEffectiveAllowedDepartments,
  formatActorForRecord,
  buildElevationMeta
};
