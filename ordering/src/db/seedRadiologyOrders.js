'use strict';

const { connectDB, closeDB } = require('./connection');
const radiologyOrderRepository = require('../repositories/radiologyOrderRepository');

const INITIAL_RADIOLOGY_ORDERS = [
  {
    order_number: 'RAD-SEED-0001',
    patient_id: 'P0001',
    patient_name: '田中 一郎',
    patient_kana: 'タナカ イチロウ',
    gender: '男',
    age: 81,
    birth_date: '1945-04-12',
    ward: '医療病棟',
    room: '201-1',
    request_department: '内科',
    mobility: 'ベッド',
    infection: '無',
    doctor_name: '佐藤 健一',
    ordered_by_staff_id: 'doc02',
    form_type: 'XRAY',
    form_name: '診療Ｘ線照射録',
    modality: '一般X線',
    exam_type: '① 胸部 (臥位 ポータブル)',
    contrast: '単純',
    is_portable: true,
    portable_room: '201-1',
    is_urgent: true,
    parts: ['① 胸部 (立位 PA / 側面 R-L)'],
    parts_detail: '臥位ポータブル正面',
    condition_kv: '100',
    condition_ma: '200',
    condition_sec: '0.04',
    purpose: '発熱・SpO2低下、肺炎・胸水評価',
    remarks: '転倒リスクあり・ベッド上撮影',
    elec_img_add: true,
    order_status: 'ORDERED'
  },
  {
    order_number: 'RAD-SEED-0002',
    patient_id: 'P0003',
    patient_name: '高橋 健太',
    patient_kana: 'タカハシ ケンタ',
    gender: '男',
    age: 54,
    birth_date: '1972-07-25',
    ward: '外来',
    room: '',
    request_department: '内科',
    mobility: '徒歩',
    infection: '無',
    doctor_name: '山田 太郎',
    ordered_by_staff_id: 'doc01',
    form_type: 'CT',
    form_name: 'ＣＴ検査依頼書',
    modality: 'CT',
    exam_type: '単純CT (胸部 (肺・横隔))',
    contrast: '単純',
    dynamic_phase: '',
    is_portable: false,
    is_urgent: false,
    parts: ['胸部 (肺・横隔)'],
    parts_detail: '肺野条件・縦隔条件',
    medications: '',
    condition_kv: '120',
    condition_ma: '200',
    condition_sec: '0.5',
    purpose: '咳嗽持続、胸部精査（ヨード造影剤アレルギーのため単純）',
    remarks: 'ヨード造影剤禁忌',
    elec_img_add: true,
    order_status: 'ACCEPTED',
    accepted_by: '中村 誠',
    accepted_at: new Date()
  },
  {
    order_number: 'RAD-SEED-0003',
    patient_id: 'P0002',
    patient_name: '佐々木 幸子',
    patient_kana: 'ササキ サチコ',
    gender: '女',
    age: 88,
    birth_date: '1938-11-03',
    ward: '介護医療院(うみかぜ)',
    room: '305-2',
    request_department: '内科',
    mobility: '車椅子',
    infection: '無',
    doctor_name: '山田 太郎',
    ordered_by_staff_id: 'doc01',
    form_type: 'FLUORO',
    form_name: '透視検査依頼書',
    modality: '透視',
    exam_type: 'PEG交換',
    contrast: '造影',
    is_portable: false,
    is_urgent: false,
    parts: ['PEG交換'],
    medications: 'ガストログラフィン 20ml, キシロカインゼリー2% 10ml',
    materials: 'ガストロボタン 24Fr 3.5cm、交換用シリンジ、滅菌ガーゼ',
    purpose: '定期PEGチューブ交換・胃内留置位置造影確認',
    remarks: '嚥下調整食（ソフト食）',
    elec_img_add: true,
    order_status: 'ORDERED'
  }
];

async function seedInitialRadiologyOrders() {
  await radiologyOrderRepository.ensureIndexes();
  for (const item of INITIAL_RADIOLOGY_ORDERS) {
    await radiologyOrderRepository.upsertSeedOrder(item);
  }
}

if (require.main === module) {
  connectDB()
    .then(() => seedInitialRadiologyOrders())
    .then(() => {
      console.log(`初期放射線オーダー ${INITIAL_RADIOLOGY_ORDERS.length} 件のシードが完了しました。`);
      return closeDB();
    })
    .catch((err) => {
      console.error('放射線オーダーシード処理に失敗しました:', err);
      process.exit(1);
    });
}

module.exports = {
  seedInitialRadiologyOrders,
  INITIAL_RADIOLOGY_ORDERS
};
