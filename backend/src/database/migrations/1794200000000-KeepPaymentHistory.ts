import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deleting a user keeps the payment history: transactions lose the link to the
 * account (`user_id` becomes NULL) and keep the former numeric ID as a pseudonym.
 */
export class KeepPaymentHistory1794200000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payment_transactions ALTER COLUMN user_id DROP NOT NULL,
      ADD COLUMN former_user_id integer`);
  }

  /** Fails (by design) while orphaned transactions exist, rather than deleting financial records. */
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payment_transactions DROP COLUMN former_user_id, ALTER COLUMN user_id SET NOT NULL`);
  }
}
