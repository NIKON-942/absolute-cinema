import { MigrationInterface, QueryRunner } from 'typeorm';
export class GoogleOAuthFlows1793780000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE UNIQUE INDEX uq_users_google_id ON users (google_id) WHERE google_id IS NOT NULL');
    await q.query(`CREATE TABLE google_oauth_flows (
      state_hash varchar(64) PRIMARY KEY, browser_hash varchar(64) NOT NULL,
      return_to text NOT NULL, user_id integer REFERENCES users(id) ON DELETE CASCADE,
      token_version integer, state_used boolean NOT NULL DEFAULT false,
      expires_at timestamptz NOT NULL, code_hash varchar(64) UNIQUE, access_token text
    )`);
    await q.query('CREATE INDEX idx_google_oauth_expiry ON google_oauth_flows (expires_at)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE google_oauth_flows');
    await q.query('DROP INDEX uq_users_google_id');
  }
}
