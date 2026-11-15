-- WDC-183: todo movimiento real viene del banco y se concilia con la cartola. Clasifica el origen y
-- el tipo de cada movimiento, guarda el corte conciliado de cada cuenta y elimina las fuentes de
-- ingreso manuales (el ingreso del plan pasa a ser la suma de los abonos de ingreso del período).
BEGIN;

-- 1. Columnas nuevas (origin queda NOT NULL después del backfill, sin default: cada alta lo declara).
ALTER TABLE "transaction"
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "creditKind" TEXT,
  ADD COLUMN "internalKind" TEXT,
  ADD COLUMN "reversalOfId" TEXT;
ALTER TABLE "financial_account" ADD COLUMN "reconciledUntil" TIMESTAMP(3);

-- 2. Backfill. Solo escribe columnas nuevas: el trigger protect_reimbursement_budget no se dispara
-- por ellas (vigila importe, moneda, dirección, estado, interno, usuario, fecha y categoría).
UPDATE "transaction" SET "origin" = CASE
  WHEN "externalId" IS NOT NULL THEN 'email'
  WHEN "reconciliation" IS NOT NULL THEN 'statement'
  WHEN "status" = 'pending'
   AND ("recurringTemplateId" IS NOT NULL OR "installmentItemId" IS NOT NULL) THEN 'system'
  ELSE 'legacy'
END;

UPDATE "transaction" t SET "creditKind" = CASE
  WHEN EXISTS (SELECT 1 FROM "expense_reimbursement" r WHERE r."creditId" = t."id") THEN 'reimbursement'
  ELSE 'income'
END
WHERE t."direction" = 'credit' AND NOT t."isInternal";

-- La compra original de un plan card (neutralizada) no es un pago: va primero.
UPDATE "transaction" t SET "internalKind" = CASE
  WHEN EXISTS (SELECT 1 FROM "installment_plan" p WHERE p."sourceTransactionId" = t."id") THEN 'installment_source'
  WHEN t."description" ~* 'pago.*tarjeta' THEN 'card_payment'
  WHEN a."accountType" = 'credit_card' THEN 'card_payment'
  ELSE 'own_transfer'
END
FROM "financial_account" a
WHERE a."id" = t."accountId" AND t."isInternal";

UPDATE "financial_account" a SET "reconciledUntil" = (
  SELECT max(b."reconciledAt") FROM "balance_bucket" b WHERE b."accountId" = a."id"
);

ALTER TABLE "transaction" ALTER COLUMN "origin" SET NOT NULL;
ALTER TABLE "transaction"
  ADD CONSTRAINT "transaction_origin_check"
    CHECK ("origin" IN ('email', 'statement', 'system', 'legacy')),
  ADD CONSTRAINT "transaction_creditKind_check"
    CHECK ("creditKind" IN ('income', 'reimbursement', 'reversal')),
  ADD CONSTRAINT "transaction_internalKind_check"
    CHECK ("internalKind" IN ('overdraft_draw', 'overdraft_payment', 'own_transfer', 'card_payment', 'installment_source'));

CREATE INDEX "transaction_reversalOfId_idx" ON "transaction"("reversalOfId");
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Lo que deja de existir (después del backfill de creditKind, que ya no necesita incomeId).
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_incomeId_fkey";
DROP INDEX "transaction_incomeId_idx";
ALTER TABLE "transaction" DROP COLUMN "incomeId";

DROP TABLE "income_amount";
DROP TABLE "income_plan";
DROP TABLE "income";

-- El límite del sobregiro vive en el bucket overdraft (limitAmount).
ALTER TABLE "financial_account" DROP COLUMN "overdraftLimit";

DROP INDEX "bank_externalLinkId_idx";
ALTER TABLE "bank" DROP COLUMN "externalLinkId", DROP COLUMN "linkToken";

COMMIT;
