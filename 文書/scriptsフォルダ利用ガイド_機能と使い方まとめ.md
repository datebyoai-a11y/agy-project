# 🏥 交雄会だて病院 医療統合システム
# scripts フォルダ内スクリプト 機能・使い方リファレンスマニュアル

本ドキュメントは、`/home/a/src/github.com/datebyoai-a11y/agy-project/scripts/` ディレクトリ内に配置されている各種スクリプトの機能概要、用途、および具体的な実行方法を体系的にまとめた管理・運用マニュアルです。

---

## 📑 目次

1. [システム一括起動・管理スクリプト](#1-システム一括起動管理スクリプト)
   - `start.sh` (推奨一括管理ツール)
   - `start.js` (Node.js 一括ランチャー)
   - `package.json` (npm scripts 定義)
2. [データベース（MongoDB レプリカセット）管理スクリプト](#2-データベースmongodb-レプリカセット管理スクリプト)
   - `setup-mongodb-replica-set.sh` (レプリカセット自動構築)
   - `mongo-rs-status.sh` (レプリカセット稼働確認)
3. [データ保護・ログ駆動型再構築・ログ管理スクリプト](#3-データ保護ログ駆動型再構築ログ管理スクリプト)
   - `rebuild-db.sh` / `rebuild-database.js` (ログ駆動型DB完全復元)
   - `export-existing-to-log.js` (既存DBのスナップショット出力)
   - `rotate-logs.sh` / `rotate-logs.js` (ログの日次圧縮・ローテーション)
4. [外部公開・リモートアクセス・トンネル連携スクリプト](#4-外部公開リモートアクセストンネル連携スクリプト)
   - `start-trycloudflare.sh` / `setup-trycloudflare.sh` (Cloudflareトンネル)
   - `send_tunnel_url.py` (公開URLの自動メール通知)
   - `connect-home.sh` / `connect-home.bat` (外出先PCからのワンクリック接続)
   - `setup-vnc.sh` / `setup-novnc.sh` (リモートデスクトップ基盤)
5. [サーバーセキュリティ・インフラ設定スクリプト](#5-サーバーセキュリティインフラ設定スクリプト)
   - `setup_ssh_port_50022.sh` (SSHポート変更＆UFW開放)
   - `disable_ssh_password.sh` (SSHパスワード認証無効化)
   - `install_clamav.sh` (ウイルス対策ソフト導入)
6. [クイックコマンド対照表](#6-クイックコマンド対照表)

---

## 1. システム一括起動・管理スクリプト

院内の全サブシステム（計9システム）を1コマンドで起動・停止・監視するための基盤スクリプトです。

### 📄 `start.sh`
- **種別**: Bash シェルスクリプト
- **機能**:
  - 全システムの一括バックグラウンド起動（デーモン化）、フォアグラウンド起動、停止、再起動、ステータス確認を統合管理します。
  - プロセス管理 (`.launcher.pid`) およびポートの二重起動防止（`fuser` クリーンアップ）を自動実行します。
- **使い方**:
  ```bash
  # 1. バックグラウンド（常駐モード）で全サーバーを一括起動（推奨）
  ./scripts/start.sh start

  # 2. 全システムの稼働ステータス（🟢/🔴）を確認
  ./scripts/start.sh status

  # 3. 全サーバーを一括停止
  ./scripts/start.sh stop

  # 4. 全サーバーを一括再起動
  ./scripts/start.sh restart

  # 5. フォアグラウンド起動（コンソールにログを常時流し、Ctrl+Cで全停止）
  ./scripts/start.sh
  ```
- **ログ確認**:
  バックグラウンド起動時のログはプロジェクト直下の `launcher.log` に記録されます。
  ```bash
  tail -f launcher.log
  ```

---

### 📄 `start.js`
- **種別**: Node.js スクリプト
- **機能**:
  - `start.sh` の内部で呼び出される中核エンジンです。
  - MongoDBレプリカセット（rs0: 27017, 27018, 27019）のヘルスチェックを自動で行い、以下の全サーバーを子プロセスとして並行起動・死活監視します：
    1. **医療統合ポータル** (Port 8000)
    2. **放射線科オーダー ＆ 帳票印刷** (Port 8080)
    3. **放射線科 指示受け・実施モニター** (Port 8081)
    4. **注射・点滴オーダー ＆ ラベル印刷** (Port 8082)
    5. **リハビリテーション指示オーダー** (Port 8083)
    6. **内服・外用処方オーダー ＆ 処方箋印刷** (Port 8084)
    7. **リハビリ科 指示受け・実施モニター** (Port 8085)
    8. **インシデント管理 / 電子カルテ** (Port 3000)
    9. **統合オーダリング総合ポータル** (Port 4000)
- **使い方**:
  ```bash
  node scripts/start.js
  ```

---

### 📄 `package.json`
- **種別**: npm 設定ファイル
- **機能**: npm コマンド経由での起動をサポートします。
- **使い方**:
  ```bash
  cd scripts
  npm run start:daemon  # バックグラウンド起動
  npm run status        # ステータス確認
  npm run stop          # 停止
  npm run restart       # 再起動
  ```

---

## 2. データベース（MongoDB レプリカセット）管理スクリプト

高可用性（HA）とリアルタイムデータ二重化を実現するレプリカセット管理ツールです。

### 📄 `setup-mongodb-replica-set.sh`
- **種別**: Bash シェルスクリプト (管理者権限要)
- **機能**:
  - 単一構成のMongoDBを、Primary (`27017`)、Secondary (`27018`)、Arbiter (`27019`) の3ノード構成（レプリカセット名: `rs0`）へ自動構築・再構成します。
  - systemdサービス定義、設定ファイル生成、初期化コマンドを自動適用します。
- **使い方**:
  ```bash
  sudo ./scripts/setup-mongodb-replica-set.sh
  ```

---

### 📄 `mongo-rs-status.sh`
- **種別**: Bash ＋ mongosh スクリプト
- **機能**:
  - 現在のレプリカセットの状態（Primary / Secondary / Arbiter の役割、各ノードのUP/DOWNヘルス、ハートビート、データ同期遅延）を日本語でわかりやすく整形して出力します。
- **使い方**:
  ```bash
  ./scripts/mongo-rs-status.sh
  ```

---

## 3. データ保護・ログ駆動型再構築・ログ管理スクリプト

万が一データベースが物理故障や人為的ミスで完全喪失した場合でも、追記型監査ログ（Event Sourcing）からミリ秒単位で完全に過去データを巻き戻し・再現する災害復旧（DR）機構です。

### 📄 `rebuild-db.sh` / `rebuild-database.js`
- **種別**: Bash ラッパー / Node.js 再構築エンジン
- **機能**:
  - `logs/operations/operations_YYYY-MM-DD.jsonl`（および `.gz` 圧縮アーカイブ）に記録された監査ログを先頭から順に読み込み、DBコレクションへ忠実にリプレイ（再構築）します。
- **主なオプション**:
  - `--dry-run`: 実際に書き込まず、シミュレーションと復元サマリーのみ出力
  - `--drop`: 既存データを全削除してクリーンな初期状態から完全復元
  - `--target=<コレクション名>`: 指定したコレクションのみ復元（例: `radiologyorders`, `articles`, `patients`）
  - `--log=<ファイルパス>`: 指定のログファイル（`.jsonl` または `.gz`）から復元
  - `--verbose`: 詳細ログ出力
- **使い方**:
  ```bash
  # シミュレーション実行（書き込みなし・確認のみ）
  ./scripts/rebuild-db.sh --dry-run

  # 全コレクションを初期化して過去ログから完全復元
  ./scripts/rebuild-db.sh --drop

  # 放射線オーダーのみを復元
  ./scripts/rebuild-db.sh --target=radiologyorders
  ```

---

### 📄 `export-existing-to-log.js`
- **種別**: Node.js スクリプト
- **機能**:
  - すでにDBに存在する既存のカルテ記事、放射線オーダー、患者マスタ、ユーザーマスタを、監査ログ形式（スナップショット操作ログ）として出力・保存します。
- **使い方**:
  ```bash
  node scripts/export-existing-to-log.js
  ```

---

### 📄 `rotate-logs.sh` / `rotate-logs.js`
- **種別**: Bash ラッパー / Node.js 圧縮ローテーションツール
- **機能**:
  - 日付が変わった古い操作ログ（`operations_YYYY-MM-DD.jsonl`）を検出し、Gzip形式（`.gz`）へ安全に圧縮してディスク容量を節約します。
  - cron等の定期ジョブへの登録に適しています。
- **主なオプション**:
  - `--date=YYYY-MM-DD`: 特定日のログを指定してローテート
  - `--force`: 当日分のログも含めて強制圧縮
  - `--migrate`: 単一ログファイルを日付別に分割
- **使い方**:
  ```bash
  # 過去ログをまとめて自動ローテーション・圧縮
  ./scripts/rotate-logs.sh

  # 特定日付のログを圧縮
  ./scripts/rotate-logs.sh --date=2026-10-01
  ```

---

## 4. 外部公開・リモートアクセス・トンネル連携スクリプト

院外からの遠隔診療支援、出張先からのアクセス、在宅勤務時の安全な接続を提供します。

### 📄 `start-trycloudflare.sh` / `setup-trycloudflare.sh`
- **種別**: Bash シェルスクリプト
- **機能**:
  - ルーターのポート開放や固定IP契約を行うことなく、Cloudflareのゼロトラスト技術（Quick Tunnel）を利用して、Port 8000（医療統合ポータル）の一時安全な公開URL（`https://*.trycloudflare.com`）を発行・接続維持します。
  - 発行されたURLはデスクトップ上の `現在の公開URL.txt` に自動更新され、関係者へメール通知されます。
- **使い方**:
  ```bash
  # Cloudflare トンネルのインストール（初回のみ）
  ./scripts/setup-trycloudflare.sh

  # トンネルを起動して公開開始
  ./scripts/start-trycloudflare.sh
  ```

---

### 📄 `send_tunnel_url.py`
- **種別**: Python 3 スクリプト
- **機能**:
  - `start-trycloudflare.sh` から呼び出され、発行された最新の外部アクセスURLを以下の指定医師・技師・スタッフ宛にSMTPメール送信します：
    - `datebyoai@gmail.com`
    - `rentogen@koyukai-g.jp`
    - `pt.koyama@koyukai-g.jp`
- **使い方**:
  ```bash
  python3 scripts/send_tunnel_url.py "https://example.trycloudflare.com"
  ```

---

### 📄 `connect-home.sh` / `connect-home.bat`
- **種別**: Bash スクリプト (Linux/Mac用) / バッチファイル (Windows用)
- **機能**:
  - 外出先や自宅の手元PC側で実行するクライアントスクリプトです。
  - 院内サーバーのPort 50022へ暗号化SSHトンネルを確立し、以下を手元PCのローカルポートへ安全にポートフォワーディングします：
    - 手元PC `localhost:6080` ➔ サーバーの noVNC（画面共有）
    - 手元PC `localhost:8000` ➔ サーバーの 医療統合ポータル
  - 自動でブラウザを立ち上げ、リモート画面を表示します。
- **使い方**:
  - **Linux / Mac**: `./scripts/connect-home.sh`
  - **Windows**: `scripts\connect-home.bat` をダブルクリック

---

### 📄 `setup-vnc.sh` / `setup-novnc.sh`
- **種別**: Bash シェルスクリプト (管理者権限要)
- **機能**:
  - サーバー本体のGUIデスクトップ（Linux Mint Cinnamon）を遠隔操作するための基盤を設定します。
  - `x11vnc` および Webブラウザから画面共有できる `noVNC`（WebSockets）をインストールし、ローカルホスト（`127.0.0.1`）限定で安全に待ち受けるようsystemdに登録します。
- **使い方**:
  ```bash
  sudo ./scripts/setup-vnc.sh
  sudo ./scripts/setup-novnc.sh
  ```

---

## 5. サーバーセキュリティ・インフラ設定スクリプト

サイバーセキュリティおよび不正侵入防止のための基盤強化スクリプトです。

### 📄 `setup_ssh_port_50022.sh`
- **種別**: Bash シェルスクリプト (管理者権限要)
- **機能**:
  - インターネット経由での自動スキャン・ボット攻撃を回避するため、SSHの待ち受けポートを標準の `22` 番から `50022` 番へ変更します。
  - Linuxのファイアウォール（UFW）にPort 50022の許可ルールを自動追加します。
- **使い方**:
  ```bash
  sudo ./scripts/setup_ssh_port_50022.sh
  ```

---

### 📄 `disable_ssh_password.sh`
- **種別**: Bash シェルスクリプト (管理者権限要)
- **機能**:
  - SSH接続においてパスワードによる認証を完全無効化し、「暗号鍵（公開鍵認証）」のみでのアクセスに制限します。
  - パスワード総当たり（ブルートフォース）攻撃による不正侵入を100%遮断します。
- **使い方**:
  ```bash
  sudo ./scripts/disable_ssh_password.sh
  ```

---

### 📄 `install_clamav.sh`
- **種別**: Bash シェルスクリプト (管理者権限要)
- **機能**:
  - Linux用ウイルス対策エンジン「ClamAV」を導入し、ウイルス定義ファイルの自動更新デーモン（`clamav-freshclam`）および定期スキャンを設定します。
- **使い方**:
  ```bash
  sudo ./scripts/install_clamav.sh
  ```

---

## 6. クイックコマンド対照表

日常のシステム運用でよく使用する操作のクイックリファレンスです。

| 目的 | 実行コマンド | 備考 |
| :--- | :--- | :--- |
| **医療システム一括起動** | `./scripts/start.sh start` | バックグラウンド常駐（推奨） |
| **稼働状態チェック** | `./scripts/start.sh status` | 全9サービス＋MongoDBの死活確認 |
| **医療システム一括停止** | `./scripts/start.sh stop` | ポート解放・安全終了 |
| **医療システム一括再起動** | `./scripts/start.sh restart` | 停止後に自動再起動 |
| **DBレプリカ状態確認** | `./scripts/mongo-rs-status.sh` | 二重化ノード状態の確認 |
| **DBデータの完全復元** | `./scripts/rebuild-db.sh --drop` | 操作ログからDBを最新状態へ再構築 |
| **復元シミュレーション** | `./scripts/rebuild-db.sh --dry-run` | 書き込まずに復元件数を確認 |
| **ログの圧縮ローテート** | `./scripts/rotate-logs.sh` | 過去ログを.gzに自動圧縮 |
| **外部トンネル公開** | `./scripts/start-trycloudflare.sh` | ポート開放なしで一時外部公開 |

---
*マニュアル作成日: 2026年10月2日*  
*作成場所: `/home/a/src/github.com/datebyoai-a11y/agy-project/文書/scriptsフォルダ利用ガイド_機能と使い方まとめ.md`*
