-- El monto de una fuente de ingreso pasa a ser por mes con carry-forward (mismo patrón que
-- category_limit): editar el ingreso de un mes ya no reescribe los meses anteriores.

-- CreateTable
CREATE TABLE "income_amount" (
    "id" TEXT NOT NULL,
    "incomeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_amount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "income_amount_incomeId_year_month_key" ON "income_amount"("incomeId", "year", "month");

-- CreateIndex
CREATE INDEX "income_amount_incomeId_year_month_idx" ON "income_amount"("incomeId", "year", "month");

-- AddForeignKey
ALTER TABLE "income_amount" ADD CONSTRAINT "income_amount_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "income"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: el monto vigente pasa a ser el registro del mes en que se creó la fuente, de modo que
-- vale desde entonces hacia adelante por carry-forward y no aparece en meses anteriores.
INSERT INTO "income_amount" ("id", "incomeId", "year", "month", "amount", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id",
       EXTRACT(YEAR FROM "createdAt")::int,
       EXTRACT(MONTH FROM "createdAt")::int,
       "amount", NOW(), NOW()
FROM "income";

-- DropColumn (el monto ya no vive en la fuente)
ALTER TABLE "income" DROP COLUMN "amount";
