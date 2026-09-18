const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

const app = express();
const session = require("express-session");

app.use(session({
  secret: "secret-key",
  resave: false,
  saveUninitialized: true
}));

// ★ MongoDB 接続（新しい書き方）
mongoose.connect("mongodb://127.0.0.1:27017/myappdb")
  .then(() => console.log("MongoDB 接続成功"))
  .catch(err => console.error("MongoDB 接続失敗:", err));
  console.log("★ mongoose.connect の後まで実行されている");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

app.use("/auth", require("./routes/auth"));

console.log("User.js path:", require.resolve("./models/User"));

app.use("/person", require("./routes/person"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

app.listen(3000, () => console.log("Server running"));
