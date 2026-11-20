import { MigrationInterface, QueryRunner } from 'typeorm';

/** Refund of the unused part of a paid period when the user switches plans. */
export class PaymentRefunds1794100000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payment_transactions
      ADD COLUMN refunded_amount numeric(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN refund_status varchar,
      ADD COLUMN refunded_at timestamptz,
      ADD COLUMN stripe_refund_id varchar,
      ADD COLUMN refunded_by_session_id varchar`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payment_transactions
      DROP COLUMN refunded_by_session_id, DROP COLUMN stripe_refund_id,
      DROP COLUMN refunded_at, DROP COLUMN refund_status, DROP COLUMN refunded_amount`);
  }
}
