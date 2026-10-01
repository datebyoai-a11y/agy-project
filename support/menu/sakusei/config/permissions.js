/**
 * 🏥 病院統合ポータル 職種ーメニュー対応表（雛形マトリクス）& 権限定義
 */

// 1. メニューマスタ定義
const MENUS = [
  {
    id: 'emr',
    title: '電子カルテ・記事作成',
    shortName: '電子カルテ',
    subtitle: '対象患者を選択して診察記事入力・バイタル記録・処方・指示オーダー (SSO自動ログイン)',
    url: '/sso/launch?app=articles',
    port: 3000,
    icon: '🩺',
    category: '臨床・診療',
    badgeColor: 'blue'
  },
  {
    id: 'patient_management',
    title: '患者情報登録・管理',
    shortName: '患者情報管理',
    subtitle: '患者基本情報・連絡先・キーパーソン・身体情報・アレルギー登録',
    url: '/patients',
    icon: '🏥',
    category: '臨床・診療',
    badgeColor: 'cyan'
  },
  {
    id: 'bed_board',
    title: '病棟フロアマップ・ベッドボード',
    shortName: '病棟フロアマップ',
    subtitle: 'アイホン連動2F病棟フロアマップ・患者ベッド配置・看護統計・空床リアルタイム管理',
    url: '/bed-board',
    icon: '🗺️',
    category: '臨床・診療',
    badgeColor: 'teal'
  },
  {
    id: 'order_sender',
    title: 'オーダリング総合ポータル【指示発行】',
    shortName: '統合オーダリング',
    subtitle: '放射線・注射点滴・リハビリテーション指示書の一括発行・カルテ連動 (統合画面)',
    url: '/ordering/',
    icon: '📝',
    category: '臨床・診療',
    badgeColor: 'indigo'
  },
  {
    id: 'radiology_order',
    title: '放射線科オーダー【発行・帳票印刷】',
    shortName: '放射線オーダー',
    subtitle: 'CT・透視・照射録オーダー入力、正・控え2枚組帳票印刷、カルテ記録連動 (SSO自動ログイン)',
    url: '/sso/launch?app=radiology',
    port: 8080,
    icon: '🩻',
    category: '臨床・診療',
    badgeColor: 'purple'
  },
  {
    id: 'radiology_receiver',
    title: '放射線科【指示受け・実施モニター】',
    shortName: '放射線指示受け',
    subtitle: 'モダリティ別(一般X線・CT・透視) 縦3列Kanban、受付・実施済ワンクリック管理 (リアルタイム同期)',
    url: '/sso/launch?app=radi_uke',
    port: 8081,
    icon: '📋',
    category: '部門・実施',
    badgeColor: 'blue'
  },
  {
    id: 'injection_order',
    title: '注射・点滴オーダー【指示・ラベル印刷】',
    shortName: '注射オーダー',
    subtitle: '輸液・混注薬剤オーダー発行、注射指示票・ボトルラベル印刷、カルテ連動 (SSO自動ログイン)',
    url: '/sso/launch?app=injection',
    port: 8082,
    icon: '💉',
    category: '臨床・診療',
    badgeColor: 'emerald'
  },
  {
    id: 'naifuku_order',
    title: '内服・外用処方オーダー【処方箋・調剤指示】',
    shortName: '内服・外用処方',
    subtitle: 'Rp別複数薬品・服用タイミング・一包化/粉砕指示・DO処方・院内処方箋印刷・カルテ連動 (SSO自動ログイン)',
    url: '/sso/launch?app=naifuku',
    port: 8084,
    icon: '💊',
    category: '臨床・診療',
    badgeColor: 'blue'
  },
  {
    id: 'rehabili_order',
    title: 'リハビリテーション指示オーダー【指示書Ver3.0】',
    shortName: 'リハビリ指示',
    subtitle: 'PT/OT/ST指示書Ver3.0発行、急変リスク・医学的必要性・頻度・消炎鎮痛、A4原本印刷・カルテ連動 (SSO自動ログイン)',
    url: '/sso/launch?app=rehabili',
    port: 8083,
    icon: '🤸',
    category: '臨床・診療',
    badgeColor: 'teal'
  },
  /*
  {
    id: 'order_receiver',
    title: 'オーダリング【部門モニター】',
    shortName: '部門モニター',
    subtitle: '各部門での受付・鑑査・検査実施・調剤・配膳ステータス管理 (リバースプロキシ連携)',
    url: '/monitor/',
    port: 5000,
    icon: '📥',
    category: '部門・実施',
    badgeColor: 'teal'
  },
  */
  {
    id: 'incident_report',
    title: 'インシデント・ヒヤリハット報告',
    shortName: 'インシデント報告',
    subtitle: '医療安全インシデント・ヒヤリハットの速やかな報告書提出 (SSO自動ログイン)',
    url: '/sso/launch?app=incident_report',
    port: 3000,
    icon: '⚠️',
    category: '医療安全',
    badgeColor: 'amber'
  },
  {
    id: 'safety_analytics',
    title: '医療安全・集計分析レポート',
    shortName: '安全分析レポート',
    subtitle: 'インシデント発生傾向グラフ・リスク分析・対策実施状況 (SSO自動ログイン)',
    url: '/sso/launch?app=safety_analytics',
    port: 3000,
    icon: '📊',
    category: '医療安全',
    badgeColor: 'purple'
  },
  {
    id: 'user_management',
    title: '職員一覧',
    shortName: '職員一覧',
    subtitle: '登録済み職員アカウント一覧の参照・新規登録（職種ー権限管理）',
    url: '/admin/users',
    icon: '👥',
    category: 'システム管理',
    badgeColor: 'rose'
  },
  {
    id: 'system_status',
    title: 'システム稼働 & 外部接続監視',
    shortName: 'システム監視',
    subtitle: 'カルテ(3000)・オーダリング(4000/5000)・DB・Cloudflareトンネル',
    url: '/admin/status',
    icon: '🌐',
    category: 'システム管理',
    badgeColor: 'emerald'
  },
  {
    id: 'novnc',
    title: 'リモートデスクトップ (noVNC)',
    shortName: 'リモート画面',
    subtitle: 'ブラウザだけでホスト画面を直接操作 (SSHトンネル経由・Port 6080)',
    url: 'http://localhost:6080/',
    port: 6080,
    icon: '🖥️',
    category: 'システム管理',
    badgeColor: 'cyan'
  }
];

