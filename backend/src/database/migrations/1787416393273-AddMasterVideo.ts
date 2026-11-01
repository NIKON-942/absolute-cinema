import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMasterVideo1787416393273 implements MigrationInterface {
    name = 'AddMasterVideo1787416393273'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "movies" ADD "master_video" character varying`);
        await queryRunner.query(`CREATE TYPE "public"."movies_transcode_status_enum" AS ENUM('none', 'processing', 'ready', 'failed')`);
        await queryRunner.query(`ALTER TABLE "movies" ADD "transcode_status" "public"."movies_transcode_status_enum" NOT NULL DEFAULT 'none'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "movies" DROP COLUMN "transcode_status"`);
        await queryRunner.query(`DROP TYPE "public"."movies_transcode_status_enum"`);
        await queryRunner.query(`ALTER TABLE "movies" DROP COLUMN "master_video"`);
    }

}
