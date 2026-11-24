'use strict';

// 部署マスタ（9部署: 介護医療院はうみかぜ・しおかぜに分離）
const DEPARTMENTS = [
  { code: 'outpatient', name: '外来' },
  { code: 'ward', name: '医療病棟' },
  { code: 'care_umikaze', name: '介護医療院(うみかぜ)' },
  { code: 'care_shiokaze', name: '介護医療院(しおかぜ)' },
  { code: 'rehabilitation', name: 'リハビリ科' },
  { code: 'radiology', name: '放射線科' },
  { code: 'pharmacy', name: '薬剤部' },
  { code: 'nutrition', name: '栄養科' },
  { code: 'medical_affairs', name: '医事課' }
];

// 職種マスタ（6職種）
const ROLES = [
  { code: 'doctor', name: '医師' },
  { code: 'nurse', name: '看護師' },
  { code: 'pharmacist', name: '薬剤師' },
  { code: 'radiographer', name: '放射線技師' },
  { code: 'dietitian', name: '栄養士' },
  { code: 'clerk', name: '事務職員' }
];

// オーダー種別マスタ（8種別）
const ORDER_TYPES = [
  { code: 'prescription', name: '処方' },
  { code: 'injection', name: '注射・点滴' },
  { code: 'radiology', name: '放射線検査' },
  { code: 'lab', name: '検体・生理検査' },
  { code: 'rehabilitation', name: 'リハビリ' },
  { code: 'meal', name: '食事・栄養' },
  { code: 'nursing_care', name: '看護・処置' },
  { code: 'admission_discharge', name: '入退院・受付' }
];

// 患者区分・基本マスタ
const PATIENT_CATEGORIES = [
  { code: 'outpatient', name: '外来' },
  { code: 'ward', name: '医療病棟' },
  { code: 'care_umikaze', name: '介護医療院(うみかぜ)' },
  { code: 'care_shiokaze', name: '介護医療院(しおかぜ)' }
];

function isCareFacilityCode(code) {
  return code === 'care_umikaze' || code === 'care_shiokaze' || code === 'care_facility';
}

const GENDERS = ['男', '女', 'その他', '不明'];
const BLOOD_TYPES = ['不明', 'A', 'B', 'O', 'AB'];
const INSURANCE_TYPES = ['国保', '社保', '後期高齢', '介護保険', '生活保護', '自費', 'その他'];
const DIAGNOSIS_OUTCOMES = ['継続', '治癒', '軽快', '中止', '転院', '死亡'];

