-- AlterTable
ALTER TABLE "bank" ADD COLUMN     "externalLinkId" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "linkToken" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "financial_account" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "pending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'confirmed';

-- CreateIndex
CREATE INDEX "bank_externalLinkId_idx" ON "bank"("externalLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_account_userId_externalId_key" ON "financial_account"("userId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_accountId_externalId_key" ON "transaction"("accountId", "externalId");
