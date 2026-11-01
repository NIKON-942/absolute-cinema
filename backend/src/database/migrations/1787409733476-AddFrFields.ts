import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFrFields1787409733476 implements MigrationInterface {
    name = 'AddFrFields1787409733476'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "directors" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, CONSTRAINT "UQ_405bf12dff92cd37ebbf78bc628" UNIQUE ("name"), CONSTRAINT "PK_a9ae28f00c93801aa034a2c1773" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "countries" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, CONSTRAINT "UQ_fa1376321185575cf2226b1491d" UNIQUE ("name"), CONSTRAINT "PK_b2d7006793e8697ab3ae2deff18" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "movies" ADD "runtime_minutes" integer`);
        await queryRunner.query(`ALTER TABLE "movies" ADD "trailer_url" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "token_version" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "avatar_url" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "last_login_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_login_at"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_url"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "token_version"`);
        await queryRunner.query(`ALTER TABLE "movies" DROP COLUMN "trailer_url"`);
        await queryRunner.query(`ALTER TABLE "movies" DROP COLUMN "runtime_minutes"`);
        await queryRunner.query(`DROP TABLE "countries"`);
        await queryRunner.query(`DROP TABLE "directors"`);
    }

}
