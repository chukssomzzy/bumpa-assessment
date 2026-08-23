import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1787486411006 implements MigrationInterface {
  name = 'InitialSchema1787486411006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "bank_code" character varying,
        "account_number" character varying,
        "recipient_code" character varying,
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )`);

    await queryRunner.query(`
      CREATE TABLE "user_progress" (
        "user_id" uuid PRIMARY KEY,
        "purchase_count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "FK_user_progress_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )`);

    await queryRunner.query(`
      CREATE TABLE "achievements" (
        "key" character varying PRIMARY KEY,
        "name" character varying NOT NULL,
        "group_key" character varying NOT NULL,
        "metric" character varying NOT NULL,
        "threshold" integer NOT NULL,
        "tier" integer NOT NULL
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_achievements_group_tier" ON "achievements" ("group_key", "tier")`,
    );

    await queryRunner.query(`
      CREATE TABLE "badges" (
        "key" character varying PRIMARY KEY,
        "name" character varying NOT NULL,
        "required_achievement_count" integer NOT NULL,
        CONSTRAINT "UQ_badges_required_count" UNIQUE ("required_achievement_count")
      )`);

    await queryRunner.query(`
      CREATE TABLE "user_achievements" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "achievement_key" character varying NOT NULL,
        "unlocked_at" TIMESTAMP NOT NULL DEFAULT now()
      )`);
    // The backstop against a concurrent double-unlock.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_achievements" ON "user_achievements" ("user_id", "achievement_key")`,
    );

    await queryRunner.query(`
      CREATE TABLE "user_badges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "badge_key" character varying NOT NULL,
        "earned_at" TIMESTAMP NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_badges" ON "user_badges" ("user_id", "badge_key")`,
    );

    await queryRunner.query(`
      CREATE TABLE "payouts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "badge_key" character varying NOT NULL,
        "amount_kobo" integer NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "provider_reference" character varying NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_payouts_provider_reference" UNIQUE ("provider_reference")
      )`);
    // One badge, one payout. This is the constraint that makes a double transfer impossible.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_payouts_user_badge" ON "payouts" ("user_id", "badge_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payouts_status_created" ON "payouts" ("status", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "processed_events" (
        "event_id" character varying PRIMARY KEY,
        "processed_at" TIMESTAMP NOT NULL DEFAULT now()
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_events"`);
    await queryRunner.query(`DROP TABLE "payouts"`);
    await queryRunner.query(`DROP TABLE "user_badges"`);
    await queryRunner.query(`DROP TABLE "user_achievements"`);
    await queryRunner.query(`DROP TABLE "badges"`);
    await queryRunner.query(`DROP TABLE "achievements"`);
    await queryRunner.query(`DROP TABLE "user_progress"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
