# MongoDB 設定・起動ガイド (Linux Mint & Windows 共通)

本フォルダ（`mongodb/`）には、MongoDBのデータベース本体、ダンプデータ、および各環境（Linux Mint / Windows）共通の起動・管理スクリプトがまとめられています。

---

## 📁 フォルダ構成

```
mongodb/
├── config.env          # ★起動前設定ファイル (パス指定用)
├── mongodb.conf        # MongoDB設定ファイル (自動生成/更新)
├── data/               # データベース本体 (dbPath)
├── dump/               # バックアップ/同期用BSONダンプデータ
│
├── start_mongodb.sh    # [Linux] 起動スクリプト (バックグラウンド/フォアグラウンド)
├── stop_mongodb.sh     # [Linux] 停止スクリプト
├── status_mongodb.sh   # [Linux] 稼働状況確認スクリプト
├── dump_mongodb.sh     # [Linux] ダンプエクスポート
├── restore_mongodb.sh  # [Linux] ダンプから復元
│
├── start_mongodb.bat   # [Windows] 起動バッチ
├── stop_mongodb.bat    # [Windows] 停止バッチ
├── dump_mongodb.bat    # [Windows] ダンプエクスポート
├── restore_mongodb.bat # [Windows] ダンプから復元
└── README.md           # 本説明書
```

---

## ⚙️ 起動前のパス設定 (`config.env`)

他システム（Windows、別PCのLinux Mint等）でMongoDBのインストール先やデータフォルダのパスが異なる場合、**起動する前に `config.env` をテキストエディタで開いて編集してください**。

```ini
# 【1】mongod 実行ファイルのパス
# ・Linux Mint: 未指定なら PATH から自動検出
#   例: /usr/bin/mongod
# ・Windows: 未指定なら PATH や "C:\Program Files\MongoDB\Server\..." を自動探索
#   例: C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe
MONGOD_PATH=

# 【2】データベース保存先 (dbPath)
# ・未指定の場合はこの mongodb/data フォルダを自動使用します
#   Linux Mint例: /home/user/Desktop/ai/mongodb/data
#   Windows例:   C:\ai\mongodb\data
DATA_PATH=

# 【3】ログ出力先
LOG_PATH=

# 【4】ポート番号・接続IP
PORT=27017
BIND_IP=127.0.0.1
```

> **Point:**  
> `MONGOD_PATH` や `DATA_PATH` を空欄にしておくと、スクリプトが自動的に現在のフォルダ（`./data`）やシステムの `mongod` を検出するため、多くの場合そのままでも起動可能です。

---

## 🐧 Linux Mint / Ubuntu での使い方

### 1. スクリプトで起動・停止する場合
```bash
# 起動
./start_mongodb.sh

# 稼働状態の確認
./status_mongodb.sh

# 停止
./stop_mongodb.sh

# バックアップダンプ取得
./dump_mongodb.sh

# ダンプからの復元
./restore_mongodb.sh
```

### 2. OS起動時に自動実行させる場合 (systemd ユーザーサービス)
本環境では `systemd --user` に登録済みです。
```bash
systemctl --user status mongod
systemctl --user restart mongod
systemctl --user stop mongod
systemctl --user start mongod
```

---

## 🪟 Windows での使い方

1. 必要に応じて `config.env` をメモ帳等で開き、パスを設定します。
2. `start_mongodb.bat` をダブルクリック（またはコマンドプロンプトで実行）して起動します。
3. 停止する場合は `stop_mongodb.bat` を実行します。
4. データの同期・バックアップは `dump_mongodb.bat` / `restore_mongodb.bat` を利用できます。
