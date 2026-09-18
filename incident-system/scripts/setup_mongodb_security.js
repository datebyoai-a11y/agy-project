/**
 * MongoDB データベース設定スクリプト
 * 
 * 【目的】
 * 医療安全・真正性保持指針に基づき、カルテ記事（articles）および
 * インシデント報告（incidents）の削除（remove / delete）をデータベースレベルで物理的に禁止する
 * カスタムロール「medicalRecordNoDeleteRole」を作成・検証します。
 * 
 * 【実行方法】
 * mongosh incident_db scripts/setup_mongodb_security.js
 */

const DB_NAME = 'incident_db';
const ROLE_NAME = 'medicalRecordNoDeleteRole';

print(`=======================================================`);
print(`🔒 MongoDB 真正性保護・削除禁止ロール設定`);
print(`データベース: ${DB_NAME}`);
print(`ロール名: ${ROLE_NAME}`);
print(`=======================================================`);

// 既存ロールが存在する場合は一度削除して再作成
try {
  const existingRole = db.getRole(ROLE_NAME);
  if (existingRole) {
    print(`既存のロール [${ROLE_NAME}] を更新します...`);
    db.dropRole(ROLE_NAME);
  }
} catch (e) {}

// 削除アクション（remove / delete / drop）を除外し、find / insert / update のみ許可
const roleResult = db.createRole({
  role: ROLE_NAME,
  privileges: [
    // 1. カルテ診療記録 (articles) -> 削除アクション "remove" を完全に除外
    {
      resource: { db: DB_NAME, collection: "articles" },
      actions: ["find", "insert", "update"]
    },
    // 2. インシデント報告 (incidents) -> 削除アクション "remove" を完全に除外
    {
      resource: { db: DB_NAME, collection: "incidents" },
      actions: ["find", "insert", "update"]
    },
    // 3. ユーザー管理 (users)
    {
      resource: { db: DB_NAME, collection: "users" },
      actions: ["find", "insert", "update", "remove"]
    },
    // 4. 対象者マスタ (targetpeople)
    {
      resource: { db: DB_NAME, collection: "targetpeople" },
      actions: ["find", "insert", "update", "remove"]
    },
    // 5. 部署間連絡 (departmentmessages)
    {
      resource: { db: DB_NAME, collection: "departmentmessages" },
      actions: ["find", "insert", "update", "remove"]
    }
  ],
  roles: []
});

if (roleResult.ok === 1) {
  print(`✅ カスタムロール [${ROLE_NAME}] を正常に作成・登録しました。`);
  print(`\n【付与された権限の確認】:`);
  const createdRole = db.getRole(ROLE_NAME, { showPrivileges: true });
  createdRole.privileges.forEach(p => {
    print(` - コレクション: [${p.resource.collection || '全体'}] -> 許可アクション: [${p.actions.join(', ')}]`);
  });
  print(`\n※ articles および incidents に対する "remove"（削除）権限は存在しません。`);
} else {
  print(`❌ ロール作成に失敗しました:`, JSON.stringify(roleResult));
}
