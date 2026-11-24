'use strict';

const bcrypt = require('bcryptjs');
const { connectDB, closeDB } = require('./connection');
const userRepository = require('../repositories/userRepository');

// 初期アカウント（6職種 × 8部署を網羅）
const INITIAL_USERS = [
  {
    staff_id: 'doc01',
    full_name: '山田 太郎',
    password: 'pass',
    role_code: 'doctor',
    default_department_code: 'outpatient',
    allowed_department_codes: ['outpatient', 'ward', 'care_umikaze', 'care_shiokaze', 'rehabilitation']
  },
  {
    staff_id: 'doc02',
    full_name: '佐藤 健一',
    password: 'pass',
    role_code: 'doctor',
    default_department_code: 'ward',
    allowed_department_codes: ['ward', 'outpatient', 'care_umikaze', 'care_shiokaze', 'rehabilitation']
  },
  {
    staff_id: 'ns01',
    full_name: '鈴木 花子',
    password: 'pass',
    role_code: 'nurse',
    default_department_code: 'ward',
    allowed_department_codes: ['ward', 'outpatient', 'care_umikaze', 'care_shiokaze']
  },
  {
    staff_id: 'ns02',
    full_name: '高橋 美咲',
    password: 'pass',
    role_code: 'nurse',
    default_department_code: 'outpatient',
    allowed_department_codes: ['outpatient', 'ward']
  },
  {
    staff_id: 'ns03',
    full_name: '伊藤 恵子',
    password: 'pass',
    role_code: 'nurse',
    default_department_code: 'care_umikaze',
    allowed_department_codes: ['care_umikaze', 'care_shiokaze', 'ward']
  },
  {
    staff_id: 'reha01',
    full_name: '渡辺 翔太',
    password: 'pass',
    role_code: 'doctor',
    default_department_code: 'rehabilitation',
    allowed_department_codes: ['rehabilitation', 'ward', 'outpatient']
  },
  {
    staff_id: 'rt01',
    full_name: '中村 誠',
    password: 'pass',
    role_code: 'radiographer',
    default_department_code: 'radiology',
    allowed_department_codes: ['radiology']
  },
  {
    staff_id: 'ph01',
    full_name: '小林 裕子',
    password: 'pass',
    role_code: 'pharmacist',
    default_department_code: 'pharmacy',
    allowed_department_codes: ['pharmacy']
  },
  {
    staff_id: 'dt01',
    full_name: '加藤 彩',
    password: 'pass',
    role_code: 'dietitian',
    default_department_code: 'nutrition',
    allowed_department_codes: ['nutrition']
  },
  {
    staff_id: 'cl01',
    full_name: '吉田 直樹',
    password: 'pass',
    role_code: 'clerk',
    default_department_code: 'medical_affairs',
    allowed_department_codes: ['medical_affairs', 'outpatient']
  }
];

async function seedInitialUsers() {
  await userRepository.ensureIndexes();
  const passwordHash = await bcrypt.hash('pass', 10);

  for (const item of INITIAL_USERS) {
    await userRepository.upsertUser({
      staff_id: item.staff_id,
      full_name: item.full_name,
      password_hash: passwordHash,
      role_code: item.role_code,
      default_department_code: item.default_department_code,
      allowed_department_codes: item.allowed_department_codes,
      is_active: true
    });
  }
  await userRepository.migrateCareFacilityDepartments();
}

if (require.main === module) {
  connectDB()
    .then(() => seedInitialUsers())
    .then(() => {
      console.log(`初期ユーザー ${INITIAL_USERS.length} 件のシードが完了しました。`);
      return closeDB();
    })
    .catch((err) => {
      console.error('シード処理に失敗しました:', err);
      process.exit(1);
    });
}

module.exports = {
  seedInitialUsers,
  INITIAL_USERS
};
