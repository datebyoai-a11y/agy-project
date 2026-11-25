'use strict';

const { connectDB, closeDB } = require('./connection');
const patientRepository = require('../repositories/patientRepository');

const INITIAL_PATIENTS = [
  {
    patient_id: 'P0001',
    full_name: '田中 一郎',
    kana: 'タナカ イチロウ',
    birth_date: '1945-04-12',
    gender: '男',
    care_category: 'ward',
    ward_room: '201-1',
    blood_type: 'A',
    allergies: 'ペニシリン系抗菌薬',
    cautions: '転倒リスクあり・見守り要',
    diagnoses: [
      { diagnosis_id: 'DX-SEED-101', name: '誤嚥性肺炎', start_date: '2026-10-15', end_date: '', outcome: '継続' },
      { diagnosis_id: 'DX-SEED-102', name: '高血圧症', start_date: '2024-05-01', end_date: '', outcome: '継続' }
    ],
    insurance_type: '後期高齢',
    phone: '0142-23-1111',
    emergency_contact: '田中 次郎（長男）090-1111-2222',
    notes: '転倒リスクあり・見守り要'
  },
  {
    patient_id: 'P0002',
    full_name: '佐々木 幸子',
    kana: 'ササキ サチコ',
    birth_date: '1938-11-03',
    gender: '女',
    care_category: 'care_umikaze',
    ward_room: '405-2',
    blood_type: 'O',
    allergies: 'なし',
    cautions: '誤嚥注意（ソフト食）',
    diagnoses: [
      { diagnosis_id: 'DX-SEED-201', name: '脳梗塞後遺症', start_date: '2025-02-10', end_date: '', outcome: '継続' },
      { diagnosis_id: 'DX-SEED-202', name: 'アルツハイマー型認知症', start_date: '2025-02-10', end_date: '', outcome: '継続' }
    ],
    insurance_type: '介護保険',
    phone: '0142-23-2222',
    emergency_contact: '佐々木 恵美（長女）090-3333-4444',
    notes: '嚥下調整食（ソフト食）'
  },
  {
    patient_id: 'P0003',
    full_name: '高橋 健太',
    kana: 'タカハシ ケンタ',
    birth_date: '1972-07-25',
    gender: '男',
    care_category: 'outpatient',
    ward_room: '',
    blood_type: 'B',
    allergies: 'ヨード造影剤',
    diagnoses: [
      { diagnosis_id: 'DX-SEED-301', name: '本態性高血圧症', start_date: '2023-08-01', end_date: '', outcome: '継続' },
      { diagnosis_id: 'DX-SEED-302', name: '急性上気道炎', start_date: '2026-09-10', end_date: '2026-09-20', outcome: '治癒' }
    ],
    insurance_type: '社保',
    phone: '0142-25-3333',
    emergency_contact: '高橋 真由美（妻）090-5555-6666',
    notes: '高血圧定期通院'
  },
  {
    patient_id: 'P0004',
    full_name: '木村 和子',
    kana: 'キムラ カズコ',
    birth_date: '1950-02-19',
    gender: '女',
    care_category: 'ward',
    ward_room: '206-1',
    blood_type: 'AB',
    allergies: '卵',
    diagnoses: [
      { diagnosis_id: 'DX-SEED-401', name: '右大腿骨頚部骨折術後', start_date: '2026-11-01', end_date: '', outcome: '継続' }
    ],
    insurance_type: '後期高齢',
    phone: '0142-22-4444',
    emergency_contact: '木村 浩（夫）090-7777-8888',
    notes: '右大腿骨頚部骨折術後リハビリ中'
  }
];

async function seedInitialPatients() {
  await patientRepository.ensureIndexes();
  for (const item of INITIAL_PATIENTS) {
    await patientRepository.upsertSeedPatient(item);
  }
  if (typeof patientRepository.migrateCareFacilityCategory === 'function') {
    await patientRepository.migrateCareFacilityCategory();
  }
  if (typeof patientRepository.backfillSeedCautions === 'function') {
    await patientRepository.backfillSeedCautions(INITIAL_PATIENTS);
  }
  if (typeof patientRepository.backfillSeedDiagnoses === 'function') {
    await patientRepository.backfillSeedDiagnoses(INITIAL_PATIENTS);
  }
}

if (require.main === module) {
  connectDB()
    .then(() => seedInitialPatients())
    .then(() => {
      console.log(`初期患者データ ${INITIAL_PATIENTS.length} 件のシードが完了しました。`);
      return closeDB();
    })
    .catch((err) => {
      console.error('患者シード処理に失敗しました:', err);
      process.exit(1);
    });
}

module.exports = {
  seedInitialPatients,
  INITIAL_PATIENTS
};
