-- El disparador por cron se retiró: las cuotas se ejecutan al llegar el pago de la tarjeta por
-- correo, así que ninguna plantilla necesita un modo de ejecución (todas se reconocen por correo).
ALTER TABLE "recurring_template" DROP COLUMN "executionMode";
