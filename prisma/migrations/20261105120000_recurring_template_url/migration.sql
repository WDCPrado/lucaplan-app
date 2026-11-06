-- Enlace opcional de una recurrente (el portal donde se paga). Nullable: las existentes quedan sin enlace.
ALTER TABLE "recurring_template" ADD COLUMN "url" TEXT;
