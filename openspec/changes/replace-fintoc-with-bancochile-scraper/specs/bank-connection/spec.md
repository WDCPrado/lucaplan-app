## REMOVED Requirements

### Requirement: Conectar un banco vía el widget de Fintoc
**Reason**: Se elimina Fintoc. La conexión pasa a login local directo en el portal del banco con
perfil persistente; ya no hay widget, public/secret key ni `link_token`.
**Migration**: El usuario conecta iniciando sesión en la ventana del navegador local. No hay datos
de producción que migrar (sin usuarios).

### Requirement: Actualización por webhook (tiempo real)
**Reason**: Un scraper local no recibe push del banco. No hay webhook ni firma que verificar.
**Migration**: La actualización es pull, disparada por el usuario (ver "Sincronización local pull").

## MODIFIED Requirements

### Requirement: Sincronización idempotente de institución, cuentas y movimientos

Al sincronizar, el sistema SHALL importar desde el banco: la **institución** como un `Bank` de
origen `bancochile`, sus **cuentas y tarjetas** con sus **saldos/cupos** (reportados por el banco) y
sus **movimientos** sin categoría. La sincronización SHALL ser **idempotente** por fuente:

- **Cuenta corriente**: movimientos con **`id` estable** → **upsert por `id`** (no duplica ni
  recalcula el saldo local; el saldo lo fija el banco). El incremental SHALL usar una **ventana de
  reconciliación solapada** (no solo "lo nuevo") para capturar movimientos tardíos o corregidos.
- **Tarjeta no facturada**: **sin id estable** → **snapshot-replace atómico** por tarjeta (ver
  requisito propio). No se dedupea por contenido (dos compras idénticas son legítimas).

La **primera** sincronización SHALL importar aproximadamente los **últimos 3 meses** de cuenta
corriente (hasta donde la paginación del banco lo permita), no todo el histórico.

#### Scenario: Primera sincronización crea banco, cuentas, tarjetas y movimientos
- **WHEN** se conecta Banco de Chile con una cuenta corriente y una tarjeta de crédito
- **THEN** se crea un `Bank` (origen bancochile), sus cuentas/tarjetas con saldos y cupos, y ~3 meses de movimientos de cuenta corriente sin categoría

#### Scenario: Re-sincronizar cuenta corriente no duplica
- **WHEN** se vuelve a sincronizar la cuenta corriente
- **THEN** los movimientos ya existentes se actualizan por su `id` (upsert), sin crear duplicados

#### Scenario: Ventana solapada captura movimientos tardíos
- **WHEN** el banco registra un movimiento con fecha anterior al último ya importado (posteo tardío)
- **THEN** la ventana de reconciliación lo trae igual y se hace upsert, en vez de quedar omitido

### Requirement: Cuentas conectadas de solo lectura

Una cuenta/tarjeta de origen `bancochile` SHALL ser de **solo lectura**: sus saldos, cupos y
movimientos provienen del banco y se sobrescriben/importan en cada sincronización. El sistema NO
SHALL permitir editar la cuenta ni agregarle movimientos a mano, y la importación NO SHALL disparar
el ajuste de saldo que aplica a las cuentas manuales. Los movimientos de origen `bancochile` SHALL
ser de solo lectura (el usuario no edita monto, descripción, fecha ni dirección).

#### Scenario: No se agregan movimientos a mano a una cuenta conectada
- **WHEN** el usuario intenta registrar un movimiento manual en una cuenta de origen bancochile
- **THEN** la acción no está disponible; sus movimientos solo llegan por sincronización

#### Scenario: El saldo lo manda el banco
- **WHEN** se sincroniza una cuenta conectada
- **THEN** su saldo/cupo toma el valor reportado por el banco, sin recalcularse desde las transacciones locales

### Requirement: Refresco manual

El sistema SHALL permitir refrescar/sincronizar manualmente una conexión para forzar la lectura. El
refresco SHALL ser idempotente por fuente (upsert por id en cuenta corriente; snapshot-replace en
tarjeta no facturada) y no duplicar lo ya importado.

#### Scenario: Sincronizar de nuevo
- **WHEN** el usuario pulsa "Sincronizar" en un banco conectado y su sesión está activa
- **THEN** el sistema vuelve a leer cuentas, saldos y movimientos, sin duplicar lo ya importado

## ADDED Requirements

### Requirement: Sincronización local pull disparada por el usuario

La sincronización SHALL ejecutarse **localmente** y **a pedido del usuario** (no por webhook ni
cron). Dado que la sesión del banco expira en minutos, el sistema SHALL **leer en caliente** justo
tras el login: el usuario inicia sesión (con 2FA) en la ventana y a continuación el sistema lee los
datos dentro de esa sesión viva. Si la sesión no está activa al sincronizar, el sistema SHALL pedir
iniciar sesión antes de leer.

#### Scenario: Sync tras login en caliente
- **WHEN** el usuario dispara "Sincronizar" y la sesión no está activa
- **THEN** se abre el portal, el usuario inicia sesión con 2FA, y recién entonces el sistema lee y guarda los datos

#### Scenario: No hay sincronización desatendida
- **WHEN** pasa el tiempo sin que el usuario dispare una sincronización
- **THEN** no ocurre ninguna sync automática (no hay webhook ni cron); los datos quedan como en la última sync manual

### Requirement: Snapshot-replace atómico de tarjeta no facturada

Los movimientos **no facturados** de una tarjeta SHALL sincronizarse por **reemplazo de la foto
completa** de esa tarjeta, de forma **atómica**: el sistema SHALL obtener y validar la lista nueva
**antes** de borrar la anterior; si la lectura falla, SHALL conservar la foto previa intacta. Cada
snapshot SHALL registrar su marca de tiempo (`asOf`) y conteo. Como no hay `id` estable ni forma
segura de distinguir compras idénticas, el sistema NO SHALL arrastrar la categoría cuando la clave
por contenido sea ambigua.

#### Scenario: La foto nueva reemplaza a la anterior
- **WHEN** se sincronizan los no facturados de una tarjeta correctamente
- **THEN** se reemplaza la lista completa de esa tarjeta por la nueva, con su `asOf`, sin duplicar

#### Scenario: Fallo de lectura conserva la foto previa
- **WHEN** la lectura de no facturados falla o se corta a mitad
- **THEN** se conserva la foto anterior intacta (no se borra ni queda a medio escribir)

#### Scenario: No se arrastra categoría ambigua
- **WHEN** dos movimientos no facturados son idénticos en contenido (misma fecha, monto, comercio, tarjeta)
- **THEN** el sistema no adivina su categoría al reemplazar la foto (mejor sin categoría que una equivocada)

### Requirement: No facturados como proyección, fuera del presupuesto

Los movimientos **no facturados** SHALL mostrarse como **proyección** de gasto, pero NO SHALL contar
en el gasto realizado, el uso de categorías ni el presupuesto, ni SHALL admitir categorización por
ítem, hasta que se facturen. La conciliación no-facturado → facturado queda como iteración
posterior explícita.

#### Scenario: No facturado no afecta el presupuesto
- **WHEN** una tarjeta tiene movimientos no facturados
- **THEN** se ven como proyección pero el presupuesto y el gasto realizado no los cuentan
