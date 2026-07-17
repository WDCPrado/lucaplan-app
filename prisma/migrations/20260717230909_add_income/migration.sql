-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "incomeId" TEXT;

-- CreateTable
CREATE TABLE "income" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "income_userId_idx" ON "income"("userId");

-- CreateIndex
CREATE INDEX "income_accountId_idx" ON "income"("accountId");

-- CreateIndex
CREATE INDEX "income_categoryId_idx" ON "income"("categoryId");

-- CreateIndex
CREATE INDEX "transaction_incomeId_idx" ON "transaction"("incomeId");

-- AddForeignKey
ALTER TABLE "income" ADD CONSTRAINT "income_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income" ADD CONSTRAINT "income_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "income"("id") ON DELETE SET NULL ON UPDATE CASCADE;
