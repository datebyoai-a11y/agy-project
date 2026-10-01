/**
 * 🗑️ P20101以降の写真再現患者データの削除スクリプト
 * P20101〜P22604（2F実機写真から仮登録した59名）をDBから削除します。
 * 元の患者データ（P001〜P006等）はそのまま保持されます。
 */

const mongoose = require('mongoose');
const Patient = require('./models/Patient');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';

async function deleteP20101Patients() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB 接続成功');

    // 削除対象の条件: P20101以降 (P2から始まるID、またはP20101以上のID)
    const filter = {
      $or: [
        { patientId: { $regex: '^P2' } },
        { patientId: { $gte: 'P20101' } }
      ]
    };

    const targetFilter = {
      $or: [
        { customId: { $regex: '^P2' } },
        { customId: { $gte: 'P20101' } }
      ]
    };

    const patientsToDelete = await Patient.find(filter);
    console.log(`📋 Patient 削除対象件数: ${patientsToDelete.length} 名`);
    patientsToDelete.forEach(p => console.log(`  - 削除: [${p.patientId}] ${p.name}`));

    const resPatient = await Patient.deleteMany(filter);
    console.log(`🗑️ Patient コレクションから ${resPatient.deletedCount} 件を削除しました。`);

    const resTarget = await TargetPerson.deleteMany(targetFilter);
    console.log(`🗑️ TargetPerson コレクションから ${resTarget.deletedCount} 件を削除しました。`);

    // 残存確認
    const remainingPatients = await Patient.find({}).sort({ patientId: 1 });
    console.log(`\n✅ 残存患者数: ${remainingPatients.length} 名`);
    remainingPatients.forEach(p => console.log(`  - 保持: [${p.patientId}] ${p.name} (${p.ward || '未入床'} ${p.room || ''})`));

    process.exit(0);
  } catch (err) {
    console.error('❌ エラー発生:', err);
    process.exit(1);
  }
}

deleteP20101Patients();