// 2. 🌟 職種ーメニュー対応表（ユーザー作成時の標準雛形マトリクス）
const DEFAULT_ROLE_TEMPLATES = {
  '医師': {
    roleKey: '医師',
    name: '医師 (Doctor)',
    defaultRole: 'user',
    description: '診察記事・病名登録・全オーダー発行・患者情報管理・病床把握',
    menus: ['emr', 'patient_management', 'bed_board', 'order_sender', 'naifuku_order', 'injection_order', 'radiology_order', 'rehabili_order', 'radiology_receiver', 'order_receiver', 'incident_report', 'user_management'],
    labels: {
      'emr': '全権限（診察記事・病名・指示）',
      'patient_management': '患者情報登録・編集・参照',
      'bed_board': '病床稼働マップ・病室割当',
      'order_sender': '全オーダー発行・処方・指示承認',
      'naifuku_order': '内服・外用処方オーダー発行・処方箋印刷',
      'injection_order': '注射・点滴オーダー発行・指示箋印刷',
      'radiology_order': '放射線オーダー発行・正控え印刷',
      'rehabili_order': 'リハビリテーション指示書Ver3.0発行・原本印刷',
      'radiology_receiver': '放射線指示受け・実施状況モニター',
      'order_receiver': 'オーダー実施進捗確認',
      'incident_report': '全職員報告権限',
      'user_management': '職員一覧の閲覧'
    }
  },
  '看護師': {
    roleKey: '看護師',
    name: '看護師 (Nurse)',
    defaultRole: 'user',
    description: '看護記録・バイタル入力・病棟オーダー・患者情報・病床管理',
    menus: ['emr', 'patient_management', 'bed_board', 'order_sender', 'naifuku_order', 'injection_order', 'radiology_order', 'rehabili_order', 'radiology_receiver', 'order_receiver', 'incident_report', 'user_management'],
    labels: {
      'emr': '看護記録・バイタル入力・閲覧',
      'patient_management': '患者情報更新・バイタル登録',
      'bed_board': '病棟ベッド移動・空床割当',
      'order_sender': '病棟指示・食事変更・点滴連携',
      'naifuku_order': '内服・外用処方指示確認・配薬チェック',
      'injection_order': '注射点滴指示確認・ラベル印刷・実施',
      'radiology_order': '放射線オーダー参照・印刷',
      'rehabili_order': 'リハビリ指示参照・原本印刷',
      'radiology_receiver': '放射線検査進捗・実施確認',
      'order_receiver': '病棟受取・点滴実施確認',
      'incident_report': '全職員報告権限',
      'user_management': '職員一覧の閲覧'
    }
  },
  '放射線技師': {
    roleKey: '放射線技師',
    name: '放射線技師 (Radiology Tech)',
    defaultRole: 'user',
    description: '放射線科検査モニター・撮影実施・カルテ閲覧・患者参照',
    menus: ['emr', 'patient_management', 'radiology_order', 'radiology_receiver', 'order_receiver', 'incident_report', 'user_management'],
    labels: {
      'emr': '患者情報・カルテ閲覧のみ',
      'patient_management': '患者基本情報・検査歴参照',
      'radiology_order': '放射線オーダー照会・正控え再印刷',
      'radiology_receiver': '【主業務】指示受け・受付・実施済ワンクリック管理',
      'order_receiver': '他部門連携モニター',
      'incident_report': '全職員報告権限',
      'user_management': '職員一覧の閲覧'
    }
  },
  'リハビリ': {
    roleKey: 'リハビリ',
    name: 'リハビリ職 (Rehabilitation)',
    defaultRole: 'user',
    description: 'リハビリ指示受取・実施記録・カルテ閲覧・患者参照',
    menus: ['emr', 'patient_management', 'rehabili_order', 'order_receiver', 'incident_report', 'user_management'],
    labels: {
      'emr': '患者情報・カルテ閲覧のみ',
      'patient_management': '患者基本情報・ADL参照',
      'rehabili_order': 'リハビリ指示書Ver3.0受取・指示確認・原本印刷',
      'order_receiver': 'リハビリ指示受取・実施モニター',
      'incident_report': '全職員報告権限',
      'user_management': '職員一覧の閲覧'
    }
  },
  '薬剤師': {
    roleKey: '薬剤師',
    name: '薬剤師 (Pharmacist)',
    defaultRole: 'user',
    description: '処方調剤・注射薬鑑査モニター・患者アレルギー参照',
    menus: ['patient_management', 'naifuku_order', 'injection_order', 'order_receiver', 'incident_report', 'user_management'],
    labels: {
      'patient_management': '患者基本情報・アレルギー参照',
      'naifuku_order': '処方鑑査・調剤指示確認・処方箋印刷',
      'injection_order': '注射薬鑑査・ミキシング調剤確認',
      'order_receiver': '処方調剤・注射薬鑑査モニター',
      'incident_report': '全職員報告権限',
      'user_management': '職員一覧の閲覧'
    }
  },
  '管理栄養士': {
    roleKey: '管理栄養士',
    name: '管理栄養士 (Dietitian)',
    defaultRole: 'user',
    description: '食事オーダー確認・配膳管理モニター・患者食種参照',
    menus: ['patient_management', 'order_receiver', 'incident_report', 'user_management'],
    labels: {
      'patient_management': '患者基本情報・食種参照',
      'order_receiver': '食事オーダー・配膳管理モニター',
      'incident_report': '全職員報告権限',
      'user_management': '職員一覧の閲覧'
    }
  },
  '一般': {
    roleKey: '一般',
    name: '事務・医事課 (Clerk)',
    defaultRole: 'user',
    description: '患者基本情報登録・保険証確認・病床管理・インシデント報告',
    menus: ['emr', 'patient_management', 'bed_board', 'incident_report', 'user_management'],
    labels: {
      'emr': '患者情報参照のみ',
      'patient_management': '患者基本情報・保険証登録管理',
      'bed_board': '入院受付・病床割当',
      'incident_report': '全職員報告権限',
      'user_management': '職員一覧の閲覧'
    }
  },
  '医療安全管理室': {
    roleKey: '医療安全管理室',
    name: '医療安全管理室 / 管理者 (Admin)',
    defaultRole: 'admin',
    description: '全館システムフルアクセス・インシデント集計・職員マスタ管理',
    menus: ['emr', 'patient_management', 'bed_board', 'order_sender', 'naifuku_order', 'injection_order', 'radiology_order', 'radiology_receiver', 'order_receiver', 'incident_report', 'safety_analytics', 'user_management', 'system_status', 'novnc'],
    labels: {
      'emr': '管理者フルアクセス',
      'patient_management': '患者マスタ全権限',
      'bed_board': '全館病床ベッドボード管理',
      'order_sender': '管理者フルアクセス',
      'naifuku_order': '内服・外用処方オーダー全権限',
      'radiology_order': '放射線オーダー発行・帳票管理',
      'radiology_receiver': '放射線指示受け・実施モニター管理',
      'order_receiver': '全館オーダー総合モニター',
      'incident_report': '全職員報告権限',
      'safety_analytics': 'インシデント集計・分析',
      'user_management': '職員アカウント・権限管理',
      'system_status': 'インフラ稼働監視',
      'novnc': 'Webリモートデスクトップ'
    }
  }
};

