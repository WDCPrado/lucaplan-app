-- Conexión por correo (Outlook → Banco de Chile) y método de conexión exclusivo por banco.

-- Método de conexión explícito del banco conectado (scraper | email); null = manual/fintoc.
ALTER TABLE "bank" ADD COLUMN "connectionMethod" TEXT;
UPDATE "bank" SET "connectionMethod" = 'scraper' WHERE "provider" = 'bancochile';

-- CreateTable
CREATE TABLE "email_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankProvider" TEXT NOT NULL DEFAULT 'bancochile',
    "emailProvider" TEXT NOT NULL DEFAULT 'outlook',
    "emailAddress" TEXT NOT NULL,
    "bankId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_setup',
    "refreshTokenEnc" TEXT NOT NULL,
    "refreshTokenIv" TEXT NOT NULL,
    "deltaLink" TEXT,
    "subscriptionId" TEXT,
    "subscriptionExpiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "lastBalanceReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_connection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_connection_userId_bankProvider_key" ON "email_connection"("userId", "bankProvider");

-- CreateIndex
CREATE INDEX "email_connection_subscriptionId_idx" ON "email_connection"("subscriptionId");

-- Una conexión de correo pertenece como máximo a un banco; si ese banco se borra por otra vía,
-- la conexión vuelve a quedar sin enlace en vez de apuntar a un id inexistente.
CREATE UNIQUE INDEX "email_connection_bankId_key" ON "email_connection"("bankId");
ALTER TABLE "email_connection" ADD CONSTRAINT "email_connection_bankId_fkey"
FOREIGN KEY ("bankId") REFERENCES "bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "bank_connection_method" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankProvider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_connection_method_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: la fila única por (usuario, banco) impide dos métodos activos a la vez.
CREATE UNIQUE INDEX "bank_connection_method_userId_bankProvider_key" ON "bank_connection_method"("userId", "bankProvider");

-- Backfill: los bancos bancochile existentes reclaman el método scraper.
INSERT INTO "bank_connection_method" ("id", "userId", "bankProvider", "method")
SELECT "userId" || ':bancochile:method', "userId", 'bancochile', 'scraper'
FROM "bank"
WHERE "provider" = 'bancochile'
ON CONFLICT DO NOTHING;
