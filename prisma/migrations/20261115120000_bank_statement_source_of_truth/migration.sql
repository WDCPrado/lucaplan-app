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

-- Un abono es reembolso si sus vínculos lo cubren entero (uno parcial no basta); si no, ingreso solo
-- con categoría de ingreso; en una tarjeta, reverso; el resto, reembolso (no infla el ingreso del plan).
UPDATE "transaction" t SET "creditKind" = CASE
  WHEN (SELECT sum(r."amount") FROM "expense_reimbursement" r WHERE r."creditId" = t."id") = t."amount" THEN 'reimbursement'
  WHEN EXISTS (SELECT 1 FROM "category" c WHERE c."id" = t."categoryId" AND c."type" = 'income') THEN 'income'
  WHEN a."accountType" = 'credit_card' THEN 'reversal'
  ELSE 'reimbursement'
END
FROM "financial_account" a
WHERE a."id" = t."accountId" AND t."direction" = 'credit' AND NOT t."isInternal";

-- La compra original de un plan card (neutralizada) no es un pago: va primero.
UPDATE "transaction" t SET "internalKind" = CASE
  WHEN EXISTS (SELECT 1 FROM "installment_plan" p WHERE p."sourceTransactionId" = t."id") THEN 'installment_source'
  -- El aviso de pago de la línea quedaba como abono interno en el bucket overdraft.
  WHEN EXISTS (SELECT 1 FROM "balance_bucket" b WHERE b."id" = t."bucketId" AND b."kind" = 'overdraft') THEN 'overdraft_payment'
  WHEN t."description" ~* 'pago.*tarjeta' THEN 'card_payment'
  WHEN a."accountType" = 'credit_card' THEN 'card_payment'
  ELSE 'own_transfer'
END
FROM "financial_account" a
WHERE a."id" = t."accountId" AND t."isInternal";

-- El corte de la última conciliación aplicada (su recibo); reconciledAt del bucket también lo movía
-- «actualizar saldos» a mano, que no es una cartola.
UPDATE "financial_account" a SET "reconciledUntil" = (
  SELECT max((r."input"->>'snapshotAt')::timestamptz) AT TIME ZONE 'UTC'
  FROM "bank_reconciliation" r WHERE r."accountId" = a."id"
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

-- El límite del sobregiro vive en el bucket overdraft (limitAmount): la corriente con línea y sin
-- ese bucket lo recibe antes de perder la columna. La deuda se cuenta una sola vez: si la caja está
-- bajo cero, eso pasa a ser lo usado de la línea y la caja queda en 0; sin bucket de caja, lo usado
-- es el saldo negativo de la cuenta (sin caja, la posición sigue leyendo el saldo, no la línea).
WITH src AS (
  SELECT a."id", a."userId", a."currency", a."overdraftLimit", coalesce(
    (SELECT sum(greatest(-c."available", 0)) FROM "balance_bucket" c
     WHERE c."accountId" = a."id" AND c."kind" = 'cash' AND c."currency" = a."currency"),
    greatest(-a."balance", 0)) AS "used"
  FROM "financial_account" a
  WHERE a."accountType" = 'checking' AND a."overdraftLimit" > 0
    AND NOT EXISTS (SELECT 1 FROM "balance_bucket" b WHERE b."accountId" = a."id" AND b."kind" = 'overdraft')
), created AS (
  INSERT INTO "balance_bucket" ("id", "userId", "accountId", "kind", "currency", "limitAmount", "used", "available", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, "userId", "id", 'overdraft', "currency", "overdraftLimit",
    "used", "overdraftLimit" - "used", now(), now()
  FROM src
  RETURNING "accountId", "currency"
)
, cash AS (
  UPDATE "balance_bucket" c SET "available" = 0, "updatedAt" = now()
  FROM created
  WHERE c."accountId" = created."accountId" AND c."kind" = 'cash'
    AND c."currency" = created."currency" AND c."available" < 0
  RETURNING c."accountId"
)
-- El saldo de la cuenta refleja la caja (como lo escribe la sincronización).
UPDATE "financial_account" a SET "balance" = 0 FROM cash WHERE a."id" = cash."accountId";

ALTER TABLE "financial_account" DROP COLUMN "overdraftLimit";

DROP INDEX "bank_externalLinkId_idx";
ALTER TABLE "bank" DROP COLUMN "externalLinkId", DROP COLUMN "linkToken";

COMMIT;
