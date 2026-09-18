require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const app = express();
const PORT = process.env.PORT || 3000;
const requireLogin = require('./middleware/authMiddleware');

// ===============================
// 1. 基本設定
// ===============================
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // 本番は true（HTTPS 必須）
        maxAge: 1000 * 60 * 60
    }
}));

//const User = require('./models/User');

// ===============================
// 2. DB接続
// ===============================
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB error:', err));

// ===============================
// 3. モデル
// ===============================
const User = require('./models/User');
const Article = require('./models/Article');
//const Category = require('./models/Category');
const Target = require('./models/Target');

// ===============================
// 4. ミドルウェア
// ===============================
/*const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};
*/
// ===============================
// 5. ルーティング
// ===============================
app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.render('login', { error: 'ユーザーが登録されていません' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.render('login', { error: 'パスワードが違います。' });

        req.session.userId = user._id;
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('サーバーエラー');
    }
});

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const exists = await User.findOne({ username });
        if (exists) return res.render('register', { error: 'このユーザー名は既に使われています。' });

        const newUser = new User({ username, password });
        await newUser.save();
        res.redirect('/login');
    } catch (err) {
        console.error('登録エラー:', err);
        res.status(500).send('登録エラー');
    }
});

app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const targets = await Target.find();
        const selectedTargetId = req.query.targetId;

        const filter = selectedTargetId
            ? { targetId: selectedTargetId }
            : {};

        let articles = await Article.find(filter).sort({ createdAt: -1 });

        // ★ ここで対象者名を付与する
        articles = await Promise.all(
            articles.map(async (a) => {
                const t = await Target.findOne({ targetId: a.targetId });
                return {
                    ...a.toObject(),
                    targetName: t ? t.name : "不明"
                };
            })
        );

        res.render('dashboard', {
            user: user.username,
            targets,
            articles,
            selectedTargetId
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('エラー');
    }
});


app.post('/post-article', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const { content, targetId } = req.body;

        await new Article({
            username: user.username,
            content,
            targetId
        }).save();

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('保存エラー');
    }
});

app.get('/add-target', requireLogin, (req, res) => {
    res.render('add-target', { error: null });
});

app.post('/add-target', requireLogin, async (req, res) => {
    const { name, targetId } = req.body;

    try {
        const exists = await Target.findOne({ targetId });
        if (exists) {
            return res.render('add-target', { error: 'このIDは既に登録されています。' });
        }

        await new Target({ name, targetId }).save();
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('add-target', { error: '登録中にエラーが発生しました。' });
    }
});

app.get('/search-target', requireLogin, (req, res) => {
    res.render('search-target', { error: null });
});

app.get('/search-target/result', requireLogin, async (req, res) => {
    const keyword = req.query.keyword;

    const target = await Target.findOne({
        $or: [
            { name: keyword },
            { targetId: keyword }
        ]
    });

    if (!target) {
        return res.render('search-target', { error: '対象者が見つかりませんでした' });
    }

    res.redirect(`/dashboard?targetId=${target.targetId}`);
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ===============================
// 6. サーバー起動
// ===============================
app.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
});