// 職種ごとの初期可能オーダー権限（canCreate: 発行可, canExecute: 指示受け・実施可）
const DEFAULT_ROLE_ORDER_PERMISSIONS = [
  // 医師: 全オーダー発行可
  { role_code: 'doctor', order_type_code: 'prescription', can_create: true, can_execute: false },
  { role_code: 'doctor', order_type_code: 'injection', can_create: true, can_execute: true },
  { role_code: 'doctor', order_type_code: 'radiology', can_create: true, can_execute: false },
  { role_code: 'doctor', order_type_code: 'lab', can_create: true, can_execute: true },
  { role_code: 'doctor', order_type_code: 'rehabilitation', can_create: true, can_execute: false },
  { role_code: 'doctor', order_type_code: 'meal', can_create: true, can_execute: false },
  { role_code: 'doctor', order_type_code: 'nursing_care', can_create: true, can_execute: false },
  { role_code: 'doctor', order_type_code: 'admission_discharge', can_create: true, can_execute: false },
  // 看護師: 処置・注射・検体・食事実施、看護指示作成
  { role_code: 'nurse', order_type_code: 'prescription', can_create: false, can_execute: true },
  { role_code: 'nurse', order_type_code: 'injection', can_create: false, can_execute: true },
  { role_code: 'nurse', order_type_code: 'radiology', can_create: false, can_execute: false },
  { role_code: 'nurse', order_type_code: 'lab', can_create: false, can_execute: true },
  { role_code: 'nurse', order_type_code: 'rehabilitation', can_create: false, can_execute: false },
  { role_code: 'nurse', order_type_code: 'meal', can_create: false, can_execute: true },
  { role_code: 'nurse', order_type_code: 'nursing_care', can_create: true, can_execute: true },
  { role_code: 'nurse', order_type_code: 'admission_discharge', can_create: false, can_execute: true },
  // 薬剤師: 処方・注射の監査/調剤実施
  { role_code: 'pharmacist', order_type_code: 'prescription', can_create: false, can_execute: true },
  { role_code: 'pharmacist', order_type_code: 'injection', can_create: false, can_execute: true },
  { role_code: 'pharmacist', order_type_code: 'radiology', can_create: false, can_execute: false },
  { role_code: 'pharmacist', order_type_code: 'lab', can_create: false, can_execute: false },
  { role_code: 'pharmacist', order_type_code: 'rehabilitation', can_create: false, can_execute: false },
  { role_code: 'pharmacist', order_type_code: 'meal', can_create: false, can_execute: false },
  { role_code: 'pharmacist', order_type_code: 'nursing_care', can_create: false, can_execute: false },
  { role_code: 'pharmacist', order_type_code: 'admission_discharge', can_create: false, can_execute: false },
  // 放射線技師: 放射線検査実施
  { role_code: 'radiographer', order_type_code: 'prescription', can_create: false, can_execute: false },
  { role_code: 'radiographer', order_type_code: 'injection', can_create: false, can_execute: false },
  { role_code: 'radiographer', order_type_code: 'radiology', can_create: false, can_execute: true },
  { role_code: 'radiographer', order_type_code: 'lab', can_create: false, can_execute: false },
  { role_code: 'radiographer', order_type_code: 'rehabilitation', can_create: false, can_execute: false },
  { role_code: 'radiographer', order_type_code: 'meal', can_create: false, can_execute: false },
  { role_code: 'radiographer', order_type_code: 'nursing_care', can_create: false, can_execute: false },
  { role_code: 'radiographer', order_type_code: 'admission_discharge', can_create: false, can_execute: false },
  // 栄養士: 食事・栄養の調整発行・実施
  { role_code: 'dietitian', order_type_code: 'prescription', can_create: false, can_execute: false },
  { role_code: 'dietitian', order_type_code: 'injection', can_create: false, can_execute: false },
  { role_code: 'dietitian', order_type_code: 'radiology', can_create: false, can_execute: false },
  { role_code: 'dietitian', order_type_code: 'lab', can_create: false, can_execute: false },
  { role_code: 'dietitian', order_type_code: 'rehabilitation', can_create: false, can_execute: false },
  { role_code: 'dietitian', order_type_code: 'meal', can_create: true, can_execute: true },
  { role_code: 'dietitian', order_type_code: 'nursing_care', can_create: false, can_execute: false },
  { role_code: 'dietitian', order_type_code: 'admission_discharge', can_create: false, can_execute: false },
  // 事務職員: 入退院・受付の発行・実施
  { role_code: 'clerk', order_type_code: 'prescription', can_create: false, can_execute: false },
  { role_code: 'clerk', order_type_code: 'injection', can_create: false, can_execute: false },
  { role_code: 'clerk', order_type_code: 'radiology', can_create: false, can_execute: false },
  { role_code: 'clerk', order_type_code: 'lab', can_create: false, can_execute: false },
  { role_code: 'clerk', order_type_code: 'rehabilitation', can_create: false, can_execute: false },
  { role_code: 'clerk', order_type_code: 'meal', can_create: false, can_execute: false },
  { role_code: 'clerk', order_type_code: 'nursing_care', can_create: false, can_execute: false },
  { role_code: 'clerk', order_type_code: 'admission_discharge', can_create: true, can_execute: true }
];

const DEPARTMENT_MAP = Object.fromEntries(DEPARTMENTS.map((d) => [d.code, d]));
const ROLE_MAP = Object.fromEntries(ROLES.map((r) => [r.code, r]));

