ALTER TABLE "transaction" ADD COLUMN "bankReceivedAt" TIMESTAMP(3), ADD COLUMN "reconciliation" JSONB;
ALTER TABLE "balance_bucket" ADD COLUMN "reconciledAt" TIMESTAMP(3);
CREATE TABLE "bank_reconciliation" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
 "token" TEXT NOT NULL, "input" JSONB NOT NULL, "result" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "bank_reconciliation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_reconciliation_userId_token_key" ON "bank_reconciliation"("userId", "token");
CREATE INDEX "bank_reconciliation_userId_accountId_idx" ON "bank_reconciliation"("userId", "accountId");
