-- WDC-185: ingresos programados (expectativa mensual del plan) y el vínculo abono → programado. Aditiva.
-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "incomeSourceId" TEXT;

-- CreateTable
CREATE TABLE "income_source" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "income_source_userId_idx" ON "income_source"("userId");

-- CreateIndex
CREATE INDEX "income_source_categoryId_idx" ON "income_source"("categoryId");

-- CreateIndex
CREATE INDEX "transaction_incomeSourceId_idx" ON "transaction"("incomeSourceId");

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_incomeSourceId_fkey" FOREIGN KEY ("incomeSourceId") REFERENCES "income_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reglas que la app ya valida, también en la base.
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_day_of_month" CHECK ("dayOfMonth" BETWEEN 1 AND 31);
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_currency" CHECK ("currency" IN ('CLP', 'USD'));

-- Monto de un mes que reemplaza al base del programado.
CREATE TABLE "income_source_amount" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "income_source_amount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "income_source_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "income_source_amount_month" CHECK ("month" BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX "income_source_amount_sourceId_year_month_key" ON "income_source_amount"("sourceId", "year", "month");

ALTER TABLE "income_source_amount" ADD CONSTRAINT "income_source_amount_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "income_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
