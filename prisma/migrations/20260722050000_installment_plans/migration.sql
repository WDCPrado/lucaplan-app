-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "installmentItemId" TEXT;

-- CreateTable
CREATE TABLE "installment_plan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sourceTransactionId" TEXT,
    "description" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "tolerancePct" INTEGER NOT NULL DEFAULT 10,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_item" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidOutsideApp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installment_plan_sourceTransactionId_key" ON "installment_plan"("sourceTransactionId");

-- CreateIndex
CREATE INDEX "installment_plan_userId_idx" ON "installment_plan"("userId");

-- CreateIndex
CREATE INDEX "installment_plan_accountId_kind_completedAt_idx" ON "installment_plan"("accountId", "kind", "completedAt");

-- CreateIndex
CREATE INDEX "installment_plan_categoryId_idx" ON "installment_plan"("categoryId");

-- CreateIndex
CREATE INDEX "installment_item_planId_idx" ON "installment_item"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "installment_item_planId_index_key" ON "installment_item"("planId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_installmentItemId_key" ON "transaction"("installmentItemId");

-- AddForeignKey
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_item" ADD CONSTRAINT "installment_item_planId_fkey" FOREIGN KEY ("planId") REFERENCES "installment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_installmentItemId_fkey" FOREIGN KEY ("installmentItemId") REFERENCES "installment_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

