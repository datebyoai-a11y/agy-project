#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🏥 Cloudflare トンネル公開URL メール自動通知スクリプト
URLを以下の宛先にメール通知します：
・datebyoai@gmail.com
・rentogen@koyukai-g.jp
・pt.koyama@koyukai-g.jp
"""
import sys
import os
import json
import smtplib
import ssl
from email.mime.text import MIMEText
from email.utils import formatdate
from datetime import datetime

CONFIG_FILE = "/home/a/.mail_config.json"
LOG_FILE = "/home/a/trycloudflare_mail.log"

DEFAULT_RECIPIENTS = [
    "datebyoai@gmail.com",
    "rentogen@koyukai-g.jp",
    "pt.koyama@koyukai-g.jp"
]

DEFAULT_CONFIG = {
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_user": "datebyoai@gmail.com",
    "smtp_pass": "",  # Googleアカウントの16桁アプリパスワード
    "to_emails": DEFAULT_RECIPIENTS
}

def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}\n"
    print(line, end="")
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass

def load_config():
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2, ensure_ascii=False)
        os.chmod(CONFIG_FILE, 0o600)
        return DEFAULT_CONFIG
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # 宛先リストの正規化
            if "to_emails" not in data:
                if "to_email" in data:
                    raw = data["to_email"]
                    if isinstance(raw, list):
                        data["to_emails"] = raw
                    elif isinstance(raw, str):
                        data["to_emails"] = [e.strip() for e in raw.split(",") if e.strip()]
                    else:
                        data["to_emails"] = DEFAULT_RECIPIENTS
                else:
                    data["to_emails"] = DEFAULT_RECIPIENTS
            # 指定の3件が必ず含まれるように保証
            for req_email in DEFAULT_RECIPIENTS:
                if req_email not in data["to_emails"]:
                    data["to_emails"].append(req_email)
            return data
    except Exception as e:
        log(f"設定ファイル読み込みエラー: {e}")
        return DEFAULT_CONFIG

def send_email(url):
    config = load_config()
    smtp_user = config.get("smtp_user", "datebyoai@gmail.com")
    smtp_pass = config.get("smtp_pass", "").strip()
    to_emails = config.get("to_emails", DEFAULT_RECIPIENTS)
    if isinstance(to_emails, str):
        to_emails = [e.strip() for e in to_emails.split(",") if e.strip()]
    if not to_emails:
        to_emails = DEFAULT_RECIPIENTS

    smtp_host = config.get("smtp_host", "smtp.gmail.com")
    smtp_port = int(config.get("smtp_port", 587))

    recipients_str = ", ".join(to_emails)

    if not smtp_pass:
        log("⚠️ [メール未送信] Googleアカウントのアプリパスワードが未設定です。")
        log(f"   送信予定先: {recipients_str}")
        log(f"   設定ファイル: {CONFIG_FILE} の 'smtp_pass' に16桁のアプリパスワードを入力してください。")
        return False

    now_str = datetime.now().strftime("%Y年%m月%d日 %H:%M:%S")
    subject = f"🏥【交雄会だて病院】外部公開URL通知: {url}"

    body = f"""交雄会だて病院 医療関係者各位

Cloudflare トンネルが更新され、新しい外部公開URLが確定しました。
インターネット経由で以下のURLから安全に各システムをご利用いただけます。

=============================================================
【アクセスURL】
👉 {url}

【更新日時】
{now_str}

【対象システム】
・医療統合ポータル (Port 8000)
・電子カルテ / インシデント管理 (Port 3000)
・病棟フロアマップ・ベッドボード (2F医療病棟 / 3Fしおかぜ / 4Fうみかぜ)
・放射線科オーダー (CT/透視/照射録) & 指示受けモニター
・注射・点滴オーダー & ラベル印刷
・リハビリテーション指示書Ver3.0

【ログインアカウント】
・管理者: admin / pass
・各職員: 登録済み職員ID / パスワード
=============================================================
※本メールはトンネル起動・再接続時に自動送信されています。
"""

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = f"交雄会だて病院 医療システム <{smtp_user}>"
    msg["To"] = recipients_str
    msg["Date"] = formatdate(localtime=True)

    try:
        context = ssl.create_default_context()
        log(f"📧 SMTPサーバー接続中: {smtp_host}:{smtp_port}...")
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, to_emails, msg.as_string())
        log(f"🎉 メール送信完了: {recipients_str} 宛てに公開URL ({url}) を送信しました！")
        return True
    except Exception as e:
        log(f"❌ メール送信失敗: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1:
        target_url = sys.argv[1].strip()
    else:
        # デスクトップのファイルまたはログからURLを抽出
        url_file = "/home/a/Desktop/現在の公開URL.txt"
        target_url = ""
        if os.path.exists(url_file):
            with open(url_file, "r", encoding="utf-8") as f:
                for line in f:
                    if "trycloudflare.com" in line:
                        for word in line.split():
                            if "trycloudflare.com" in word:
                                target_url = word.strip()
                                break
        if not target_url:
            log("エラー: 対象URLが指定されていません。")
            sys.exit(1)

    send_email(target_url)
