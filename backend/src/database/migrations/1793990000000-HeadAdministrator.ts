import { MigrationInterface, QueryRunner } from 'typeorm';

export class HeadAdministrator1793990000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query("ALTER TYPE users_role_enum ADD VALUE IF NOT EXISTS 'head_admin'");
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE users ALTER COLUMN role DROP DEFAULT');
    await q.query('ALTER TYPE users_role_enum RENAME TO users_role_enum_old');
    await q.query("CREATE TYPE users_role_enum AS ENUM ('viewer', 'admin')");
    await q.query("ALTER TABLE users ALTER COLUMN role TYPE users_role_enum USING (CASE WHEN role::text = 'head_admin' THEN 'admin' ELSE role::text END)::users_role_enum");
    await q.query("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'viewer'");
    await q.query('DROP TYPE users_role_enum_old');
  }
}
