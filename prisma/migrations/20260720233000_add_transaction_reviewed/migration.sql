-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "reviewed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: los movimientos creados por el usuario (sin externalId) ya fueron decididos por él;
-- no deben aparecer en el triage. Los importados del banco (externalId) quedan reviewed=false.
UPDATE "transaction" SET "reviewed" = true WHERE "externalId" IS NULL;
