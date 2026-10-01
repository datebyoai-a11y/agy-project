/**
 * 🛏️ ベッドボード入院患者の全床解放（退床）スクリプト
 * ベッドボード上の全患者の入床情報 (ward/room) をクリアし、全ベッドを空床にします。
 * ※患者データ自体はデータベースに保持され、後から適宜入床できます。
 */

const mongoose = require('mongoose');
const Patient = require('./models/Patient');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';

async function clearBedBoard() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB 接続成功');

    // 現在ベッドに割り当てられている患者を取得
    const admittedPatients = await Patient.find({
      $or: [
        { room: { $exists: true, $ne: '' } },
        { ward: { $exists: true, $nin: ['外来', ''] } }
      ]
    });

    console.log(`📋 退床対象の入院患者数: ${admittedPatients.length} 名`);

    for (const patient of admittedPatients) {
      const prevWard = patient.ward;
      const prevRoom = patient.room;
      patient.ward = '外来';
      patient.room = '';
      await patient.save();

      // カルテ側 (TargetPerson) も同期
      await TargetPerson.findOneAndUpdate(
        { customId: patient.patientId },
        { department: '外来 ' + (patient.department || '内科') }
      );

      console.log(`  - 解除: [${patient.patientId}] ${patient.name} (${prevWard} ${prevRoom} ➔ 外来 未入床)`);
    }

    const remainingAdmitted = await Patient.countDocuments({ room: { $exists: true, $ne: '' } });
    console.log(`\n🎉 完了: 全患者のベッド割り当てを解除しました。現在の入床中患者数: ${remainingAdmitted} 名 (全床空床)`);

    process.exit(0);
  } catch (err) {
    console.error('❌ エラー発生:', err);
    process.exit(1);
  }
}

clearBedBoard();
