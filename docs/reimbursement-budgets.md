# Reembolsos y topes por categoría

Al vincular una compra de $60.000 con un abono de $20.000, una categoría con tope base
$100.000 pasa a $120.000. Gastado sigue siendo $60.000 y disponible $60.000. El movimiento
bancario y la categoría de ingreso del abono permanecen intactos; no se vuelve a descontar
el reembolso del gasto. El abono real cuenta como ingreso según las reglas existentes de
fuentes planificadas, sin otro ingreso artificial.

## Persistencia y período

`ReimbursementBudgetEffect` registra el vínculo, modo, categoría, año, mes y tratamiento.
`automatic` aporta el importe vinculado como suplemento; `manual` marca que el usuario ya
lo incorporó al tope y no aporta otro incremento. Crear un vínculo nuevo y su efecto es una
sola transacción serializable. Se reintentan conflictos de serialización/clave única y se
revalidan las capacidades del gasto y abono. El recibo MCP conserva la idempotencia por
`operationId`; la clave única gasto/abono evita duplicar con otra operación.

El período se deriva de la fecha civil de la compra mediante el servicio de períodos y los
cierres configurados, dentro de la misma transacción. Nunca se usa el mes del servidor o
del abono. El suplemento pertenece al modo activo; el otro modo conserva su tratamiento.
Los topes base siguen heredándose dentro de cada modo. El suplemento se suma únicamente
en su año/mes: no escribe topes futuros ni altera un tope futuro explícito.

La lectura común `effectiveLimit` suma estos suplementos `periodOnly`. Dashboard, detalle,
plan, ritmo, alertas y MCP reciben el mismo tope. `allocated` los incluye y
`remainingToAllocate` resta el total al límite global, que esta operación no modifica.
Una sobreasignación se muestra, como cualquier otra sobreasignación del plan.

Editar un tope existente recibe el **total efectivo** mostrado y guarda la base restando
los suplementos de ese período. Así guardar no vuelve a sumar el reembolso ni lo arrastra
a meses futuros. El total no puede quedar por debajo del suplemento; se rechaza con un
mensaje que indica el mínimo, sin cambiar datos.

## Cambios posteriores

- Borrar el vínculo, gasto o abono elimina el efecto por cascada; la base queda intacta.
- Recategorizar una compra con suplementos automáticos mueve sus efectos a la nueva
  categoría de gasto en la misma transacción. No puede quedar sin categoría o en ingreso.
- Las marcas de ajuste manual bloquean recategorización: mover un tope ya editado por el
  usuario requiere revisar ese ajuste explícitamente.
- Importe, moneda, dirección, estado e indicador interno de movimientos vinculados están
  protegidos en la base; también la fecha de una compra con efecto presupuestario. Se
  rechaza la operación completa, incluso si proviene de una edición masiva o conciliación.
- No se puede eliminar, desactivar o cambiar a ingreso una categoría mientras tenga efectos.

## Historial ya ajustado manualmente

La migración crea la tabla y protecciones; **no hace backfill ni cambia los topes existentes**.
Un vínculo sin efecto en el modo mantiene el comportamiento histórico: gasto neto y, cuando
corresponde, `reimbursementAdjustment` para no contar también el mismo abono como ingreso libre.

Si el usuario confirma que ya aumentó los topes de determinados reembolsos, primero generar
un preview con sus IDs exactos y el modo correspondiente:

```bash
node --env-file=.env scripts/normalize-reimbursement-budgets.ts \
  --user-id=USER_ID --reimbursement-ids=LINK_ID_1,LINK_ID_2 --mode=card_cycle
```

Revisar categoría, período, importe y `budgetIncrease: 0`. Repetir con `--apply` únicamente
para los ajustes manuales confirmados. La normalización guarda `manual`, muestra gasto
bruto y elimina su compensación del medidor; no vuelve a incrementar topes, caja ni ingresos.
Es idempotente. Rechaza IDs ajenos o automáticos. No se ejecuta en deploy ni en el seed real.
No se debe marcar todo el historial de todos los usuarios como ajustado manualmente.

## Verificación

La suite estática cubre gasto bruto, legado mixto, ingresos planificados y abonos adicionales.
La integración `scripts/verify-reimbursement-budgets.ts` exige una base local vacía llamada
`reimbursement_test` y `REIMBURSEMENT_TEST_DATABASE_URL`; no acepta la `DATABASE_URL` normal.
Después de aplicar todas las migraciones, comprueba topes heredados/futuros, modos, reintentos,
capacidad concurrente compartida, rollback, normalización, recategorización y cascadas.
CI ejecuta este script contra PostgreSQL 17.

La escena `reembolsos@lucaplan.cl` contiene una cena ficticia de $60.000 y un reembolso de
$20.000: Compras debe mostrar $120.000 de tope y $60.000 disponibles. En el próximo período
hereda $100.000. La escena no cambia usuarios reales ni el modo global.
