const express = require('express');
const router = express.Router();
const User = require('../models/User');

// 1. ユーザー一覧の取得
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ユーザー一覧の取得に失敗しました: ' + err.message });
  }
});

// 2. ユーザー新規追加
router.post('/users', async (req, res) => {
  try {
    const { loginId, userName, password, role, department } = req.body;

    if (!loginId || !userName || !password) {
      return res.status(400).json({ success: false, message: 'ログインID、ユーザー名、パスワードは必須です。' });
    }

    const existingUser = await User.findOne({ loginId });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'このログインIDは既に使用されています。' });
    }

    const newUser = new User({
      loginId,
      userName,
      password,
      role: role || 'user',
      department: department || '看護師'
    });

    await newUser.save();
    
    // パスワードを除外したデータを返す
    const userObj = newUser.toObject();
    delete userObj.password;

    res.status(201).json({ success: true, message: 'ユーザーを追加しました。', user: userObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ユーザー追加処理エラー: ' + err.message });
  }
});

// 3. ユーザー情報の更新 (氏名、ロール、部署、パスワード変更)
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userName, role, department, newPassword } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: '対象のユーザーが見つかりません。' });
    }

    if (userName) user.userName = userName;
    if (role) user.role = role;
    if (department !== undefined) user.department = department;
    
    if (newPassword && newPassword.trim() !== '') {
      user.password = newPassword;
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    res.json({ success: true, message: 'ユーザー情報を更新しました。', user: userObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ユーザー更新処理エラー: ' + err.message });
  }
});

// 4. ユーザー削除
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user ? req.user._id.toString() : null;

    if (currentUserId && currentUserId === id) {
      return res.status(400).json({ success: false, message: '現在ログイン中の自分自身アカウントは削除できません。' });
    }

    const deletedUser = await User.findByIdAndDelete(id);
    if (!deletedUser) {
      return res.status(404).json({ success: false, message: '削除対象のユーザーが見つかりません。' });
    }

    res.json({ success: true, message: `ユーザー [${deletedUser.userName}] を削除しました。` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ユーザー削除処理エラー: ' + err.message });
  }
});

module.exports = router;
