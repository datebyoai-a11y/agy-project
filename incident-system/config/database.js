const mongoose = require('mongoose');
const TargetPerson = require('../models/TargetPerson');
const User = require('../models/User');

const seedTargetPeople = async () => {
  try {
    const count = await TargetPerson.countDocuments();
    if (count === 0) {
      const initialTargets = [
        { customId: 'T001', name: '山田 太郎', department: '一般病棟' },
        { customId: 'T002', name: '佐藤 花子', department: '外来' },
        { customId: 'T003', name: '鈴木 一郎', department: '集中治療室' },
        { customId: 'T004', name: '高橋 五郎', department: '一般病棟' },
        { customId: 'T005', name: '田中 美咲', department: '小児科' },
        { customId: 'T006', name: '伊藤 健太', department: 'リハビリ科' },
        { customId: 'T007', name: '渡辺 真由', department: '手術室' }
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
    await mongoose.connect('mongodb://localhost:27017/incident_db');
    console.log('MongoDB に正常に接続されました。');
    await seedTargetPeople();
    await seedUsers();
  } catch (err) {
    console.error('MongoDB 接続エラー:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
 

