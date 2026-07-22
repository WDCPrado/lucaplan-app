-- Eliminar una fuente de ingreso pasa a significar "deja de existir desde este mes", conservando
-- los meses anteriores (mismo criterio que editar el monto, que solo afecta al mes en curso).
ALTER TABLE "income" ADD COLUMN "endedYear" INTEGER,
ADD COLUMN "endedMonth" INTEGER;
