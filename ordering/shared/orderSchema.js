/**
 * オーダリングソフトの標準データスキーマ & ヘルパーユーティリティ
 */

// オーダー種別定数
const OrderTypes = {
  PRESCRIPTION: 'PRESCRIPTION', // 処方オーダー (内服・外用)
  IV: 'IV',                     // 点滴・注射指示 (注射指示書準拠)
  RADIOLOGY: 'RADIOLOGY',       // 放射線科検査オーダー (CT検査依頼書/透視検査依頼書/一般撮影)
  LAB_EXAM: 'LAB_EXAM',         // 検査オーダー (生理検査依頼書/検体検査)
  REHAB: 'REHAB',               // リハビリテーション指示書
  MEAL: 'MEAL'                  // 食事選択オーダー
};

// 共通オーダー詳細仕様 (details):
// 全種別共通で details.remarks (自由記載欄: 特記事項・指示・申し送り) を保持可能

// オーダーステータス定数
const OrderStatus = {
  SENT: 'SENT',                 // 送信完了
  ACCEPTED: 'ACCEPTED',         // 受信側で受付完了
  IN_PROGRESS: 'IN_PROGRESS',   // 鑑査・撮影・調剤等の実施中
  COMPLETED: 'COMPLETED',       // 実施・配膳・調剤完了
  CANCELLED: 'CANCELLED'        // 中止・キャンセル
};

// 優先度定数
const OrderPriority = {
  ROUTINE: 'ROUTINE', // 通常
  URGENT: 'URGENT',   // 至急
  STAT: 'STAT'        // 緊急・超至急
};

// サンプル患者マスタ (だて病院様式準拠プリセット)
const SamplePatients = [
  { id: 'P001', name: '安部 光良', kana: 'アベ テルヨシ', age: 70, gender: '男', birthDate: '1946-12-06', era: '昭21', ward: 'しおかぜ', room: '302号室', department: '内科', infection: '無', mobility: '車椅子', height: 164, weight: 58, examCategory: '入院時検査' },
  { id: 'P002', name: '山田 太郎', kana: 'ヤマダ タロウ', age: 45, gender: '男', birthDate: '1981-05-12', era: '昭56', ward: 'うみかぜ', room: '205号室', department: '外科', infection: '無', mobility: '徒歩', height: 172, weight: 68, examCategory: '一般診療' },
  { id: 'P003', name: '佐藤 花子', kana: 'サトウ ハナコ', age: 89, gender: '女', birthDate: '1937-08-23', era: '昭12', ward: '医療', room: '412号室', department: '総合診療科', infection: '有(MRSA)', mobility: 'ベッド', height: 148, weight: 42, examCategory: '一般診療' },
  { id: 'P004', name: '鈴木 一郎', kana: 'スズキ イチロウ', age: 62, gender: '男', birthDate: '1964-02-17', era: '昭39', ward: '外来', room: '外来処置室', department: '循環器内科', infection: '無', mobility: '徒歩', height: 168, weight: 65, examCategory: '健診' },
  { id: 'P005', name: '高橋 五郎', kana: 'タカハシ ゴロウ', age: 81, gender: '男', birthDate: '1945-11-30', era: '昭20', ward: 'プライム', room: '501号室', department: '整形外科', infection: '無', mobility: 'ストレッチャー', height: 160, weight: 52, examCategory: '入院時検査' }
];

// オーダーID生成関数 (ORD-YYYYMMDD-XXXX)
function generateOrderId(prefix = 'ORD') {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${ymd}-${rand}`;
}

module.exports = {
  OrderTypes,
  OrderStatus,
  OrderPriority,
  SamplePatients,
  generateOrderId
};
