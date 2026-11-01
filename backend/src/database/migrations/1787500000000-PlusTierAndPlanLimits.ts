import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Reworks the tier ladder to Basic / Plus / Premium and adds per-plan
 * enforcement limits (concurrent devices, max playback quality, priority
 * support). PostgreSQL RENAME VALUE rewrites every existing row reference,
 * so 'standard' subscriptions/orders/plans become 'plus' in place.
 */
export class PlusTierAndPlanLimits1787500000000 implements MigrationInterface {
    name = 'PlusTierAndPlanLimits1787500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_tier_enum" RENAME VALUE 'standard' TO 'plus'`);
        await queryRunner.query(`ALTER TYPE "public"."subscription_plans_tier_enum" RENAME VALUE 'standard' TO 'plus'`);
        await queryRunner.query(`ALTER TYPE "public"."payment_transactions_tier_enum" RENAME VALUE 'standard' TO 'plus'`);

        await queryRunner.query(`ALTER TABLE "subscription_plans" ADD "max_devices" integer NOT NULL DEFAULT 1`);
        await queryRunner.query(`CREATE TYPE "public"."subscription_plans_max_quality_enum" AS ENUM('480p', '720p', '1080p')`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" ADD "max_quality" "public"."subscription_plans_max_quality_enum" NOT NULL DEFAULT '720p'`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" ADD "priority_support" boolean NOT NULL DEFAULT false`);

        await queryRunner.query(`UPDATE "subscription_plans" SET "max_devices" = 2, "max_quality" = '1080p' WHERE "tier" = 'plus'`);
        await queryRunner.query(`UPDATE "subscription_plans" SET "max_devices" = 4, "max_quality" = '1080p', "priority_support" = true WHERE "tier" = 'premium'`);

        await queryRunner.query(`CREATE TABLE "device_sessions" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "device_id" character varying NOT NULL, "name" character varying, "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_device_session_user_device" UNIQUE ("user_id", "device_id"), CONSTRAINT "PK_device_sessions" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_device_sessions_user_last_seen" ON "device_sessions" ("user_id", "last_seen_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_device_sessions_user_last_seen"`);
        await queryRunner.query(`DROP TABLE "device_sessions"`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" DROP COLUMN "priority_support"`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" DROP COLUMN "max_quality"`);
        await queryRunner.query(`DROP TYPE "public"."subscription_plans_max_quality_enum"`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" DROP COLUMN "max_devices"`);
        await queryRunner.query(`ALTER TYPE "public"."payment_transactions_tier_enum" RENAME VALUE 'plus' TO 'standard'`);
        await queryRunner.query(`ALTER TYPE "public"."subscription_plans_tier_enum" RENAME VALUE 'plus' TO 'standard'`);
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_tier_enum" RENAME VALUE 'plus' TO 'standard'`);
    }

}
