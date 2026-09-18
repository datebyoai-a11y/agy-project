const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const User = require('../models/User');

const router = express.Router();
const upload = multer({
  dest: path.join(os.tmpdir(), 'incident-system-restore-'),
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (file.originalname.endsWith('.archive.gz')) {
      return callback(null, true);
    }
    callback(new Error('リストアには .archive.gz 形式のバックアップファイルを指定してください。'));
  }
});

const requireAdmin = async (req, res, next) => {
  try {
    const loginId = req.user && req.user.loginId
      ? req.user.loginId
      : req.session && req.session.user
        ? req.session.user.id
        : null;
    const user = loginId ? await User.findOne({ loginId }) : null;

    if (!user || user.role !== 'admin') {
      return res.status(403).send('データベースのバックアップ・リストアは管理者のみ実行できます。');
    }

    req.backupUser = user;
    next();
  } catch (err) {
    res.status(500).send('バックアップ権限の確認に失敗しました: ' + err.message);
  }
};

const runCommand = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args);
  let stderr = '';

  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  child.on('error', reject);
  child.on('close', code => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(stderr.trim() || `${command} が終了コード ${code} で終了しました。`));
    }
  });
});

router.get('/backup/database', requireAdmin, (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `incident_db_backup_${date}.archive.gz`;
  const dump = spawn('mongodump', [
    '--db', 'incident_db',
    '--archive',
    '--gzip'
  ]);

  let started = false;
  let errorMessage = '';

  dump.stderr.on('data', chunk => {
    errorMessage += chunk.toString();
  });

  dump.on('error', err => {
    if (!started) {
      res.status(500).send('バックアップの開始に失敗しました: ' + err.message);
    }
  });

  dump.on('close', code => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).send('バックアップ作成エラー: ' + (errorMessage.trim() || `終了コード ${code}`));
    }
  });

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  started = true;
  dump.stdout.pipe(res);
});

router.post('/backup/database/restore', requireAdmin, upload.single('backupFile'), async (req, res) => {
  let restoreFile;
  let safetyBackupFile;

  try {
    if (!req.file) {
      return res.status(400).send('リストアするバックアップファイルを選択してください。');
    }

    restoreFile = req.file.path;
    const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'incident-system-safety-'));
    safetyBackupFile = path.join(tempDirectory, 'before-restore.archive.gz');

    await runCommand('mongodump', [
      '--db', 'incident_db',
      `--archive=${safetyBackupFile}`,
      '--gzip'
    ]);

    await runCommand('mongorestore', [
      '--db', 'incident_db',
      `--archive=${restoreFile}`,
      '--gzip',
      '--drop'
    ]);

    res.send('<script>alert("リストアが完了しました。復元前のデータはサーバーの一時バックアップに保存されています。"); window.location.href="/";</script>');
  } catch (err) {
    res.status(500).send('リストアに失敗しました。データは復元前の状態です。詳細: ' + err.message);
  } finally {
    if (restoreFile) {
      await fs.promises.rm(restoreFile, { force: true }).catch(() => {});
    }
  }
});

module.exports = router;
