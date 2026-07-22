-- Fecha fin opcional de una plantilla recurrente. NULL = indefinida (comportamiento actual).
ALTER TABLE "recurring_template" ADD COLUMN "endDate" DATE;
