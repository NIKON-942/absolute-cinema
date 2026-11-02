import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenAuthPaymentsAndJobs1793620000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD failed_login_attempts integer NOT NULL DEFAULT 0, ADD login_locked_until timestamptz`);
    await q.query(`ALTER TABLE subscriptions ADD stripe_subscription_id varchar UNIQUE, ADD cancel_at_period_end boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE payment_transactions ADD stripe_checkout_id varchar, ADD expires_at timestamptz`);
    await q.query(`UPDATE payment_transactions SET expires_at = created_at + interval '20 minutes' WHERE status = 'pending'`);
    await q.query(`ALTER TABLE movies ADD pending_master_video varchar`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE movies DROP COLUMN pending_master_video`);
    await q.query(`ALTER TABLE payment_transactions DROP COLUMN stripe_checkout_id, DROP COLUMN expires_at`);
    await q.query(`ALTER TABLE subscriptions DROP COLUMN stripe_subscription_id, DROP COLUMN cancel_at_period_end`);
    await q.query(`ALTER TABLE users DROP COLUMN failed_login_attempts, DROP COLUMN login_locked_until`);
  }
}
