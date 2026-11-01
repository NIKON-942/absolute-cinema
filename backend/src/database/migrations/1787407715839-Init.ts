import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1787407715839 implements MigrationInterface {
    name = 'Init1787407715839'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "actors" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "photo_url" character varying, CONSTRAINT "UQ_ec613da22320a4d2232afb288c7" UNIQUE ("name"), CONSTRAINT "PK_d8608598c2c4f907a78de2ae461" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "genres" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, CONSTRAINT "UQ_f105f8230a83b86a346427de94d" UNIQUE ("name"), CONSTRAINT "PK_80ecd718f0f00dde5d77a9be842" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "ratings" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "movie_id" integer NOT NULL, "value" smallint NOT NULL, CONSTRAINT "PK_0f31425b073219379545ad68ed9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_rating_user_movie" ON "ratings" ("user_id", "movie_id") `);
        await queryRunner.query(`CREATE TABLE "movies" ("id" SERIAL NOT NULL, "title" character varying NOT NULL, "original_title" character varying NOT NULL DEFAULT '', "description" text NOT NULL DEFAULT '', "year" integer NOT NULL, "country" character varying NOT NULL DEFAULT '', "age_rating" character varying NOT NULL DEFAULT '16+', "director" character varying NOT NULL DEFAULT '', "keywords" text array NOT NULL DEFAULT '{}', "poster_path" character varying, "video480" character varying, "video720" character varying, "video1080" character varying, "view_count" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c5b2c134e871bfd1c2fe7cc3705" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('viewer', 'admin')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL NOT NULL, "email" character varying NOT NULL, "name" character varying NOT NULL, "password_hash" character varying, "google_id" character varying, "role" "public"."users_role_enum" NOT NULL DEFAULT 'viewer', "is_blocked" boolean NOT NULL DEFAULT false, "reset_token_hash" character varying, "reset_token_expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_tier_enum" AS ENUM('basic', 'standard', 'premium')`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_period_enum" AS ENUM('monthly', 'yearly')`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('pending', 'active', 'expired', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "tier" "public"."subscriptions_tier_enum" NOT NULL, "period" "public"."subscriptions_period_enum" NOT NULL, "status" "public"."subscriptions_status_enum" NOT NULL DEFAULT 'pending', "starts_at" TIMESTAMP WITH TIME ZONE, "ends_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_subscription_user_status" ON "subscriptions" ("user_id", "status") `);
        await queryRunner.query(`CREATE TABLE "watch_progress" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "movie_id" integer NOT NULL, "position_seconds" double precision NOT NULL DEFAULT '0', "duration_seconds" double precision NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_801581ad1b82f180fb37ea79167" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_progress_user_movie" ON "watch_progress" ("user_id", "movie_id") `);
        await queryRunner.query(`CREATE TYPE "public"."subscription_plans_tier_enum" AS ENUM('basic', 'standard', 'premium')`);
        await queryRunner.query(`CREATE TABLE "subscription_plans" ("id" SERIAL NOT NULL, "tier" "public"."subscription_plans_tier_enum" NOT NULL, "monthly_price" numeric(10,2) NOT NULL, "yearly_price" numeric(10,2) NOT NULL, "currency" character varying NOT NULL DEFAULT 'usd', CONSTRAINT "UQ_fa0f49704b17b369c641981806e" UNIQUE ("tier"), CONSTRAINT "PK_9ab8fe6918451ab3d0a4fb6bb0c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."payment_transactions_tier_enum" AS ENUM('basic', 'standard', 'premium')`);
        await queryRunner.query(`CREATE TYPE "public"."payment_transactions_period_enum" AS ENUM('monthly', 'yearly')`);
        await queryRunner.query(`CREATE TYPE "public"."payment_transactions_status_enum" AS ENUM('pending', 'paid', 'failed', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "payment_transactions" ("id" SERIAL NOT NULL, "session_id" character varying NOT NULL, "user_id" integer NOT NULL, "subscription_id" integer, "tier" "public"."payment_transactions_tier_enum" NOT NULL, "period" "public"."payment_transactions_period_enum" NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying NOT NULL DEFAULT 'usd', "status" "public"."payment_transactions_status_enum" NOT NULL DEFAULT 'pending', "retries" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_f731affa53eacdd15ec444d02af" UNIQUE ("session_id"), CONSTRAINT "PK_d32b3c6b0d2c1d22604cbcc8c49" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_transaction_status_created" ON "payment_transactions" ("status", "created_at") `);
        await queryRunner.query(`CREATE TABLE "movie_genres" ("movies_id" integer NOT NULL, "genres_id" integer NOT NULL, CONSTRAINT "PK_b7855f83e2c3cdebcc3e91df901" PRIMARY KEY ("movies_id", "genres_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cdfcb68f945396d20ec3293225" ON "movie_genres" ("movies_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_8751c037fcf2b72782a998febb" ON "movie_genres" ("genres_id") `);
        await queryRunner.query(`CREATE TABLE "movie_actors" ("movies_id" integer NOT NULL, "actors_id" integer NOT NULL, CONSTRAINT "PK_14b3228dfa79d9b3204cb3d67cc" PRIMARY KEY ("movies_id", "actors_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3cfcce15fd179b53da30faeb45" ON "movie_actors" ("movies_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_4bf30149a12bf5057402b1fc6f" ON "movie_actors" ("actors_id") `);
        await queryRunner.query(`CREATE TABLE "user_favorites" ("users_id" integer NOT NULL, "movies_id" integer NOT NULL, CONSTRAINT "PK_c3e4f261df038ff6b7e94b3445d" PRIMARY KEY ("users_id", "movies_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3e297fd3088fc591c752f0362d" ON "user_favorites" ("users_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_9e311999ea78652fc565b297cf" ON "user_favorites" ("movies_id") `);
        await queryRunner.query(`ALTER TABLE "ratings" ADD CONSTRAINT "FK_f49ef8d0914a14decddbb170f2f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ratings" ADD CONSTRAINT "FK_45c7bafa4e537191add4eeed5b3" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_d0a95ef8a28188364c546eb65c1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "watch_progress" ADD CONSTRAINT "FK_4a10da827bd3f6cdc00a7cba930" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "watch_progress" ADD CONSTRAINT "FK_e6595ad2b98535a62d0e32ef809" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_transactions" ADD CONSTRAINT "FK_77fab0556decc83a81a5bf8c25d" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_transactions" ADD CONSTRAINT "FK_0baa911093b1629654e143b0923" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "movie_genres" ADD CONSTRAINT "FK_cdfcb68f945396d20ec32932254" FOREIGN KEY ("movies_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "movie_genres" ADD CONSTRAINT "FK_8751c037fcf2b72782a998febba" FOREIGN KEY ("genres_id") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "movie_actors" ADD CONSTRAINT "FK_3cfcce15fd179b53da30faeb45c" FOREIGN KEY ("movies_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "movie_actors" ADD CONSTRAINT "FK_4bf30149a12bf5057402b1fc6f1" FOREIGN KEY ("actors_id") REFERENCES "actors"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "user_favorites" ADD CONSTRAINT "FK_3e297fd3088fc591c752f0362d1" FOREIGN KEY ("users_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "user_favorites" ADD CONSTRAINT "FK_9e311999ea78652fc565b297cfb" FOREIGN KEY ("movies_id") REFERENCES "movies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_favorites" DROP CONSTRAINT "FK_9e311999ea78652fc565b297cfb"`);
        await queryRunner.query(`ALTER TABLE "user_favorites" DROP CONSTRAINT "FK_3e297fd3088fc591c752f0362d1"`);
        await queryRunner.query(`ALTER TABLE "movie_actors" DROP CONSTRAINT "FK_4bf30149a12bf5057402b1fc6f1"`);
        await queryRunner.query(`ALTER TABLE "movie_actors" DROP CONSTRAINT "FK_3cfcce15fd179b53da30faeb45c"`);
        await queryRunner.query(`ALTER TABLE "movie_genres" DROP CONSTRAINT "FK_8751c037fcf2b72782a998febba"`);
        await queryRunner.query(`ALTER TABLE "movie_genres" DROP CONSTRAINT "FK_cdfcb68f945396d20ec32932254"`);
        await queryRunner.query(`ALTER TABLE "payment_transactions" DROP CONSTRAINT "FK_0baa911093b1629654e143b0923"`);
        await queryRunner.query(`ALTER TABLE "payment_transactions" DROP CONSTRAINT "FK_77fab0556decc83a81a5bf8c25d"`);
        await queryRunner.query(`ALTER TABLE "watch_progress" DROP CONSTRAINT "FK_e6595ad2b98535a62d0e32ef809"`);
        await queryRunner.query(`ALTER TABLE "watch_progress" DROP CONSTRAINT "FK_4a10da827bd3f6cdc00a7cba930"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_d0a95ef8a28188364c546eb65c1"`);
        await queryRunner.query(`ALTER TABLE "ratings" DROP CONSTRAINT "FK_45c7bafa4e537191add4eeed5b3"`);
        await queryRunner.query(`ALTER TABLE "ratings" DROP CONSTRAINT "FK_f49ef8d0914a14decddbb170f2f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9e311999ea78652fc565b297cf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3e297fd3088fc591c752f0362d"`);
        await queryRunner.query(`DROP TABLE "user_favorites"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4bf30149a12bf5057402b1fc6f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3cfcce15fd179b53da30faeb45"`);
        await queryRunner.query(`DROP TABLE "movie_actors"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8751c037fcf2b72782a998febb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cdfcb68f945396d20ec3293225"`);
        await queryRunner.query(`DROP TABLE "movie_genres"`);
        await queryRunner.query(`DROP INDEX "public"."idx_transaction_status_created"`);
        await queryRunner.query(`DROP TABLE "payment_transactions"`);
        await queryRunner.query(`DROP TYPE "public"."payment_transactions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."payment_transactions_period_enum"`);
        await queryRunner.query(`DROP TYPE "public"."payment_transactions_tier_enum"`);
        await queryRunner.query(`DROP TABLE "subscription_plans"`);
        await queryRunner.query(`DROP TYPE "public"."subscription_plans_tier_enum"`);
        await queryRunner.query(`DROP INDEX "public"."uq_progress_user_movie"`);
        await queryRunner.query(`DROP TABLE "watch_progress"`);
        await queryRunner.query(`DROP INDEX "public"."idx_subscription_user_status"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_period_enum"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_tier_enum"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP TABLE "movies"`);
        await queryRunner.query(`DROP INDEX "public"."uq_rating_user_movie"`);
        await queryRunner.query(`DROP TABLE "ratings"`);
        await queryRunner.query(`DROP TABLE "genres"`);
        await queryRunner.query(`DROP TABLE "actors"`);
    }

}
