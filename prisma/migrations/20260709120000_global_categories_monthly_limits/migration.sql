-- DropForeignKey
ALTER TABLE "category" DROP CONSTRAINT "category_budgetId_fkey";

-- DropIndex
DROP INDEX "category_budgetId_idx";

-- DropIndex
DROP INDEX "category_budgetId_name_key";

-- AlterTable
ALTER TABLE "category" DROP COLUMN "budgetId",
DROP COLUMN "limitAmount",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "userId" TEXT NOT NULL;

-- DropTable
DROP TABLE "budget";

-- CreateTable
CREATE TABLE "category_limit" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "limitAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_limit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_limit_categoryId_year_month_idx" ON "category_limit"("categoryId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "category_limit_categoryId_year_month_key" ON "category_limit"("categoryId", "year", "month");

-- CreateIndex
CREATE INDEX "category_userId_idx" ON "category"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "category_userId_name_key" ON "category"("userId", "name");

-- AddForeignKey
ALTER TABLE "category_limit" ADD CONSTRAINT "category_limit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
