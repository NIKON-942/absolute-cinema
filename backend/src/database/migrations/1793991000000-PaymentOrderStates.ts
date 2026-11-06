import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentOrderStates1793991000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE payment_transactions ADD COLUMN cancellation_reason varchar, ADD COLUMN retry_of varchar UNIQUE');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE payment_transactions DROP COLUMN retry_of, DROP COLUMN cancellation_reason');
  }
}
