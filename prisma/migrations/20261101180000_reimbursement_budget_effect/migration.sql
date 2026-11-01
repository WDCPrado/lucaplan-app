BEGIN;

-- No backfill: historical limits may already include a manual increase.
CREATE TABLE "reimbursement_budget_effect" (
  "reimbursementId" TEXT NOT NULL,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('calendar', 'card_cycle')),
  "year" INTEGER NOT NULL CHECK ("year" BETWEEN 2000 AND 2100),
  "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
  "categoryId" TEXT NOT NULL,
  "treatment" TEXT NOT NULL CHECK ("treatment" IN ('automatic', 'manual')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reimbursement_budget_effect_pkey" PRIMARY KEY ("reimbursementId", "mode"),
  CONSTRAINT "reimbursement_budget_effect_reimbursementId_fkey" FOREIGN KEY ("reimbursementId") REFERENCES "expense_reimbursement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reimbursement_budget_effect_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "reimbursement_budget_effect_categoryId_mode_year_month_idx" ON "reimbursement_budget_effect"("categoryId", "mode", "year", "month");

-- Covers UI, MCP, bulk categorization and reconciliation in the same DB transaction.
CREATE FUNCTION protect_reimbursement_budget() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM expense_reimbursement WHERE "expenseId" = OLD.id OR "creditId" = OLD.id) THEN
    IF (NEW.amount, NEW.currency, NEW.direction, NEW.status, NEW."isInternal", NEW."userId")
       IS DISTINCT FROM (OLD.amount, OLD.currency, OLD.direction, OLD.status, OLD."isInternal", OLD."userId") THEN
      RAISE EXCEPTION 'REIMBURSEMENT_PROTECTED: Desvincula el reembolso antes de cambiar importe, moneda o estado';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM reimbursement_budget_effect e JOIN expense_reimbursement r ON r.id=e."reimbursementId" WHERE r."expenseId"=OLD.id) THEN
    IF NEW."transactionDate" IS DISTINCT FROM OLD."transactionDate" THEN
      RAISE EXCEPTION 'REIMBURSEMENT_PROTECTED: No se puede mover de período un gasto con reembolso presupuestado';
    END IF;
    IF NEW."categoryId" IS DISTINCT FROM OLD."categoryId" THEN
      IF EXISTS (SELECT 1 FROM reimbursement_budget_effect e JOIN expense_reimbursement r ON r.id=e."reimbursementId" WHERE r."expenseId"=OLD.id AND e.treatment='manual') THEN
        RAISE EXCEPTION 'REIMBURSEMENT_PROTECTED: Revisa primero el ajuste manual del presupuesto antes de recategorizar';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM category WHERE id=NEW."categoryId" AND "userId"=NEW."userId" AND type='expense' AND "isActive") THEN
        RAISE EXCEPTION 'REIMBURSEMENT_PROTECTED: El gasto reembolsado necesita una categoría de gasto activa';
      END IF;
      UPDATE reimbursement_budget_effect SET "categoryId"=NEW."categoryId"
        WHERE "reimbursementId" IN (SELECT id FROM expense_reimbursement WHERE "expenseId"=OLD.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_reimbursement_budget BEFORE UPDATE ON "transaction"
  FOR EACH ROW EXECUTE FUNCTION protect_reimbursement_budget();

CREATE FUNCTION protect_reimbursement_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.type, NEW."isActive", NEW."userId") IS DISTINCT FROM (OLD.type, OLD."isActive", OLD."userId")
     AND EXISTS (SELECT 1 FROM reimbursement_budget_effect WHERE "categoryId"=OLD.id) THEN
    RAISE EXCEPTION 'REIMBURSEMENT_PROTECTED: Recategoriza los gastos reembolsados antes de cambiar el tipo de categoría';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_reimbursement_category BEFORE UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION protect_reimbursement_category();

COMMIT;
