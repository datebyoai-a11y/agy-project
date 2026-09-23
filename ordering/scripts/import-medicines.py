#!/usr/bin/env python3
"""
薬品集マスタ.xlsx 取り込みスクリプト
/home/a/Desktop/ai/薬品集マスタ.xlsx から薬品マスタシートを読み込み、
ordering/shared/medicines.json および ordering/shared/medicines.db (SQLite) を生成します。
"""

import os
import sys
import json
import sqlite3
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

EXCEL_PATH = '/home/a/Desktop/ai/薬品集マスタ.xlsx'
OUTPUT_DIR = '/home/a/Desktop/ai/ordering/shared'
JSON_PATH = os.path.join(OUTPUT_DIR, 'medicines.json')
SQLITE_PATH = os.path.join(OUTPUT_DIR, 'medicines.db')

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def get_si_text(si):
    # 直接の <t> 要素
    t = si.find(f'{NS}t')
    if t is not None and t.text:
        return t.text
    # リッチテキスト <r><t>
    parts = []
    for r in si.findall(f'{NS}r'):
        rt = r.find(f'{NS}t')
        if rt is not None and rt.text:
            parts.append(rt.text)
    return ''.join(parts)

def col_letter_to_index(col_ref):
    letters = ''.join([c for c in col_ref if c.isalpha()])
    idx = 0
    for char in letters:
        idx = idx * 26 + (ord(char.upper()) - ord('A') + 1)
    return idx - 1

def excel_date_to_str(val):
    if not val:
        return None
    try:
        num = float(val)
        d = datetime(1899, 12, 30) + timedelta(days=num)
        return d.strftime('%Y-%m-%d')
    except Exception:
        return str(val)

def extract_medicines():
    if not os.path.exists(EXCEL_PATH):
        raise FileNotFoundError(f"Excel file not found: {EXCEL_PATH}")

    print(f"📖 薬品集マスタ読み込み開始: {EXCEL_PATH}")
    with zipfile.ZipFile(EXCEL_PATH, 'r') as z:
        # 1. 共有文字列テーブルの読み込み
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            shared_strings = [get_si_text(si) for si in tree.findall(f'{NS}si')]
        print(f"   共有文字列数: {len(shared_strings)}")

        # 2. シート1 (薬品マスタ) の読み込み
        stree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        rows = stree.findall(f'.//{NS}row')
        if not rows:
            raise ValueError("シート1にデータが存在しません")

        # ヘッダー解析
        header = {}
        for c in rows[0].findall(f'{NS}c'):
            ref = c.attrib.get('r')
            col_idx = col_letter_to_index(ref)
            t_type = c.attrib.get('t')
            v = c.find(f'{NS}v')
            val = v.text if v is not None else None
            if t_type == 's' and val is not None:
                val = shared_strings[int(val)]
            header[col_idx] = val

        medicines = []
        for r in rows[1:]:
            row_dict = {}
            for c in r.findall(f'{NS}c'):
                ref = c.attrib.get('r')
                col_idx = col_letter_to_index(ref)
                col_name = header.get(col_idx, f'col_{col_idx}')
                t_type = c.attrib.get('t')
                v = c.find(f'{NS}v')
                val = v.text if v is not None else None
                if t_type == 's' and val is not None:
                    val = shared_strings[int(val)]
                row_dict[col_name] = val

            med_id = (row_dict.get('薬品ID') or '').strip()
            name = (row_dict.get('薬品名') or '').strip()
            if not med_id and not name:
                continue

            # 区分ノーマライズ（内服薬, 注射剤, 外用薬）
            category = (row_dict.get('区分') or '').strip()
            if not category:
                if '錠' in name or 'カプセル' in name or '散' in name or 'ドライシロップ' in name:
                    category = '内服薬'
                elif '注' in name or '点滴' in name or '輸液' in name:
                    category = '注射剤'
                elif '軟膏' in name or '貼付' in name or '点眼' in name or '点鼻' in name:
                    category = '外用薬'
                else:
                    category = '内服薬'

            # 規格 (spec) & 単位 (unit) のインテリジェント抽出
            import re
            spec = ''
            spec_match = re.search(r'([0-9\.\,]+[ｍm]?[ｇg|％%|L|Ｌ|mL|ｍL|μg|単位]+.*)', name)
            if spec_match:
                spec = spec_match.group(1).strip()
            
            unit = '錠'
            if category == '注射剤' or '注' in name or '点滴' in name or '輸液' in name:
                if '輸液' in name or '点滴' in name or '500ｍL' in name or '200ｍL' in name or '100ｍL' in name:
                    unit = '袋'
                else:
                    unit = '管'
            elif 'カプセル' in name or 'Cap' in name:
                unit = 'Cap'
            elif '散' in name or '顆粒' in name or '細粒' in name or 'ドライシロップ' in name:
                unit = '包'
            elif '軟膏' in name or 'クリーム' in name or 'ゲル' in name or '点眼' in name or '点鼻' in name:
                unit = '本'
            elif '貼付' in name or 'テープ' in name or 'パップ' in name:
                unit = '枚'
            elif '坐剤' in name or '坐薬' in name:
                unit = '個'

            dosage_str = (row_dict.get('用法用量') or '').strip()
            standard_usage = dosage_str.split('。')[0] if dosage_str else ''

            item = {
                'id': med_id,
                'name': name,
                'genericName': (row_dict.get('成分名') or '').strip(),
                'dosage': dosage_str,
                'standardUsage': standard_usage,
                'spec': spec,
                'unit': unit,
                'category': category,
                'suspensionOk': (row_dict.get('簡易懸濁可否') or '').strip(),
                'crushOk': (row_dict.get('粉砕可否') or '').strip(),
                'uncapsuleOk': (row_dict.get('脱カプセル可否') or '').strip(),
                'therapeuticCategoryMajor': (row_dict.get('薬効分類（大）') or '').strip(),
                'therapeuticCategoryMiddle': (row_dict.get('薬効分類（中）') or '').strip(),
                'therapeuticCategorySmall': (row_dict.get('薬効分類（小）') or '').strip(),
                'kana': (row_dict.get('薬品カナ') or '').strip(),
                'brandType': (row_dict.get('先発/後発区分') or '').strip(),
                'genericBrandName': (row_dict.get('後発名') or '').strip(),
                'originalBrandName': (row_dict.get('先発名') or '').strip(),
                'adoptType': (row_dict.get('採用区分') or '採用').strip(),
                'statusFlag': (row_dict.get('採用状態フラグ') or '').strip(),
                'displayFlag': (row_dict.get('表示フラグ') or '1').strip(),
                'revisionDate': excel_date_to_str(row_dict.get('改訂日')),
                'replacedFromId': (row_dict.get('切り替え元ID') or '').strip(),
                'remarks': (row_dict.get('備考欄') or '').strip(),
                'pharmacyComment': (row_dict.get('薬剤科コメント') or '').strip()
            }
            medicines.append(item)

    print(f"✅ 抽出完了: {len(medicines)} 件の薬品データを取得")
    return medicines

