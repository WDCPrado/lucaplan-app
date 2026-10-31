-- Stop all old application writers before applying: old readers cannot distinguish modes.
BEGIN;

ALTER TABLE "category_limit" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'calendar';
ALTER TABLE "monthly_budget" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'calendar';
ALTER TABLE "income_amount" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'calendar';

DROP INDEX "category_limit_categoryId_year_month_key";
DROP INDEX "category_limit_categoryId_year_month_idx";
DROP INDEX "monthly_budget_userId_year_month_key";
DROP INDEX "income_amount_incomeId_year_month_key";
DROP INDEX "income_amount_incomeId_year_month_idx";

CREATE UNIQUE INDEX "category_limit_categoryId_mode_year_month_key" ON "category_limit"("categoryId", "mode", "year", "month");
CREATE INDEX "category_limit_categoryId_mode_year_month_idx" ON "category_limit"("categoryId", "mode", "year", "month");
CREATE UNIQUE INDEX "monthly_budget_userId_mode_year_month_key" ON "monthly_budget"("userId", "mode", "year", "month");
CREATE UNIQUE INDEX "income_amount_incomeId_mode_year_month_key" ON "income_amount"("incomeId", "mode", "year", "month");
CREATE INDEX "income_amount_incomeId_mode_year_month_idx" ON "income_amount"("incomeId", "mode", "year", "month");

INSERT INTO "category_limit" ("id", "categoryId", "mode", "year", "month", "limitAmount", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "categoryId", 'card_cycle', "year", "month", "limitAmount", "createdAt", "updatedAt" FROM "category_limit" WHERE "mode" = 'calendar';
INSERT INTO "monthly_budget" ("id", "userId", "mode", "year", "month", "globalLimit", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "userId", 'card_cycle', "year", "month", "globalLimit", "createdAt", "updatedAt" FROM "monthly_budget" WHERE "mode" = 'calendar';
INSERT INTO "income_amount" ("id", "incomeId", "mode", "year", "month", "amount", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "incomeId", 'card_cycle', "year", "month", "amount", "createdAt", "updatedAt" FROM "income_amount" WHERE "mode" = 'calendar';

CREATE TABLE "income_plan" (
  "incomeId" TEXT NOT NULL REFERENCES "income"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "mode" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "endedYear" INTEGER,
  "endedMonth" INTEGER,
  CONSTRAINT "income_plan_pkey" PRIMARY KEY ("incomeId", "mode")
);
INSERT INTO "income_plan" ("incomeId", "mode", "isActive", "endedYear", "endedMonth")
SELECT "id", modes.mode, "isActive", "endedYear", "endedMonth"
FROM "income" CROSS JOIN (VALUES ('calendar'), ('card_cycle')) AS modes(mode);

ALTER TABLE "income" DROP COLUMN "isActive", DROP COLUMN "endedYear", DROP COLUMN "endedMonth";
ALTER TABLE "category_limit" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "monthly_budget" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "income_amount" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "category_limit" ADD CONSTRAINT "category_limit_mode_check" CHECK ("mode" IN ('calendar', 'card_cycle'));
ALTER TABLE "monthly_budget" ADD CONSTRAINT "monthly_budget_mode_check" CHECK ("mode" IN ('calendar', 'card_cycle'));
ALTER TABLE "income_amount" ADD CONSTRAINT "income_amount_mode_check" CHECK ("mode" IN ('calendar', 'card_cycle'));
ALTER TABLE "income_plan" ADD CONSTRAINT "income_plan_mode_check" CHECK ("mode" IN ('calendar', 'card_cycle'));
ALTER TABLE "income_plan" ADD CONSTRAINT "income_plan_end_check" CHECK (
  ("endedYear" IS NULL AND "endedMonth" IS NULL) OR
  ("endedYear" IS NOT NULL AND "endedMonth" IS NOT NULL AND "endedMonth" BETWEEN 1 AND 12)
);

COMMIT;
