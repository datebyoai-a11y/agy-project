/**
 * 🏥 2F医療病棟 実機ベッドボード写真 (IMG_20261001_132451077_HDR.jpg) 完全再現シードスクリプト
 * 
 * 入院患者数: 59名 (男: 22名, 女: 37名)
 * 担送: 35名, 護送: 23名, 独歩: 1名
 * 空きベッド数: 3床 (男: 0, 女: 2) -> 207-1, 221-4, 222-1
 * 全62床
 */

const mongoose = require('mongoose');
const Patient = require('./models/Patient');
const TargetPerson = require('/home/a/Desktop/ai/agy-project/incident-system/models/TargetPerson');

const PHOTO_PATIENTS_2F = [
  // 215 (個室・男・トイレ付)
  { patientId: 'P21501', name: '坂本 広行', kana: 'サカモト ヒロユキ', gender: '男性', ward: '2F医療病棟', room: '215-1', mobility: '独歩', sensor: false, age: 72, department: '療養内科' },

  // 213 (4人部屋・女)
  { patientId: 'P21301', name: '熊崎 百合子', kana: 'クマザキ ユリコ', gender: '女性', ward: '2F医療病棟', room: '213-1', mobility: '護送', sensor: false, age: 84, department: '療養内科' },
  { patientId: 'P21302', name: '寺田 三千代', kana: 'テラダ ミチヨ', gender: '女性', ward: '2F医療病棟', room: '213-2', mobility: '護送', sensor: true, age: 88, department: '療養内科' },
  { patientId: 'P21303', name: '三沢 ヨシ子', kana: 'ミサワ ヨシコ', gender: '女性', ward: '2F医療病棟', room: '213-3', mobility: '担送', sensor: false, age: 91, department: '療養内科' },
  { patientId: 'P21304', name: '西舘 恵子', kana: 'ニシダテ ケイコ', gender: '女性', ward: '2F医療病棟', room: '213-4', mobility: '担送', sensor: false, age: 79, department: '療養内科' },

  // 212 (4人部屋・男)
  { patientId: 'P21201', name: '南家 徳雄', kana: 'ナンケ トクオ', gender: '男性', ward: '2F医療病棟', room: '212-1', mobility: '担送', sensor: false, age: 80, department: '療養外科' },
  { patientId: 'P21202', name: '阿部 武夫', kana: 'アベ タケオ', gender: '男性', ward: '2F医療病棟', room: '212-2', mobility: '護送', sensor: false, age: 85, department: '療養内科' },
  { patientId: 'P21203', name: '辻 一太郎', kana: 'ツジ イチタロウ', gender: '男性', ward: '2F医療病棟', room: '212-3', mobility: '護送', sensor: false, age: 76, department: '療養内科' },
  { patientId: 'P21204', name: '佐藤 一以', kana: 'サトウ カズイ', gender: '男性', ward: '2F医療病棟', room: '212-4', mobility: '護送', sensor: false, age: 83, department: '療養内科' },

  // 211 (4人部屋・男)
  { patientId: 'P21101', name: '今野 巌', kana: 'コンノ イワオ', gender: '男性', ward: '2F医療病棟', room: '211-1', mobility: '護送', sensor: true, age: 86, department: '療養内科' },
  { patientId: 'P21102', name: '成田 四郎', kana: 'ナリタ シロウ', gender: '男性', ward: '2F医療病棟', room: '211-2', mobility: '護送', sensor: false, age: 78, department: '療養内科' },
  { patientId: 'P21103', name: '白井 隆大', kana: 'シライ タカヒロ', gender: '男性', ward: '2F医療病棟', room: '211-3', mobility: '護送', sensor: true, age: 71, department: '療養内科' },
  { patientId: 'P21104', name: '菅原 亮', kana: 'スガワラ リョウ', gender: '男性', ward: '2F医療病棟', room: '211-4', mobility: '護送', sensor: false, age: 82, department: '療養内科' },

  // 208 (個室・男・トイレ付)
  { patientId: 'P20801', name: '齊藤 和義', kana: 'サイトウ カズヨシ', gender: '男性', ward: '2F医療病棟', room: '208-1', mobility: '護送', sensor: false, age: 75, department: '療養内科' },

  // 207 (個室・トイレ付・空床)

  // 206 (個室・女・トイレ付)
  { patientId: 'P20601', name: '草場 勝子', kana: 'クサバ カツコ', gender: '女性', ward: '2F医療病棟', room: '206-1', mobility: '担送', sensor: false, age: 89, department: '療養内科' },

  // 205 (4人部屋・男)
  { patientId: 'P20501', name: '大津 広明', kana: 'オオツ ヒロアキ', gender: '男性', ward: '2F医療病棟', room: '205-1', mobility: '担送', sensor: false, age: 77, department: '療養内科' },
  { patientId: 'P20502', name: '武隈 進', kana: 'タケクマ ススム', gender: '男性', ward: '2F医療病棟', room: '205-2', mobility: '担送', sensor: false, age: 81, department: '療養内科' },
  { patientId: 'P20503', name: '有賀 幸一', kana: 'アリガ コウイチ', gender: '男性', ward: '2F医療病棟', room: '205-3', mobility: '担送', sensor: false, age: 83, department: '療養内科' },
  { patientId: 'P20504', name: '上野 敏彰', kana: 'ウエノ トシアキ', gender: '男性', ward: '2F医療病棟', room: '205-4', mobility: '護送', sensor: true, age: 79, department: '療養内科' },

  // 203 (4人部屋・女)
  { patientId: 'P20301', name: '木村 公子', kana: 'キムラ キミコ', gender: '女性', ward: '2F医療病棟', room: '203-1', mobility: '担送', sensor: false, age: 93, department: '療養内科' },
  { patientId: 'P20302', name: '森 くるみ', kana: 'モリ クルミ', gender: '女性', ward: '2F医療病棟', room: '203-2', mobility: '担送', sensor: false, age: 82, department: '療養内科' },
  { patientId: 'P20303', name: '菅原 幸穂', kana: 'スガワラ サチホ', gender: '女性', ward: '2F医療病棟', room: '203-3', mobility: '担送', sensor: false, age: 87, department: '療養内科' },
  { patientId: 'P20304', name: '中瀬 冨士子', kana: 'ナカセ フジコ', gender: '女性', ward: '2F医療病棟', room: '203-4', mobility: '担送', sensor: false, age: 90, department: '療養内科' },

  // 202 (4人部屋・女)
  { patientId: 'P20201', name: '大森 千江子', kana: 'オオモリ チエコ', gender: '女性', ward: '2F医療病棟', room: '202-1', mobility: '担送', sensor: false, age: 85, department: '療養内科' },
  { patientId: 'P20202', name: '古川 満里子', kana: 'フルカワ マリコ', gender: '女性', ward: '2F医療病棟', room: '202-2', mobility: '担送', sensor: false, age: 86, department: '療養内科' },
  { patientId: 'P20203', name: '松山 リツ子', kana: 'マツヤマ リツコ', gender: '女性', ward: '2F医療病棟', room: '202-3', mobility: '担送', sensor: false, age: 92, department: '療養内科' },
  { patientId: 'P20204', name: '木戸部 良子', kana: 'キドベ リョウコ', gender: '女性', ward: '2F医療病棟', room: '202-4', mobility: '担送', sensor: false, age: 80, department: '療養内科' },

  // 201 (4人部屋・女)
  { patientId: 'P20101', name: '奈良 幸枝', kana: 'ナラ ユキエ', gender: '女性', ward: '2F医療病棟', room: '201-1', mobility: '護送', sensor: false, age: 88, department: '療養内科' },
  { patientId: 'P20102', name: '野呂 京子', kana: 'ノロ キョウコ', gender: '女性', ward: '2F医療病棟', room: '201-2', mobility: '担送', sensor: false, age: 84, department: '療養内科' },
  { patientId: 'P20103', name: '矢島 啓子', kana: 'ヤジマ ケイコ', gender: '女性', ward: '2F医療病棟', room: '201-3', mobility: '護送', sensor: false, age: 89, department: '療養内科' },
  { patientId: 'P20104', name: '長澤 和加子', kana: 'ナガサワ ワカコ', gender: '女性', ward: '2F医療病棟', room: '201-4', mobility: '担送', sensor: false, age: 81, department: '療養内科' },

  // 中央上部
  // 216 (個室・女・トイレ付)
  { patientId: 'P21601', name: '島崎 久美子', kana: 'シマザキ クミコ', gender: '女性', ward: '2F医療病棟', room: '216-1', mobility: '護送', sensor: false, age: 83, department: '療養内科' },
  // 217 (個室・女・トイレ付)
  { patientId: 'P21701', name: '武井 昭子', kana: 'タケイ アキコ', gender: '女性', ward: '2F医療病棟', room: '217-1', mobility: '護送', sensor: true, age: 87, department: '療養内科' },

  // 右列
  // 218 (4人部屋・男)
  { patientId: 'P21801', name: '工藤 秀夫', kana: 'クドウ ヒデオ', gender: '男性', ward: '2F医療病棟', room: '218-1', mobility: '担送', sensor: false, age: 79, department: '療養外科' },
  { patientId: 'P21802', name: '篠原 茂', kana: 'シノハラ シゲル', gender: '男性', ward: '2F医療病棟', room: '218-2', mobility: '担送', sensor: false, age: 86, department: '療養内科' },
  { patientId: 'P21803', name: '三浦 建昭', kana: 'ミウラ タテアキ', gender: '男性', ward: '2F医療病棟', room: '218-3', mobility: '護送', sensor: false, age: 74, department: '療養内科' },
  { patientId: 'P21804', name: '古里 敏明', kana: 'フルサト トシアキ', gender: '男性', ward: '2F医療病棟', room: '218-4', mobility: '担送', sensor: false, age: 83, department: '療養内科' },

  // 220 (4人部屋・女)
  { patientId: 'P22001', name: '後藤 代子', kana: 'ゴトウ シヨコ', gender: '女性', ward: '2F医療病棟', room: '220-1', mobility: '護送', sensor: false, age: 94, department: '療養内科' },
  { patientId: 'P22002', name: '高橋 クニ', kana: 'タカハシ クニ', gender: '女性', ward: '2F医療病棟', room: '220-2', mobility: '護送', sensor: false, age: 95, department: '療養内科' },
  { patientId: 'P22003', name: '佐藤 はるみ', kana: 'サトウ ハルミ', gender: '女性', ward: '2F医療病棟', room: '220-3', mobility: '担送', sensor: false, age: 81, department: '療養内科' },
  { patientId: 'P22004', name: '伊藤 満子', kana: 'イトウ ミツコ', gender: '女性', ward: '2F医療病棟', room: '220-4', mobility: '担送', sensor: false, age: 89, department: '療養内科' },

  // 221 (4人部屋・女)
  { patientId: 'P22101', name: '島林 昌子', kana: 'シマバヤシ マサコ', gender: '女性', ward: '2F医療病棟', room: '221-1', mobility: '担送', sensor: false, age: 88, department: '療養内科' },
  { patientId: 'P22102', name: '高木 幸子', kana: 'タカギ サチコ', gender: '女性', ward: '2F医療病棟', room: '221-2', mobility: '担送', sensor: false, age: 85, department: '療養内科' },
  { patientId: 'P22103', name: '菊池 サダヱ', kana: 'キクチ サダエ', gender: '女性', ward: '2F医療病棟', room: '221-3', mobility: '担送', sensor: false, age: 92, department: '療養内科' },
  // 221-4 (空床)

  // 222 (4人部屋・女)
  // 222-1 (空床)
  { patientId: 'P22202', name: '高橋 貞子', kana: 'タカハシ サダコ', gender: '女性', ward: '2F医療病棟', room: '222-2', mobility: '護送', sensor: true, age: 87, department: '療養内科' },
  { patientId: 'P22203', name: '岡崎 百合子', kana: 'オカザキ ユリコ', gender: '女性', ward: '2F医療病棟', room: '222-3', mobility: '担送', sensor: false, age: 86, department: '療養内科' },
  { patientId: 'P22204', name: '薄石 ミヨ', kana: 'ウスイシ ミヨ', gender: '女性', ward: '2F医療病棟', room: '222-4', mobility: '護送', sensor: false, age: 93, department: '療養内科' },

  // 223 (4人部屋・男)
  { patientId: 'P22301', name: '大黒 武彦', kana: 'オオグロ タケヒコ', gender: '男性', ward: '2F医療病棟', room: '223-1', mobility: '担送', sensor: false, age: 78, department: '療養内科' },
  { patientId: 'P22302', name: '竹島 勝美', kana: 'タケシマ カツミ', gender: '男性', ward: '2F医療病棟', room: '223-2', mobility: '担送', sensor: false, age: 80, department: '療養外科' },
  { patientId: 'P22303', name: '小野 茂樹', kana: 'オノ シゲキ', gender: '男性', ward: '2F医療病棟', room: '223-3', mobility: '担送', sensor: false, age: 84, department: '療養内科' },
  { patientId: 'P22304', name: '大越 英次', kana: 'オオコシ エイジ', gender: '男性', ward: '2F医療病棟', room: '223-4', mobility: '護送', sensor: false, age: 75, department: '療養内科' },

  // 225 (4人部屋・女)
  { patientId: 'P22501', name: '松本 ツナヨ', kana: 'マツモト ツナヨ', gender: '女性', ward: '2F医療病棟', room: '225-1', mobility: '担送', sensor: false, age: 90, department: '療養内科' },
  { patientId: 'P22502', name: '岩泉 慶子', kana: 'イワイズミ ケイコ', gender: '女性', ward: '2F医療病棟', room: '225-2', mobility: '担送', sensor: false, age: 87, department: '療養内科' },
  { patientId: 'P22503', name: '鈴木 千代子', kana: 'スズキ チヨコ', gender: '女性', ward: '2F医療病棟', room: '225-3', mobility: '担送', sensor: true, age: 85, department: '療養内科' },
  { patientId: 'P22504', name: '松野 ヒロ子', kana: 'マツノ ヒロコ', gender: '女性', ward: '2F医療病棟', room: '225-4', mobility: '担送', sensor: false, age: 91, department: '療養内科' },

  // 226 (4人部屋・女)
  { patientId: 'P22601', name: '大木 由岐', kana: 'オオキ ユキ', gender: '女性', ward: '2F医療病棟', room: '226-1', mobility: '護送', sensor: false, age: 82, department: '療養内科' },
  { patientId: 'P22602', name: '大橋 曄子', kana: 'オオハシ ヨウコ', gender: '女性', ward: '2F医療病棟', room: '226-2', mobility: '担送', sensor: false, age: 89, department: '療養内科' },
  { patientId: 'P22603', name: '高橋 洋子', kana: 'タカハシ ヨウコ', gender: '女性', ward: '2F医療病棟', room: '226-3', mobility: '護送', sensor: false, age: 84, department: '療養内科' },
  { patientId: 'P22604', name: '伊藤 紗智子', kana: 'イトウ サチコ', gender: '女性', ward: '2F医療病棟', room: '226-4', mobility: '担送', sensor: false, age: 77, department: '療養内科' },
];

