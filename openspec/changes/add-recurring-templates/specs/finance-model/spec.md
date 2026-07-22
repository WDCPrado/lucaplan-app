## MODIFIED Requirements

### Requirement: Estados del movimiento

Un `Transaction` importado MUST guardar el **estado** que reporta el proveedor
(`confirmed` | `pending` | `reversed` | `duplicated`) y actualizarlo en cada sincronización. Solo
los movimientos **`confirmed`** SHALL contar para la caja activa, el uso de categorías y el
presupuesto; los `pending`, `reversed` y `duplicated` SHALL excluirse de esos cálculos. Un
movimiento que pasa a `reversed`/`duplicated` SHALL dejar de contar automáticamente al
sincronizarse (sin borrarse ni duplicarse). Los movimientos manuales se consideran `confirmed`.

Adicionalmente, el estado `pending` SHALL usarse para el **gasto comprometido**: un
movimiento que el sistema ya sabe que ocurrirá (materializado por una plantilla recurrente)
pero que aún no se ha cobrado. Un movimiento `pending` sigue **sin contar** como gasto en
los cálculos anteriores; SHALL poder reportarse aparte como comprometido del mes.

Al cobrarse, el período SHALL quedar con **un solo** movimiento confirmado, sin doble
conteo: cuando el cobro no viene del banco (ejecución por cron) el mismo movimiento (mismo
id) pasa a `confirmed`; cuando el cobro llega importado desde el banco, el movimiento
importado —que ya trae su identidad externa y ya movió los saldos— es el que queda como
ejecución confirmada y el comprometido se consume.

#### Scenario: Pending pasa a confirmed
- **WHEN** un movimiento pending se confirma en el banco y llega la sincronización
- **THEN** el mismo movimiento (mismo id) queda `confirmed` y pasa a contar para los cálculos

#### Scenario: Movimiento reversado deja de contar
- **WHEN** un movimiento confirmado se marca `reversed` en una sincronización posterior
- **THEN** deja de contar para caja/presupuesto, sin borrarse ni duplicarse

#### Scenario: Comprometido no cuenta como gasto
- **WHEN** una plantilla recurrente materializa su movimiento del mes como `pending`
- **THEN** el uso de la categoría y la caja activa no lo incluyen, y queda disponible como comprometido del mes

## ADDED Requirements

### Requirement: Vínculo del movimiento con su plantilla recurrente

Un `Transaction` SHALL poder referenciar la plantilla recurrente que lo originó
(`recurringTemplateId`, nullable), del mismo modo que ya referencia su fuente de ingreso.
Un movimiento vinculado SHALL conservar la categoría de la plantilla y NO SHALL ser
recategorizado automáticamente. Eliminar la plantilla NO SHALL borrar los movimientos ya
confirmados: SHALL dejarlos sin vínculo.

#### Scenario: Movimiento generado queda enganchado
- **WHEN** una plantilla recurrente materializa el movimiento de su período
- **THEN** el movimiento queda con `recurringTemplateId` apuntando a la plantilla

#### Scenario: Borrar la plantilla conserva los movimientos
- **WHEN** se elimina una plantilla con movimientos confirmados
- **THEN** esos movimientos se conservan con `recurringTemplateId` en null
