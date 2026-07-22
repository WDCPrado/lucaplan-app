-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "recurringTemplateId" TEXT,
ADD COLUMN     "periodKey" TEXT;

-- CreateTable
CREATE TABLE "recurring_template" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "baseAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "tolerancePct" INTEGER NOT NULL DEFAULT 10,
    "periodicity" TEXT NOT NULL DEFAULT 'monthly',
    "executionMode" TEXT NOT NULL DEFAULT 'email_detection',
    "dayOfMonth" INTEGER,
    "startDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_template_userId_isActive_idx" ON "recurring_template"("userId", "isActive");

-- CreateIndex
CREATE INDEX "recurring_template_accountId_idx" ON "recurring_template"("accountId");

-- CreateIndex
CREATE INDEX "recurring_template_categoryId_idx" ON "recurring_template"("categoryId");

-- CreateIndex
CREATE INDEX "transaction_recurringTemplateId_idx" ON "transaction"("recurringTemplateId");

-- CreateIndex
-- Idempotencia por (plantilla, período): en Postgres los NULL no colisionan, así que los
-- movimientos que no vienen de una plantilla no se ven afectados.
CREATE UNIQUE INDEX "transaction_recurringTemplateId_periodKey_key" ON "transaction"("recurringTemplateId", "periodKey");

-- AddForeignKey
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "recurring_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