async function seed2FPhotoPatients() {
  console.log(`🏥 [Seed2F] 2F病棟実機写真から ${PHOTO_PATIENTS_2F.length} 名の患者データを同期中...`);
  let created = 0;
  let updated = 0;

  for (const p of PHOTO_PATIENTS_2F) {
    const existing = await Patient.findOne({ patientId: p.patientId });
    if (!existing) {
      await Patient.create(p);
      created++;
    } else {
      existing.name = p.name;
      existing.kana = p.kana;
      existing.gender = p.gender;
      existing.ward = p.ward;
      existing.room = p.room;
      existing.mobility = p.mobility;
      existing.sensor = p.sensor;
      existing.age = p.age;
      await existing.save();
      updated++;
    }

    // TargetPerson にも同期
    await TargetPerson.findOneAndUpdate(
      { customId: p.patientId },
      {
        name: p.name,
        customId: p.patientId,
        gender: p.gender,
        age: p.age,
        department: `${p.ward} ${p.room} (${p.department || '療養内科'})`,
        status: 'active'
      },
      { upsert: true }
    );
  }

  console.log(`✅ [Seed2F] 完了: 新規登録 ${created} 名、更新 ${updated} 名 (総計: ${PHOTO_PATIENTS_2F.length} 名)`);
}

module.exports = {
  seed2FPhotoPatients,
  PHOTO_PATIENTS_2F
};

if (require.main === module) {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0';
  mongoose.connect(MONGO_URI)
    .then(async () => {
      await seed2FPhotoPatients();
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
