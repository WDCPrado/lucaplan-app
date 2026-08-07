-- Separa el BUZÓN (autorización, token, delta, suscripción) del VÍNCULO con un banco (snapshot,
-- omitidos, setup). Un buzón alimenta N bancos; un banco puede venir de N buzones.
-- Migra las conexiones existentes sin que nadie reconecte ni reingrese saldos.

-- CreateTable: buzón
CREATE TABLE "email_mailbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailProvider" TEXT NOT NULL DEFAULT 'outlook',
    "emailAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "refreshTokenEnc" TEXT NOT NULL,
    "refreshTokenIv" TEXT NOT NULL,
    "deltaLink" TEXT,
    "subscriptionId" TEXT,
    "subscriptionExpiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "discardedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_mailbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_mailbox_userId_emailAddress_key" ON "email_mailbox"("userId", "emailAddress");
CREATE INDEX "email_mailbox_subscriptionId_idx" ON "email_mailbox"("subscriptionId");

-- CreateTable: vínculo buzón ↔ banco
CREATE TABLE "email_bank_link" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankProvider" TEXT NOT NULL,
    "label" TEXT,
    "bankId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_setup',
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "lastBalanceReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_bank_link_pkey" PRIMARY KEY ("id")
);

-- Un banco no se repite dentro del mismo buzón: el enrutado por remitente no tendría cómo decidir
-- a cuál de los dos vínculos imputar el movimiento.
CREATE UNIQUE INDEX "email_bank_link_mailboxId_bankProvider_key" ON "email_bank_link"("mailboxId", "bankProvider");
CREATE UNIQUE INDEX "email_bank_link_bankId_key" ON "email_bank_link"("bankId");
CREATE INDEX "email_bank_link_userId_idx" ON "email_bank_link"("userId");

ALTER TABLE "email_bank_link" ADD CONSTRAINT "email_bank_link_mailboxId_fkey"
FOREIGN KEY ("mailboxId") REFERENCES "email_mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_bank_link" ADD CONSTRAINT "email_bank_link_bankId_fkey"
FOREIGN KEY ("bankId") REFERENCES "bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migración de datos: cada conexión existente es un buzón con un vínculo. El id del buzón reusa el
-- de la conexión, así que la suscripción de Graph ya registrada sigue resolviendo (el clientState y
-- la URL del webhook llevan ese id).
INSERT INTO "email_mailbox" (
    "id", "userId", "emailProvider", "emailAddress", "status",
    "refreshTokenEnc", "refreshTokenIv", "deltaLink", "subscriptionId",
    "subscriptionExpiresAt", "lastSyncedAt", "lastError", "createdAt", "updatedAt"
)
SELECT
    "id", "userId", "emailProvider", "emailAddress",
    -- pending_setup era estado del setup del banco, no del buzón: el buzón ya está autorizado.
    CASE WHEN "status" = 'pending_setup' THEN 'active' ELSE "status" END,
    "refreshTokenEnc", "refreshTokenIv", "deltaLink", "subscriptionId",
    "subscriptionExpiresAt", "lastSyncedAt", "lastError", "createdAt", "updatedAt"
FROM "email_connection";

INSERT INTO "email_bank_link" (
    "id", "mailboxId", "userId", "bankProvider", "label", "bankId",
    "status", "skippedCount", "lastBalanceReconciledAt", "createdAt", "updatedAt"
)
SELECT
    "id" || ':link', "id", "userId", "bankProvider", NULL, "bankId",
    CASE WHEN "bankId" IS NULL THEN 'pending_setup' ELSE 'active' END,
    "skippedCount", "lastBalanceReconciledAt", "createdAt", "updatedAt"
FROM "email_connection";

-- El método activo pasa a ser por (usuario, banco, buzón).
ALTER TABLE "bank_connection_method" ADD COLUMN "mailboxId" TEXT;

UPDATE "bank_connection_method" AS m
SET "mailboxId" = l."mailboxId"
FROM "email_bank_link" AS l
WHERE l."userId" = m."userId" AND l."bankProvider" = m."bankProvider";

-- Métodos sin buzón (bancos conectados por otra vía, o restos de integraciones retiradas) ya no
-- reclaman nada: sin buzón no hay conexión de correo que proteger.
DELETE FROM "bank_connection_method" WHERE "mailboxId" IS NULL;

ALTER TABLE "bank_connection_method" ALTER COLUMN "mailboxId" SET NOT NULL;

DROP INDEX "bank_connection_method_userId_bankProvider_key";
CREATE UNIQUE INDEX "bank_connection_method_userId_bankProvider_mailboxId_key"
ON "bank_connection_method"("userId", "bankProvider", "mailboxId");

-- La identidad externa de una cuenta importada incluye su banco: dos bancos con el mismo número de
-- cuenta o los mismos últimos 4 colisionaban en el unique (userId, externalId). Los movimientos
-- cuelgan de la cuenta por FK y su propia identidad no cambia.
UPDATE "financial_account" AS a
SET "externalId" = 'email:' || b."provider" || ':' || substring(a."externalId" from 7)
FROM "bank" AS b
WHERE a."bankId" = b."id"
  AND a."externalId" LIKE 'email:%'
  AND a."externalId" NOT LIKE 'email:' || b."provider" || ':%';

DROP TABLE "email_connection";
