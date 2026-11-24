import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoansTablesAndUnlockInterestAccount1786200000000 implements MigrationInterface {
  name = 'AddLoansTablesAndUnlockInterestAccount1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "loans" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "currency_id" uuid NOT NULL,
        "initial_principal" numeric(18,4) NOT NULL,
        "annual_rate" numeric(8,4) NOT NULL DEFAULT 0,
        "opening_date" date NOT NULL,
        "start_installment_number" integer NOT NULL DEFAULT 1,
        "total_installments_count" integer NOT NULL,
        "liability_account_id" uuid NOT NULL,
        "default_payment_account_id" uuid,
        "initial_transaction_id" uuid NOT NULL,
        "status" character varying(15) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loans_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_loans_initial_principal_nonneg" CHECK ("initial_principal" >= 0),
        CONSTRAINT "CHK_loans_annual_rate_nonneg" CHECK ("annual_rate" >= 0),
        CONSTRAINT "CHK_loans_start_inst_pos" CHECK ("start_installment_number" >= 1),
        CONSTRAINT "CHK_loans_total_inst_pos" CHECK ("total_installments_count" >= 1),
        CONSTRAINT "CHK_loans_status" CHECK ("status" IN ('ACTIVE', 'SETTLED', 'CANCELLED')),
        CONSTRAINT "FK_loans_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_loans_currency_id" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_loans_liability_account_id" FOREIGN KEY ("liability_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_loans_default_payment_account_id" FOREIGN KEY ("default_payment_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_loans_initial_transaction_id" FOREIGN KEY ("initial_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_loans_user_id" ON "loans" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_loans_user_status" ON "loans" ("user_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_loans_liability_account_id" ON "loans" ("liability_account_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "loan_charge_columns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "loan_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "expense_account_id" uuid NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loan_charge_columns_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_loan_charge_columns_loan_id" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_loan_charge_columns_expense_account_id" FOREIGN KEY ("expense_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_loan_charge_columns_loan_id" ON "loan_charge_columns" ("loan_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "loan_installments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "loan_id" uuid NOT NULL,
        "installment_number" integer NOT NULL,
        "due_date" date NOT NULL,
        "principal_amount" numeric(18,4) NOT NULL,
        "charges_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loan_installments_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_loan_installments_number_pos" CHECK ("installment_number" >= 1),
        CONSTRAINT "CHK_loan_installments_principal_pos" CHECK ("principal_amount" > 0),
        CONSTRAINT "FK_loan_installments_loan_id" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_loan_installments_loan_id" ON "loan_installments" ("loan_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_loan_installments_due_date" ON "loan_installments" ("due_date")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "loan_payment_allocations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "installment_id" uuid NOT NULL,
        "transaction_id" uuid NOT NULL,
        "principal_journal_entry_id" uuid,
        "allocated_principal" numeric(18,4) NOT NULL DEFAULT 0,
        "allocated_charges_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "paid_at" date NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loan_payment_allocations_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_loan_payment_allocations_principal_nonneg" CHECK ("allocated_principal" >= 0),
        CONSTRAINT "FK_loan_payment_allocations_installment_id" FOREIGN KEY ("installment_id") REFERENCES "loan_installments"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_loan_payment_allocations_transaction_id" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_loan_payment_allocations_principal_je_id" FOREIGN KEY ("principal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_loan_allocations_installment_id" ON "loan_payment_allocations" ("installment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_loan_allocations_transaction_id" ON "loan_payment_allocations" ("transaction_id")`,
    );

    // Spec 00 §4 & Spec 02 §5.2: Liberar la cuenta de Intereses y Cargos Financieros
    await queryRunner.query(
      `UPDATE "accounts" SET "system_role" = NULL WHERE "system_role" = 'BANK_INTEREST_EXPENSE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_loan_allocations_transaction_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_loan_allocations_installment_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "loan_payment_allocations"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_loan_installments_due_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_loan_installments_loan_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "loan_installments"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_loan_charge_columns_loan_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "loan_charge_columns"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_loans_liability_account_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_loans_user_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_loans_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "loans"`);

    await queryRunner.query(`
      UPDATE "accounts"
      SET "system_role" = 'BANK_INTEREST_EXPENSE'
      WHERE "type" = 'EXPENSE'
        AND "system_role" IS NULL
        AND LOWER("name") = 'intereses y cargos financieros'
    `);
  }
}
