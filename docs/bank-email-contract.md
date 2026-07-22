# Contrato de correo bancario

Qué necesita un banco para funcionar en Luca Plan, y qué cubre hoy Banco de Chile.

El sistema no lee saldos: reconstruye el movimiento desde las **notificaciones por correo**. Un
banco se soporta cuando sus correos permiten extraer, sin adivinar, cuatro cosas: **cuánto**,
**cuándo**, **a qué instrumento** y **qué efecto** tiene. Si falta cualquiera, el correo se omite
— nunca se infiere.

El parser es **fail-closed**: solo remitentes y asuntos de la allowlist producen eventos.
Cualquier otro correo se descarta con un motivo sin contenido sensible.

## Catálogo Banco de Chile

Remitentes permitidos: `enviodigital@bancochile.cl` (avisos) y
`serviciodetransferencias@bancochile.cl` (comprobantes).

| Asunto | `source` | Efecto | Instrumento | Qué se extrae |
| --- | --- | --- | --- | --- |
| Cargo en cuenta | `cargo_cuenta` | Gasto | Cuenta corriente | Monto CLP y motivo del cargo. Sin cuenta identificada se omite. |
| Compra con tarjeta de crédito | `compra_tarjeta` | Gasto | Tarjeta (últimos 4) | Monto CLP o USD y el comercio. |
| Transferencia a terceros | `transferencia` | Gasto | Cuenta corriente | Monto CLP, destinatario e ID TEF. |
| Transferencias de fondos a *(comercio)* | `transferencia_fondos` | Gasto | Cuenta corriente | Igual que la anterior; el comercio sale del **asunto**, que es más estable que el cuerpo. |
| Comprobante pago crédito consumo | `pago_credito_consumo` | Gasto | Cuenta corriente (origen) | Monto pagado, fecha y N° de cuota. Es gasto real: el consumo financiado nunca entró a la app, así que la cuota es la única vez que ese dinero aparece. |
| Pago de tarjeta de crédito nacional / internacional | `pago_tarjeta` | Interno (dos patas) | Tarjeta + cuenta de origen | Monto de la deuda (CLP o USD) y monto en caja. Baja el utilizado de la tarjeta y descuenta de la cuenta corriente. Ni gasto ni ingreso. |
| Pago de línea de crédito | `pago_linea` | Interno | Cuenta corriente | Monto CLP; ajusta el sobregiro. |
| Aviso de transferencia de fondos / Notificación de abono | `abono` | Interno | Cuenta corriente | Monto CLP. Sube el saldo sin contar como ingreso: el origen es desconocido. |

**Gasto** entra al presupuesto y se categoriza (con IA si no lo reclama una plantilla recurrente).
**Interno** solo mueve saldos: fuera del presupuesto, fuera de la categorización.

### Motivos de omisión

| Motivo | Cuándo |
| --- | --- |
| `remitente_desconocido` | El remitente no está en la allowlist. |
| `asunto_desconocido` | Remitente válido, asunto no catalogado. |
| `sin_monto` | La plantilla no expone el monto en el formato esperado. |
| `sin_instrumento` | No se identifica la cuenta o la tarjeta. |
| `plantilla_desconocida` | Asunto correcto pero el cuerpo no coincide con la plantilla conocida. |

Los conteos por motivo se muestran en el escaneo inicial: son el termómetro de cuánto está
quedando fuera.

## Qué debe aportar un banco nuevo

1. **Remitentes fijos.** Uno o varios, estables. Sin esto no hay allowlist y no hay fail-closed.
2. **Asuntos reconocibles por tipo de operación**, idealmente exactos o por prefijo. Un asunto
   genérico para todo obliga a clasificar por cuerpo, que es mucho más frágil.
3. **Cobertura de los tres efectos:** gasto, abono interno y pago interno. Si el banco no notifica
   los pagos de tarjeta, los saldos se desalinean y hay que reconciliar a mano.
4. **Monto con moneda inequívoca.** Hoy se soportan CLP (`$ 1.234.567`, puntos de miles) y USD
   (`US$ 12,34`, `USD 1.234,56`). Cuando la plantilla trae varias cifras (interés, utilizado, tipo
   de cambio), el monto **debe** salir de una etiqueta concreta, nunca del primer `$` del texto.
5. **Instrumento identificable:** cuenta por número completo o últimos 4; tarjeta por últimos 4.
6. **Identidad estable por operación**, para que reprocesar un correo no duplique el movimiento.
   Orden de preferencia: ID de transacción del banco → ID TEF → `Message-ID` → id del proveedor de
   correo. Los tres primeros sobreviven a que el correo se reenvíe o se reindexe; el último no.
7. **Fecha del movimiento en el cuerpo.** Si no viene, se usa la de recepción, que se corre cuando
   el banco notifica con retraso.

Lo que **no** se necesita: API del banco, credenciales, scraping. Solo lectura del correo.

## Qué falta para soportar un segundo banco

El parser de Banco de Chile está invocado directamente desde
`email-connection-use-cases.ts` (escaneo, previsualización e importación). No hay puerto ni
registro de parsers, así que hoy agregar un banco no es escribir su parser: es editar el
use-case en tres puntos.

El arreglo natural es un mapa `bankKey → parser` con la firma que ya existe
(`(msg: BankEmailMessage) => ParsedEmail`), resuelto desde la conexión. No se ha hecho porque
todavía no hay un segundo banco que lo justifique — pero es la primera pieza a mover cuando
aparezca, antes de escribir una sola regex nueva.