// 職種 × 部署 ごとの画面タイトル・初期メニュー定義
const SCREEN_OVERRIDES = {
  'doctor:outpatient': {
    title: '外来 医師オーダリング',
    treeGroups: ['処方オーダー', '注射・点滴オーダー', '放射線検査オーダー', 'リハビリ指示', '診療記録']
  },
  'doctor:ward': {
    title: '医療病棟 医師オーダリング',
    treeGroups: ['医療病棟処方オーダー', '注射・点滴オーダー', '放射線検査オーダー', 'リハビリ指示', '食事オーダー', '経過記録']
  },
  'doctor:care_umikaze': {
    title: '介護医療院(うみかぜ) 医師オーダリング',
    treeGroups: ['処方オーダー', '注射・処置指示', 'リハビリ指示', '食事・栄養指示', '診療記録']
  },
  'doctor:care_shiokaze': {
    title: '介護医療院(しおかぜ) 医師オーダリング',
    treeGroups: ['処方オーダー', '注射・処置指示', 'リハビリ指示', '食事・栄養指示', '診療記録']
  },
  'doctor:rehabilitation': {
    title: 'リハビリ科 医師指示画面',
    treeGroups: ['リハビリ処方・指示', '実施状況確認', 'カンファレンス記録']
  },
  'nurse:outpatient': {
    title: '外来 看護実施・処置画面',
    treeGroups: ['外来指示受け', '放射線検査オーダー', '注射・採血実施', '問診・バイタル', '看護記録']
  },
  'nurse:ward': {
    title: '医療病棟 看護指示受け・実施画面',
    treeGroups: ['医療病棟指示受け', '放射線検査オーダー', '与薬・点滴実施', 'バイタル・観察', '食事摂取記録', '看護記録']
  },
  'nurse:care_umikaze': {
    title: '介護医療院(うみかぜ) 看護・ケア画面',
    treeGroups: ['入所者指示受け', '服薬・処置実施', 'バイタル・状態観察', 'ケア記録']
  },
  'nurse:care_shiokaze': {
    title: '介護医療院(しおかぜ) 看護・ケア画面',
    treeGroups: ['入所者指示受け', '服薬・処置実施', 'バイタル・状態観察', 'ケア記録']
  },
  'pharmacist:pharmacy': {
    title: '薬剤部 処方監査・調剤画面',
    treeGroups: ['処方オーダー受信', '注射・混注監査', '疑義照会', '服薬指導記録']
  },
  'radiographer:radiology': {
    title: '放射線科 検査受付・実施画面',
    treeGroups: ['一般撮影オーダー', 'CT・透視オーダー', '実施入力・照射録', '放射線業務記録']
  },
  'dietitian:nutrition': {
    title: '栄養科 食事オーダー・栄養管理画面',
    treeGroups: ['食種変更オーダー', '医療病棟・入所食数集計', 'アレルギー・禁忌管理', '栄養指導記録']
  },
  'clerk:medical_affairs': {
    title: '医事課 受付・患者・算定管理画面',
    treeGroups: ['患者基本情報管理', '外来受付・入退院登録', 'オーダー算定確認', '会計・レセプト確認']
  },
  'clerk:outpatient': {
    title: '外来 受付・事務画面',
    treeGroups: ['外来受付一覧', '患者基本情報', '予約・会計連携']
  },
  'nurse:rehabilitation': {
    title: 'リハビリ科 看護連携画面',
    treeGroups: ['リハビリ指示確認', '体調・バイタル共有', '連携記録']
  }
};

function getDepartmentByCode(code) {
  return DEPARTMENT_MAP[code] || null;
}

function getRoleByCode(code) {
  return ROLE_MAP[code] || null;
}

function resolveLandingScreen(roleCode, departmentCode) {
  const role = getRoleByCode(roleCode);
  const department = getDepartmentByCode(departmentCode);

  if (!role || !department) {
    return null;
  }

  const key = `${role.code}:${department.code}`;
  const override = SCREEN_OVERRIDES[key];

  const isBedboardDept = department.code === 'ward' || isCareFacilityCode(department.code);
  const landingPath = isBedboardDept
    ? `/bedboard/${department.code}`
    : `/workspace/${department.code}/${role.code}`;

  return {
    path: landingPath,
    workspacePath: `/workspace/${department.code}/${role.code}`,
    departmentCode: department.code,
    departmentName: department.name,
    roleCode: role.code,
    roleName: role.name,
    title: override ? override.title : `${department.name} ${role.name}画面`,
    treeGroups: override
      ? override.treeGroups
      : ['オーダー確認', '業務入力', '履歴参照']
  };
}

function getSwitchableMenus(user) {
  if (!user) return [];
  const effectiveRoleCode = user.elevatedDoctor ? 'doctor' : user.roleCode;

  return DEPARTMENTS.map((dept) => ({
    departmentCode: dept.code,
    departmentName: dept.name,
    path:
      dept.code === 'ward' || isCareFacilityCode(dept.code)
        ? `/bedboard/${dept.code}`
        : `/workspace/${dept.code}/${effectiveRoleCode}`
  }));
}

function buildRolePermLookup(roleCode, rolePerms) {
  const map = {};
  const list = Array.isArray(rolePerms) ? rolePerms : [];
  for (const p of list) {
    if (p.roleCode === roleCode) {
      map[p.orderTypeCode] = {
        canCreate: Boolean(p.canCreate),
        canExecute: Boolean(p.canExecute)
      };
    }
  }
  if (Object.keys(map).length === 0) {
    for (const d of DEFAULT_ROLE_ORDER_PERMISSIONS) {
      if (d.role_code === roleCode) {
        map[d.order_type_code] = {
          canCreate: Boolean(d.can_create),
          canExecute: Boolean(d.can_execute)
        };
      }
    }
  }
  return map;
}

