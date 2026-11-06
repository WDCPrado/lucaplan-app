-- Marca los movimientos que generó «Generar cuota»: solo esos los reemplaza el correo del banco.
ALTER TABLE "transaction" ADD COLUMN "generatedFromInstallment" BOOLEAN NOT NULL DEFAULT false;

-- Los ya generados se reconocen por la descripción exacta que les pone la app
-- («<plan> · cuota <n>/<total>») sobre la misma cuota que saldan, y sin id del banco. Si la persona
-- editó la descripción o el plan cambió de nombre o de N° de cuotas, quedan en false: no se
-- reemplazan, que es lo seguro.
UPDATE "transaction" t
SET "generatedFromInstallment" = true
FROM "installment_item" i
JOIN "installment_plan" p ON p."id" = i."planId"
WHERE t."installmentItemId" = i."id"
  AND t."externalId" IS NULL
  AND t."description" = p."description" || ' · cuota ' || i."index" || '/' || p."installmentsCount";
