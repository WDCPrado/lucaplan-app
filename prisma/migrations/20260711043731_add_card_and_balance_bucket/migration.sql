-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "bucketId" TEXT;

-- CreateTable
CREATE TABLE "card" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cardType" TEXT NOT NULL,
    "cardLast4" TEXT NOT NULL,
    "brand" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_bucket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cardId" TEXT,
    "kind" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "limitAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "used" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "available" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "asOf" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_accountId_idx" ON "card"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "card_accountId_externalId_key" ON "card"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "balance_bucket_accountId_kind_idx" ON "balance_bucket"("accountId", "kind");

-- CreateIndex
CREATE INDEX "transaction_bucketId_idx" ON "transaction"("bucketId");

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_bucket" ADD CONSTRAINT "balance_bucket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_bucket" ADD CONSTRAINT "balance_bucket_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "balance_bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
