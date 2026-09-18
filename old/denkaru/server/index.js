const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS設定：フロントエンド(localhost:5173)からのアクセスを許可
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// ユーザー情報を返すAPI (モックデータ)
app.get('/api/user', (req, res) => {
    // 実際にはここでJWTを検証し、データベースからユーザー情報を取得します
    const mockUser = {
        id: 'user_001',
        name: '山田太郎',
        role: '医師'
    };
    res.json(mockUser);
});

// index.js に追記
app.get('/', (req, res) => {
    res.send('Denkaru API Server is running.');
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
