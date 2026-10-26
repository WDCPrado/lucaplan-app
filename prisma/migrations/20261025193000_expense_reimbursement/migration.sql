CREATE TABLE "expense_reimbursement" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "expenseId" TEXT NOT NULL,
 "creditId" TEXT NOT NULL,
 "amount" DECIMAL(18,2) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "expense_reimbursement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expense_reimbursement_expenseId_creditId_key" ON "expense_reimbursement"("expenseId","creditId");
CREATE INDEX "expense_reimbursement_userId_expenseId_idx" ON "expense_reimbursement"("userId","expenseId");
CREATE INDEX "expense_reimbursement_creditId_idx" ON "expense_reimbursement"("creditId");
ALTER TABLE "expense_reimbursement" ADD CONSTRAINT "expense_reimbursement_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_reimbursement" ADD CONSTRAINT "expense_reimbursement_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
