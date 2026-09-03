-- Ritmo de gasto por categoría: hay categorías que no se gastan a diario ni por semana (una
-- suscripción se cobra un día del mes y listo), y ahí el ritmo solo hace ruido.
-- Por defecto activado: las categorías existentes conservan el comportamiento de hoy.
ALTER TABLE "category" ADD COLUMN "paceEnabled" BOOLEAN NOT NULL DEFAULT true;
