-- Nombre visible de la plantilla, separado de `description` (clave de match del correo).
-- Backfill: las plantillas existentes arrancan con label = description (el nombre que el usuario ve hoy).
ALTER TABLE "recurring_template" ADD COLUMN "label" TEXT;
UPDATE "recurring_template" SET "label" = "description";
ALTER TABLE "recurring_template" ALTER COLUMN "label" SET NOT NULL;
