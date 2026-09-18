// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 💡 修正：?replicaSet=rs0 を削除し、標準の接続形式にします
const MONGO_URI = 'mongodb://127.0.0.1:27017/logDB'; 
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDBに正常に接続しました'))
  .catch(err => console.error('❌ MongoDB接続失敗:', err));

// スキーマ定義
const LogSchema = new mongoose.Schema({
  message: String,
  timestamp: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);

// 静的ファイルの提供
app.use(express.static('public'));

// WebSocket通信の処理
io.on('connection', (socket) => {
  console.log('👤 ユーザーが接続しました:', socket.id);

  // ブラウザからログを受信
  socket.on('send-log', async (data) => {
    try {
      const log = new Log({ message: data.message });
      const savedLog = await log.save(); // DBへ保存
      
      // 💡 変更を直接検知して全ブラウザにブロードキャスト
      io.emit('notification', savedLog); 
    } catch (err) {
      console.error('⚠️ DB保存エラー:', err);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});