/**
 * 選択中の部署 × 有効職種（権限代行時は医師）× 職種別オーダー権限マスタに応じて
 * 左列ツリーメニューを動的生成する。
 */
function buildWorkspaceLeftMenu(departmentCode, effectiveRoleCode, rolePerms) {
  const perm = buildRolePermLookup(effectiveRoleCode, rolePerms);
  const canCreate = (code) => Boolean(perm[code] && perm[code].canCreate);
  const canExecute = (code) => Boolean(perm[code] && perm[code].canExecute);
  const canAny = (code) => canCreate(code) || canExecute(code);

  const groups = [];

  if (departmentCode === 'outpatient') {
    if (canCreate('prescription')) {
      groups.push({
        label: '処方オーダー',
        badgeType: 'rx',
        open: true,
        items: [{ label: '外来処方箋', rxAction: 'create-outpatient' }]
      });
    }

    if (canCreate('injection')) {
      groups.push({
        label: '注射・点滴オーダー',
        badgeType: 'inj',
        open: true,
        items: [{ label: '外来注射箋', injAction: 'create-outpatient' }]
      });
    }

    if (canCreate('radiology')) {
      groups.push({
        label: '放射線検査オーダー',
        badgeType: 'rad',
        open: true,
        items: [{ label: '新規オーダー作成', radAction: 'create' }]
      });
    }

    if (canCreate('rehabilitation')) {
      groups.push({
        label: 'リハビリ指示',
        badgeType: 'rehab',
        open: true,
        items: [{ label: 'リハビリ指示', rehabAction: 'create' }]
      });
    }

    if (canAny('nursing_care')) {
      groups.push({
        label: '看護・処置',
        badgeType: null,
        open: effectiveRoleCode === 'nurse',
        items: [{ label: '外来指示受け' }, { label: '問診・バイタル' }, { label: '看護記録' }]
      });
    }

    if (canAny('admission_discharge')) {
      groups.push({
        label: '外来受付・患者情報',
        badgeType: null,
        open: effectiveRoleCode === 'clerk',
        items: [
          { label: '患者情報管理', href: '/patients' },
          { label: '外来受付一覧' }
        ]
      });
    }

    if (effectiveRoleCode === 'doctor') {
      groups.push({
        label: '診療記録',
        badgeType: null,
        open: false,
        items: [{ label: '診療記録 一覧' }, { label: '新規作成' }]
      });
    }
  } else if (departmentCode === 'ward' || isCareFacilityCode(departmentCode)) {
    const isWard = departmentCode === 'ward';

    if (canCreate('prescription')) {
      groups.push({
        label: isWard ? '医療病棟処方オーダー' : '処方オーダー',
        badgeType: 'rx',
        open: true,
        items: [
          { label: '臨時処方箋', rxAction: 'create-adhoc' },
          { label: '定期処方箋', rxAction: 'create-regular' }
        ]
      });
    }

    if (canCreate('injection')) {
      groups.push({
        label: isWard ? '注射・点滴オーダー' : '注射・処置指示',
        badgeType: 'inj',
        open: true,
        items: [{ label: '入院注射箋', injAction: 'create-inpatient' }]
      });
    }

    if (canCreate('radiology')) {
      groups.push({
        label: '放射線検査オーダー',
        badgeType: 'rad',
        open: isWard,
        items: [{ label: '新規オーダー作成', radAction: 'create' }]
      });
    }

    if (canCreate('meal')) {
      groups.push({
        label: isWard ? '食事オーダー' : '食事・栄養指示',
        badgeType: 'meal',
        open: true,
        items: [{ label: '食事オーダー', mealAction: 'create' }]
      });
    }

    if (canCreate('rehabilitation')) {
      groups.push({
        label: 'リハビリ指示',
        badgeType: 'rehab',
        open: true,
        items: [{ label: 'リハビリ指示', rehabAction: 'create' }]
      });
    }

    if (canAny('nursing_care')) {
      groups.push({
        label: isWard ? '看護・観察' : '看護・ケア',
        badgeType: null,
        open: effectiveRoleCode === 'nurse',
        items: isWard
          ? [{ label: '医療病棟指示受け' }, { label: 'バイタル・観察' }, { label: '看護記録' }]
          : [{ label: '入所者指示受け' }, { label: 'バイタル・状態観察' }, { label: 'ケア記録' }]
      });
    }

    if (canAny('admission_discharge')) {
      groups.push({
        label: '入退院・患者情報',
        badgeType: null,
        open: effectiveRoleCode === 'clerk',
        items: [
          { label: '患者情報管理', href: '/patients' },
          { label: '入退院登録' }
        ]
      });
    }

    if (effectiveRoleCode === 'doctor') {
      groups.push({
        label: isWard ? '経過記録' : '診療記録',
        badgeType: null,
        open: false,
        items: [{ label: isWard ? '経過記録 一覧' : '診療記録 一覧' }, { label: '新規作成' }]
      });
    }
  } else if (departmentCode === 'radiology') {
    const items = [];
    if (canExecute('radiology') || effectiveRoleCode === 'doctor') {
      items.push({ label: '放射線科モニター', href: '/radiology/monitor' });
    }
    if (canCreate('radiology')) {
      items.push({ label: '放射線科オーダー作成', radAction: 'create' });
    }
    if (items.length > 0) {
      groups.push({ label: '放射線検査オーダー', badgeType: 'rad', open: true, items });
    }

    if (canExecute('radiology')) {
      groups.push({
        label: '撮影・照射管理',
        badgeType: null,
        open: true,
        items: [{ label: '実施入力・照射録' }, { label: '放射線業務記録' }]
      });
    }
  } else if (departmentCode === 'pharmacy') {
    groups.push({
      label: '薬剤情報',
      badgeType: null,
      open: true,
      items: [{ label: '薬剤検索', href: '/medicines' }]
    });

    if (effectiveRoleCode === 'pharmacist') {
      groups.push({
        label: '薬剤部業務',
        badgeType: null,
        open: true,
        items: [{ label: '疑義照会' }, { label: '服薬指導記録' }]
      });
    }
  } else if (departmentCode === 'rehabilitation') {
    if (canAny('rehabilitation') || effectiveRoleCode === 'nurse') {
      const items = [];
      if (canCreate('rehabilitation')) items.push({ label: 'リハビリ指示', rehabAction: 'create' });
      items.push({ label: '実施状況確認' }, { label: 'カンファレンス記録' });
      groups.push({
        label: 'リハビリ業務',
        badgeType: canCreate('rehabilitation') ? 'rehab' : null,
        open: true,
        items
      });
    }
  } else if (departmentCode === 'nutrition') {
    if (canAny('meal')) {
      const items = [];
      if (canCreate('meal')) items.push({ label: '食事オーダー', mealAction: 'create' });
      items.push({ label: '医療病棟・入所食数集計' }, { label: 'アレルギー・禁忌管理' }, { label: '栄養指導記録' });
      groups.push({
        label: '食事・栄養管理',
        badgeType: canCreate('meal') ? 'meal' : null,
        open: true,
        items
      });
    }
  } else if (departmentCode === 'medical_affairs') {
    if (canAny('admission_discharge') || effectiveRoleCode === 'doctor' || effectiveRoleCode === 'nurse') {
      const items = [{ label: '患者情報管理', href: '/patients' }];
      if (effectiveRoleCode === 'clerk' || effectiveRoleCode === 'doctor') {
        items.push({ label: 'ユーザー・権限管理', href: '/users' });
      }
      groups.push({ label: 'マスタ・患者管理', badgeType: null, open: true, items });
    }

    if (canAny('admission_discharge')) {
      groups.push({
        label: '受付・算定業務',
        badgeType: null,
        open: true,
        items: [{ label: '外来受付・入退院登録' }, { label: 'オーダー算定確認' }, { label: '会計・レセプト確認' }]
      });
    }
  }

  if (groups.length === 0) {
    groups.push({
      label: '参照メニュー',
      badgeType: null,
      open: true,
      items: [{ label: '履歴参照' }]
    });
  }

  return groups;
}

module.exports = {
  DEPARTMENTS,
  ROLES,
  ORDER_TYPES,
  PATIENT_CATEGORIES,
  GENDERS,
  BLOOD_TYPES,
  INSURANCE_TYPES,
  DIAGNOSIS_OUTCOMES,
  DEFAULT_ROLE_ORDER_PERMISSIONS,
  getDepartmentByCode,
  getRoleByCode,
  isCareFacilityCode,
  resolveLandingScreen,
  getSwitchableMenus,
  buildWorkspaceLeftMenu
};