def save_json(medicines):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(JSON_PATH, 'w', encoding='utf8') as f:
        json.dump(medicines, f, ensure_ascii=False, indent=2)
    print(f"💾 JSON保存完了: {JSON_PATH} ({os.path.getsize(JSON_PATH)} bytes)")

def save_sqlite(medicines):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if os.path.exists(SQLITE_PATH):
        os.remove(SQLITE_PATH)

    conn = sqlite3.connect(SQLITE_PATH)
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE medicines (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            generic_name TEXT,
            dosage TEXT,
            category TEXT,
            suspension_ok TEXT,
            crush_ok TEXT,
            uncapsule_ok TEXT,
            category_major TEXT,
            category_middle TEXT,
            category_small TEXT,
            kana TEXT,
            brand_type TEXT,
            generic_brand_name TEXT,
            original_brand_name TEXT,
            adopt_type TEXT,
            display_flag TEXT,
            revision_date TEXT,
            replaced_from_id TEXT,
            remarks TEXT,
            pharmacy_comment TEXT
        )
    ''')

    cursor.execute('CREATE INDEX idx_medicines_name ON medicines (name)')
    cursor.execute('CREATE INDEX idx_medicines_kana ON medicines (kana)')
    cursor.execute('CREATE INDEX idx_medicines_category ON medicines (category)')
    cursor.execute('CREATE INDEX idx_medicines_generic ON medicines (generic_name)')

    # FTS5仮想テーブル (全文検索用)
    try:
        cursor.execute('''
            CREATE VIRTUAL TABLE medicines_fts USING fts5(
                id, name, generic_name, kana, dosage, category, pharmacy_comment
            )
        ''')
        has_fts = True
    except Exception as e:
        print(f"   ℹ️ FTS5省略: {e}")
        has_fts = False

    for m in medicines:
        cursor.execute('''
            INSERT INTO medicines (
                id, name, generic_name, dosage, category,
                suspension_ok, crush_ok, uncapsule_ok,
                category_major, category_middle, category_small,
                kana, brand_type, generic_brand_name, original_brand_name,
                adopt_type, display_flag, revision_date, replaced_from_id,
                remarks, pharmacy_comment
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            m['id'], m['name'], m['genericName'], m['dosage'], m['category'],
            m['suspensionOk'], m['crushOk'], m['uncapsuleOk'],
            m['therapeuticCategoryMajor'], m['therapeuticCategoryMiddle'], m['therapeuticCategorySmall'],
            m['kana'], m['brandType'], m['genericBrandName'], m['originalBrandName'],
            m['adoptType'], m['displayFlag'], m['revisionDate'], m['replacedFromId'],
            m['remarks'], m['pharmacyComment']
        ))

        if has_fts:
            cursor.execute('''
                INSERT INTO medicines_fts (id, name, generic_name, kana, dosage, category, pharmacy_comment)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                m['id'], m['name'], m['genericName'], m['kana'], m['dosage'], m['category'], m['pharmacyComment']
            ))

    conn.commit()
    conn.close()
    print(f"💾 SQLite DB保存完了: {SQLITE_PATH} ({os.path.getsize(SQLITE_PATH)} bytes)")

def main():
    try:
        medicines = extract_medicines()
        save_json(medicines)
        save_sqlite(medicines)
        print("\n🎉 薬剤データベースの作成が完了しました！")
    except Exception as e:
        print(f"❌ エラー発生: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
