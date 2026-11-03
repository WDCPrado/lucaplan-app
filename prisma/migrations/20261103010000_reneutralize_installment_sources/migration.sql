-- El reproceso del correo dejaba en false el isInternal de la compra origen de un plan de cuotas,
-- y la compra volvía a contar entera además de sus cuotas. Se vuelve a neutralizar.
UPDATE "transaction" SET "isInternal" = true
WHERE "id" IN (SELECT "sourceTransactionId" FROM "installment_plan" WHERE "sourceTransactionId" IS NOT NULL)
  AND "isInternal" = false;
