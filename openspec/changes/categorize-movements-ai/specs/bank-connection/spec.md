## MODIFIED Requirements

### Requirement: Cuentas conectadas de solo lectura

Una cuenta de origen `fintoc` SHALL ser de **solo lectura** para el usuario: su `balance` y sus
movimientos provienen del proveedor y se sobrescriben/importan en cada sincronización. El sistema
NO SHALL permitir editar la cuenta ni agregarle movimientos a mano, y la importación de sus
movimientos NO SHALL disparar el ajuste de saldo que aplica a las cuentas manuales.

Los **movimientos** de origen `fintoc` SHALL ser de **solo lectura** en sus datos (monto,
descripción, fecha, dirección, estado): solo Fintoc los crea y actualiza vía sincronización. La
**única** metadata que el usuario MAY modificar es la **categoría**. Al importar, cada movimiento sin
categoría recibe una categoría automática por IA (ver `ai-categorization`), y el usuario MAY cambiarla
manualmente después.

#### Scenario: No se agregan movimientos a mano a una cuenta conectada
- **WHEN** el usuario intenta registrar un movimiento manual en una cuenta de origen fintoc
- **THEN** la acción no está disponible; sus movimientos solo llegan por sincronización

#### Scenario: El usuario no edita un movimiento de Fintoc
- **WHEN** el usuario intenta cambiar el monto, la descripción o la fecha de un movimiento de origen fintoc
- **THEN** la edición no está disponible; solo Fintoc actualiza esos datos vía sincronización

#### Scenario: El usuario solo puede cambiar la categoría
- **WHEN** el usuario abre un movimiento de origen fintoc
- **THEN** puede reasignar su categoría (por sobre la sugerida por la IA), pero no editar sus demás datos

#### Scenario: El saldo lo manda el proveedor
- **WHEN** se sincroniza una cuenta conectada
- **THEN** su `balance` toma el valor reportado por Fintoc, sin recalcularse desde las transacciones locales

## ADDED Requirements

### Requirement: Categorización automática tras la sincronización

Tras importar los movimientos, la sincronización SHALL disparar la **categorización automática con
IA** (ver `ai-categorization`) de los movimientos que queden sin categoría, sin acción del usuario.
La categorización SHALL correr como parte del ciclo de sincronización (conexión inicial, webhook y
refresco). Un fallo de la categorización NO SHALL abortar la importación: los movimientos quedan sin
categoría y el resto de la sincronización continúa.

#### Scenario: El import dispara la categorización
- **WHEN** una sincronización importa movimientos nuevos sin categoría
- **THEN** el sistema los categoriza con IA a continuación, sin que el usuario haga nada

#### Scenario: Fallo de categorización no rompe la sincronización
- **WHEN** la categorización con IA falla o no está configurada
- **THEN** los movimientos quedan sin categoría y la sincronización termina con éxito igualmente

### Requirement: Loader de primera conexión hasta el primer lote categorizado

En la **primera** conexión de un banco, la UI SHALL mantener el overlay de carga hasta que el primer
lote de movimientos esté **importado y categorizado**, aunque el resto siga sincronizándose de fondo.
El overlay SHALL reflejar el paso de categorización con IA. En sincronizaciones posteriores (webhook,
refresco) NO SHALL mostrarse ese overlay: ocurren en segundo plano.

#### Scenario: El overlay espera el primer lote categorizado
- **WHEN** el usuario conecta un banco por primera vez
- **THEN** el overlay permanece hasta que aparecen los primeros movimientos importados y categorizados

#### Scenario: Sincronización de fondo no muestra overlay
- **WHEN** llega un webhook o el usuario refresca una conexión existente
- **THEN** la sincronización y categorización ocurren en segundo plano, sin overlay de carga
