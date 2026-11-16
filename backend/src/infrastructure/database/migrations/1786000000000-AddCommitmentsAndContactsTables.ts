import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommitmentsAndContactsTables1786000000000 implements MigrationInterface {
  name = 'AddCommitmentsAndContactsTables1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contacts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contacts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contacts_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_contacts_user_id_name" ON "contacts" ("user_id", "name")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "commitments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL,
        "direction" character varying(10) NOT NULL,
        "origin_type" character varying(25) NOT NULL,
        "description" character varying(255) NOT NULL,
        "notes" text,
        "total_amount" numeric(18,4) NOT NULL,
        "category_account_id" uuid,
        "cash_account_id" uuid,
        "control_account_id" uuid NOT NULL,
        "initial_transaction_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_commitments_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_commitments_total_amount_pos" CHECK ("total_amount" > 0),
        CONSTRAINT "FK_commitments_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_commitments_contact_id" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_commitments_category_account_id" FOREIGN KEY ("category_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_commitments_cash_account_id" FOREIGN KEY ("cash_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_commitments_control_account_id" FOREIGN KEY ("control_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_commitments_initial_transaction_id" FOREIGN KEY ("initial_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_commitments_user_id" ON "commitments" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "commitment_installments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "commitment_id" uuid NOT NULL,
        "installment_number" integer NOT NULL,
        "due_date" date,
        "amount" numeric(18,4) NOT NULL,
        CONSTRAINT "PK_commitment_installments_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_commitment_installments_amount_pos" CHECK ("amount" > 0),
        CONSTRAINT "FK_commitment_installments_commitment_id" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_commitment_installments_commitment_id" ON "commitment_installments" ("commitment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_commitment_installments_due_date" ON "commitment_installments" ("due_date")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "commitment_settlements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "installment_id" uuid NOT NULL,
        "transaction_id" uuid NOT NULL,
        "journal_entry_id" uuid NOT NULL,
        "settlement_type" character varying(15) NOT NULL,
        "amount" numeric(18,4) NOT NULL,
        "settled_at" date NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_commitment_settlements_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_commitment_settlements_amount_pos" CHECK ("amount" > 0),
        CONSTRAINT "FK_commitment_settlements_installment_id" FOREIGN KEY ("installment_id") REFERENCES "commitment_installments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_commitment_settlements_transaction_id" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_commitment_settlements_journal_entry_id" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_commitment_settlements_installment_id" ON "commitment_settlements" ("installment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_commitment_settlements_transaction_id" ON "commitment_settlements" ("transaction_id")`,
    );

    // Provisionar cuentas técnicas de control para usuarios existentes
    const users: Array<{ id: string }> = await queryRunner.query(`SELECT "id" FROM "users"`);
    const defaultCurrency: Array<{ id: string }> = await queryRunner.query(
      `SELECT "id" FROM "currencies" WHERE "is_base" = true LIMIT 1`,
    );
    const currencyId = defaultCurrency[0]?.id;

    if (currencyId) {
      const rolesToProvision: Array<{
        role: string;
        name: string;
        type: string;
      }> = [
        { role: 'ACCOUNTS_RECEIVABLE', name: 'Cuentas por Cobrar', type: 'ASSET' },
        { role: 'ACCOUNTS_PAYABLE', name: 'Cuentas por Pagar', type: 'LIABILITY' },
        { role: 'BANK_INTEREST_EXPENSE', name: 'Intereses y Cargos Financieros', type: 'EXPENSE' },
      ];

      for (const user of users) {
        for (const item of rolesToProvision) {
          const existingByRole: Array<{ id: string }> = await queryRunner.query(
            `SELECT "id" FROM "accounts" WHERE "user_id" = $1 AND "system_role" = $2`,
            [user.id, item.role],
          );
          if (existingByRole.length === 0) {
            const existingByName: Array<{ id: string }> = await queryRunner.query(
              `SELECT "id" FROM "accounts" WHERE "user_id" = $1 AND LOWER("name") = LOWER($2) LIMIT 1`,
              [user.id, item.name],
            );
            if (existingByName.length > 0) {
              await queryRunner.query(`UPDATE "accounts" SET "system_role" = $1 WHERE "id" = $2`, [
                item.role,
                existingByName[0].id,
              ]);
            } else {
              await queryRunner.query(
                `INSERT INTO "accounts" ("id", "user_id", "name", "type", "currency_id", "status", "system_role", "is_cash_or_bank")
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', $5, false)`,
                [user.id, item.name, item.type, currencyId, item.role],
              );
            }
          }
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_commitment_settlements_transaction_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_commitment_settlements_installment_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "commitment_settlements"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_commitment_installments_due_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_commitment_installments_commitment_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "commitment_installments"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_commitments_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "commitments"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_contacts_user_id_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contacts"`);

    await queryRunner.query(
      `UPDATE "accounts" SET "system_role" = NULL WHERE "system_role" IN ('ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'BANK_INTEREST_EXPENSE')`,
    );
  }
}
