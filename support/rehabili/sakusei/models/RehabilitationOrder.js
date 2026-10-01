const mongoose = require('mongoose');

const RehabilitationOrderSchema = new mongoose.Schema({
  // 管理番号
  orderNumber: { type: String, unique: true, index: true },

  // 患者情報
  patientId: { type: String, required: true, index: true },
  patientName: { type: String, required: true },
  patientGender: { type: String },
  patientAge: { type: Number },
  patientBirthDate: { type: String },
  ward: { type: String },
  roomNo: { type: String },

  // 区分 (入院 / 外来)
  patientType: { type: String, enum: ['inpatient', 'outpatient'], default: 'inpatient' },

  // 日付
  orderDate: { type: String, required: true }, // 指示日 (YYYY-MM-DD)
  admissionDate: { type: String }, // 入院日 / 外来日
  onsetDate: { type: String }, // 発症日 / 起算日

  // 医師
  doctorName: { type: String, required: true }, // 主治医
  doctorSignature: { type: String }, // 署名/印

  // 診断名 / 算定病名
  diagnosisName: { type: String, required: true },

  // 急変リスク
  riskCirculatory: { type: Boolean, default: false }, // 循環器系異常（血圧低下/上昇、頻脈/不整脈）
  riskRespiratory: { type: Boolean, default: false }, // 呼吸不全（SpO₂低値）
  oxygenFlow: { type: String, default: '' }, // 酸素 (ℓ/分)
  riskMedicine: { type: Boolean, default: false }, // 薬剤の影響（降圧薬・利尿薬・糖尿病薬）
  riskJoint: { type: Boolean, default: false }, // 人工関節
  jointSide: { type: String, default: '' }, // 右 / 左 / 両側
  jointPart: { type: String, default: '' }, // 股 / 膝 / 他
  jointOtherText: { type: String, default: '' }, // 部位詳細
  riskDementia: { type: Boolean, default: false }, // 認知症による指示理解の低下
  contraindications: { type: String, default: '' }, // 禁忌事項

  // 指示（医療のみ）
  necessityReason: { type: String, default: '' }, // ①症状・機能低下の具体的記述 (離床が困難な理由)
  improvementExpected: { type: Boolean, default: true }, // ②医学的改善が見込まれるためリハビリを指示する
  frequencyPerWeek: { type: String, default: '' }, // ③頻度: 週( )回
  durationMonths: { type: String, default: '' }, // ( )ヶ月間
  location: { type: String, enum: ['ward', 'rehab_room', 'both'], default: 'ward' }, // 場所: 病棟内 / 病棟外リハ室
  admissionCategory: { type: String, default: '' }, // ※入院患者: 入院料区分 【 】

  // 目的・内容
  // 1. 理学療法（医療療養病棟・外来リハ）
  pt_rom: { type: Boolean, default: false }, // 関節可動域訓練（ROM）
  pt_strength: { type: Boolean, default: false }, // 筋力体力増強
  pt_neuro: { type: Boolean, default: false }, // 神経筋促通
  pt_balance: { type: Boolean, default: false }, // 平衡機能の改善バランス
  pt_coordination: { type: Boolean, default: false }, // 協調運動（coordination）
  pt_basicMotion: { type: Boolean, default: false }, // 基本動作（寝返り-起き上がり-立ち上がり）
  pt_transfer: { type: Boolean, default: false }, // 移乗動作（transfer）
  pt_gait: { type: Boolean, default: false }, // 歩行能力向上（独歩-T字杖/補装具等）
  pt_adl: { type: Boolean, default: false }, // ADL改善
  pt_adlDetail: { type: String, default: '' }, // ADL動作詳細
  pt_wheelchair: { type: Boolean, default: false }, // 車いす操作練習
  pt_cognition: { type: Boolean, default: false }, // 高次脳機能「認知」「注意」「記憶」「遂行機能」「社会的行動」（OT中心）

  // 2. 作業療法（介護医療院・通所リハ）
  ot_rom: { type: Boolean, default: false }, // 関節可動域訓練（ROM）
  ot_strength: { type: Boolean, default: false }, // 筋力維持訓練
  ot_gait: { type: Boolean, default: false }, // 歩行訓練
  ot_posture: { type: Boolean, default: false }, // 座位/立位保持訓練（体幹の安定性向上と耐久性の確保[食事・ADLの基盤]）
  ot_meal: { type: Boolean, default: false }, // 食事動作訓練
  ot_dressing: { type: Boolean, default: false }, // 更衣-整容-入浴動作
  ot_toilet: { type: Boolean, default: false }, // トイレ排泄動作指導
  ot_attention: { type: Boolean, default: false }, // 注意・記憶の訓練
  ot_executive: { type: Boolean, default: false }, // 遂行機能の訓練
  ot_recreation: { type: Boolean, default: false }, // レクリエーション活動(手工芸・音楽）
  ot_environment: { type: Boolean, default: false }, // 生活環境調整・福祉用具の選定（PT・OT共通）

  // 3. 言語聴覚療法（【STと連携】）
  st_vf: { type: Boolean, default: false }, // 嚥下造影検査（VF検査）
  st_swallowMeal: { type: Boolean, default: false }, // 嚥下・食事場面の支援
  st_swallowPosture: { type: Boolean, default: false }, // 食事姿勢の調整
  st_swallowForm: { type: Boolean, default: false }, // 食形態の評価
  st_swallowInstruction: { type: Boolean, default: false }, // 食事介助方法の助言指導
  st_swallowRisk: { type: Boolean, default: false }, // 誤嚥リスクの観察
  st_articulation: { type: Boolean, default: false }, // 構音障害改善（発声・口腔運動・音の練習・話し方の調整）
  st_aphasia: { type: Boolean, default: false }, // 失語症改善（理解・表出・読み書き・語彙訓練・生活場面での会話支援）
  st_suction: { type: Boolean, default: false }, // サクション

  // 4. 評価
  eval_dementia: { type: Boolean, default: false }, // 認知症評価（HDS-R・MMSE）
  eval_walk: { type: Boolean, default: false }, // ６分間歩行テスト（6MD）
  eval_physical: { type: Boolean, default: false }, // 筋力・関節可動域・ADL評価測定（身体障がい者手帳 等）
  eval_bodyComp: { type: Boolean, default: false }, // 体組成評価

  // 5. 消炎鎮痛
  sed_massage: { type: Boolean, default: false }, // １．マッサージ
  sed_hotpack: { type: Boolean, default: false }, // ２．ホットパック
  sed_ssp: { type: Boolean, default: false }, // ３．SSP マイクロ波
  sed_medmer: { type: Boolean, default: false }, // ４．メドマー (エアマッサージ器)
  sed_traction: { type: Boolean, default: false }, // ５．牽引
  sed_cervicalWeight: { type: String, default: '' }, // 頸椎（ ㎏）
  sed_lumbarWeight: { type: String, default: '' }, // 腰椎（ ㎏）
  sed_partSide: { type: String, default: '' }, // 右・左・両側
  sed_partRegion: { type: String, default: '' }, // 頸・肩・腰・足
  sed_partOther: { type: String, default: '' }, // 他（ ）

  // リハビリ受付確認
  rehabAcceptDate: { type: String, default: '' }, // 受付月日
  rehabStaffName: { type: String, default: '' }, // サイン
  status: {
    type: String,
    enum: ['ordered', 'received', 'in_progress', 'completed', 'cancelled'],
    default: 'ordered',
    index: true
  },

  // 電子カルテ連携
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article' },

  // 作成メタ
  createdUser: {
    userId: String,
    userName: String,
    department: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('RehabilitationOrder', RehabilitationOrderSchema);
