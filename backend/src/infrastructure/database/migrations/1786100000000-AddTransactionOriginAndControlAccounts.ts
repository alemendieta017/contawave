import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransactionOriginAndControlAccounts1786100000000 implements MigrationInterface {
  name = 'AddTransactionOriginAndControlAccounts1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transactions"
      ADD COLUMN IF NOT EXISTS "origin_module" character varying(30) NOT NULL DEFAULT 'MANUAL'
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions"
      ADD COLUMN IF NOT EXISTS "origin_entity_id" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_transactions_origin_module" ON "transactions" ("origin_module")
    `);

    // Backfill transactions owned by Commitments (initial transactions & settlements)
    await queryRunner.query(`
      UPDATE "transactions" t
      SET "origin_module" = 'COMMITMENT',
          "origin_entity_id" = c."id"
      FROM "commitments" c
      WHERE t."id" = c."initial_transaction_id"
    `);

    await queryRunner.query(`
      UPDATE "transactions" t
      SET "origin_module" = 'COMMITMENT',
          "origin_entity_id" = ci."commitment_id"
      FROM "commitment_settlements" cs
      INNER JOIN "commitment_installments" ci ON ci."id" = cs."installment_id"
      WHERE t."id" = cs."transaction_id"
    `);

    // Propagate origin metadata to any existing reversal transactions of commitment transactions
    await queryRunner.query(`
      UPDATE "transactions" rev
      SET "origin_module" = orig."origin_module",
          "origin_entity_id" = orig."origin_entity_id"
      FROM "transactions" orig
      WHERE rev."reversal_of_id" = orig."id"
        AND orig."origin_module" <> 'MANUAL'
    `);

    // Add control account flags to accounts
    await queryRunner.query(`
      ALTER TABLE "accounts"
      ADD COLUMN IF NOT EXISTS "is_control_account" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "accounts"
      ADD COLUMN IF NOT EXISTS "control_type" character varying(20)
    `);

    await queryRunner.query(`
      UPDATE "accounts"
      SET "is_control_account" = true,
          "control_type" = 'RECEIVABLE'
      WHERE "system_role" = 'ACCOUNTS_RECEIVABLE'
    `);

    await queryRunner.query(`
      UPDATE "accounts"
      SET "is_control_account" = true,
          "control_type" = 'PAYABLE'
      WHERE "system_role" = 'ACCOUNTS_PAYABLE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "control_type"`);
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "is_control_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transactions_origin_module"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN IF EXISTS "origin_entity_id"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN IF EXISTS "origin_module"`);
  }
}
