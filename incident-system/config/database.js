const mongoose = require('mongoose');
const TargetPerson = require('../models/TargetPerson');
const Patient = require('../models/Patient');
const User = require('../models/User');

const seedTargetPeople = async () => {
  try {
    // 🏥 MongoDB の集中管理患者マスタ (Patient) があれば TargetPerson へ自動連動同期
    const patients = await Patient.find({});
    if (patients && patients.length > 0) {
      for (const p of patients) {
        await TargetPerson.findOneAndUpdate(
          { customId: p.patientId },
          {
            customId: p.patientId,
            name: p.name,
            department: (p.ward || '外来') + ' ' + (p.department || '内科')
          },
          { upsert: true, new: true }
        );
      }
      console.log(`🏥 [Centralized DB] MongoDB Patient マスタ (${patients.length}名) を TargetPerson に同期完了。`);
      return;
    }

    const count = await TargetPerson.countDocuments();
    if (count === 0) {
      const initialTargets = [
        { customId: 'P001', name: '安部 光良', department: '外来 内科' },
        { customId: 'P002', name: '山田 太郎', department: 'うみかぜ病棟 外科' },
        { customId: 'P003', name: '佐藤 花子', department: '医療療養病棟 総合診療科' },
        { customId: 'P004', name: '鈴木 一郎', department: 'しおかぜ病棟 循環器内科' },
        { customId: 'P005', name: '高橋 五郎', department: 'プライム病棟 整形外科' }
      ];
      await TargetPerson.insertMany(initialTargets);
      console.log('対象者（患者/対象者マスタ）の初期データを登録しました。');
    }
  } catch (err) {
    console.error('対象者シードエラー:', err.message);
  }
};

const seedUsers = async () => {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      const adminUser = new User({
        loginId: 'admin',
        userName: '管理者 太郎',
        password: 'admin123',
        role: 'admin',
        department: '医療安全管理室'
      });
      await adminUser.save();

      const defaultUser = new User({
        loginId: 'nurse1',
        userName: '看護 研修生',
        password: 'user123',
        role: 'user',
        department: '一般病棟'
      });
      await defaultUser.save();

      const antigravityUser = new User({
        loginId: 'antigravity',
        userName: 'Antigravity (AI Test Agent)',
        password: 'antigravity-test-2026',
        role: 'admin',
        department: '医療安全管理室'
      });
      await antigravityUser.save();

      console.log('初期ユーザーデータ（管理者・一般・AI検証アカウント）を登録しました。');
    }

    // リハビリ職ユーザーのシード（未登録の場合に追加）
    const existingRehabUser = await User.findOne({ loginId: 'pt1' });
    if (!existingRehabUser) {
      const rehabUser = new User({
        loginId: 'pt1',
        userName: 'リハビリ 太郎',
        password: 'user123',
        role: 'user',
        department: 'リハビリ'
      });
      await rehabUser.save();
      console.log('リハビリ職ユーザー (pt1 / リハビリ 太郎) を登録しました。');
    }
  } catch (err) {
    console.error('ユーザーシードエラー:', err.message);
  }
};

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
    await mongoose.connect(mongoUri);
    console.log('✅ [Incident/Carte] MongoDB レプリカセット (rs0) に正常接続しました。');
    await seedTargetPeople();
    await seedUsers();
  } catch (err) {
    console.error('MongoDB 接続エラー:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
 