// 3. 権限判定ロジック
function checkAccess(user, menu, activeTemplates = DEFAULT_ROLE_TEMPLATES) {
  if (!user) return false;
  // 管理者ロールは全メニューにアクセス可能
  if (user.role === 'admin') return true;

  // ユーザー個別のカスタム権限設定がある場合
  if (user.allowedMenus && Array.isArray(user.allowedMenus) && user.allowedMenus.length > 0) {
    return user.allowedMenus.includes(menu.id);
  }

  // 職種テンプレートに基づく判定
  const template = activeTemplates[user.department] || activeTemplates['一般'];
  if (template && template.menus) {
    return template.menus.includes(menu.id);
  }

  return menu.id === 'incident_report';
}

// 4. メニュー表示用ラベルの取得
function getPermissionLabel(user, menu, activeTemplates = DEFAULT_ROLE_TEMPLATES) {
  if (user.role === 'admin') {
    return '【フルアクセス】管理者権限';
  }
  const template = activeTemplates[user.department] || activeTemplates['一般'];
  if (template && template.labels && template.labels[menu.id]) {
    return template.labels[menu.id];
  }
  if (checkAccess(user, menu, activeTemplates)) {
    return '利用可能';
  }
  return '制限（権限なし）';
}

// 5. ユーザー向けメニュー一覧の生成
function getAuthorizedMenus(user, activeTemplates = DEFAULT_ROLE_TEMPLATES) {
  return MENUS.map(menu => {
    const canAccess = checkAccess(user, menu, activeTemplates);
    return {
      ...menu,
      canAccess,
      permissionLabel: getPermissionLabel(user, menu, activeTemplates)
    };
  });
}

module.exports = {
  MENUS,
  DEFAULT_ROLE_TEMPLATES,
  checkAccess,
  getPermissionLabel,
  getAuthorizedMenus
};
