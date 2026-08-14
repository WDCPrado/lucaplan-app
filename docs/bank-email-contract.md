# Contrato de correo bancario

Qué necesita un banco para funcionar en Luca Plan, y qué cubren hoy Banco de Chile, Banco BICE y
MACHBANK.

El sistema no lee saldos: reconstruye el movimiento desde las **notificaciones por correo**. Un
banco se soporta cuando sus correos permiten extraer, sin adivinar, cuatro cosas: **cuánto**,
**cuándo**, **a qué instrumento** y **qué efecto** tiene. Si falta cualquiera, el correo se omite
— nunca se infiere.

El parser es **fail-closed**: solo remitentes y asuntos de la allowlist producen eventos.
Cualquier otro correo se descarta con un motivo sin contenido sensible.

## Regla universal: del correo solo sale el gasto

**Un correo bancario nunca crea una entrada de dinero.** Vale para Banco de Chile y para cualquier
banco que se integre después. Del correo salen exactamente dos efectos:

- **Gasto** — entra al presupuesto y se categoriza.
- **Ajuste de saldo interno** — mueve saldo o cupo entre bolsillos propios y nada más: fuera de
  ingresos, gastos, presupuesto, categorización y notificaciones push. Son los pagos de tarjeta y
  de línea de crédito, donde la plata no entra ni sale, solo cambia de lugar.

La plata que **entra** no está en ninguno de los dos: el abono se descarta. Que te transfieran, que
te devuelvan un préstamo o que te llegue un reembolso no crea movimiento — el dinero que entra se
declara en el módulo de Ingresos.

El motivo es que el correo no alcanza para decidirlo: un abono de $500.000 puede ser un sueldo, la
devolución de un préstamo entre amigos o plata que alguien te pidió guardar, y el aviso del banco se
ve idéntico en los tres casos —mismo remitente, misma plantilla—. Adivinar infla el presupuesto con
plata que no es para gastar, y sumarlo al saldo lo duplica cuando el mismo dinero ya se declaró como
ingreso.

Los ingresos se declaran en el **módulo de Ingresos**, que es independiente del banco y del método de
conexión. Es la única fuente de verdad de cuánto entra al mes: así funciona igual con un banco
integrado, con cinco o con ninguno. Un banco nuevo no puede cambiar esta regla ni pedir una excepción.

En el código la regla es **estructural**, no una decisión por banco: `EmailEventKind` no tiene una
variante de ingreso (`expense | internal_credit | internal_payment`) y `isInternalEvent` marca como
interno todo lo que no sea gasto, en un único punto que atraviesa importación inicial y sync. Los
abonos se reconocen solo para descartarlos, con el motivo `abono_ignorado`, que los separa de los
correos que se omiten por estar rotos. En la UI los movimientos internos llevan el badge **"Ajuste
de saldo"** y no suman en el total del día.

## Catálogo Banco de Chile

Remitentes permitidos (catálogo, clave `bancochile`): `enviodigital@bancochile.cl` (avisos) y
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
| Aviso de transferencia de fondos / Notificación de abono | — | **Descartado** (`abono_ignorado`) | — | Nada: la plata que entra se declara en Ingresos. Ver la regla universal de arriba. |

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
| `abono_ignorado` | Aviso de plata que entra. No es un fallo: se descarta a propósito. |

Los conteos por motivo se muestran en el escaneo inicial: son el termómetro de cuánto está
quedando fuera.

## Catálogo Banco BICE

Remitente permitido (catálogo, clave `bice`): `reply@info.bice.cl`. Es el único que notifica
movimientos; `beneficiosbice@info.bice.cl`, `newsletter-bicestore@bicestore.cl`,
`experiencia@bancobice.cl` y el resto son marketing o servicio y no entran al catálogo.

Sus plantillas son tablas de **etiqueta | valor** (`Monto`, `Número de cuenta`, `Cupo`, `Medio de
pago`, `Número de operación`), así que el monto sale siempre de su etiqueta: la letra chica de las
promociones va al pie de varias plantillas y trae cifras en pesos que un `$` suelto confundiría con
el movimiento.

| Asunto | `source` | Efecto | Instrumento | Qué se extrae |
| --- | --- | --- | --- | --- |
| Hicimos la transferencia | `transferencia` | Gasto | Cuenta corriente | Monto CLP, cuenta de origen, nombre del destinatario y N° de operación. Del destinatario **solo** el nombre: ni RUT, ni correo, ni su cuenta. |
| Enviamos tu pago a *(comercio)* | `transferencia_fondos` | Gasto | Cuenta corriente | Igual que la anterior; el comercio sale del **asunto**, que es más estable que el cuerpo. |
| Confirmación del pago de tarjeta de crédito | `pago_tarjeta` | Interno (dos patas) | Tarjeta + cuenta del medio de pago | Nacional e internacional comparten asunto: los distingue la etiqueta `Cupo`. Nacional cobra en pesos; internacional informa la deuda en dólares (`Monto`) y lo cargado en pesos (`Monto pagado`). Sin `Cupo` se omite por `plantilla_desconocida`. |
| Recibiste una transferencia / Aviso de transferencia de fondos | — | **Descartado** (`abono_ignorado`) | — | Nada: la plata que entra se declara en Ingresos. |

La identidad idempotente es el **N° de operación**, que BICE emite alfanumérico
(`EXP0067420260790738557`) o numérico (`239167263`). La fecha viene al pie con el mes abreviado
(`28 Jul 2026, 17:12`); cuando la plantilla no la trae se usa la de recepción.

**Falta:** los cargos en cuenta y las compras con tarjeta (crédito y débito). No aparecieron
ejemplos en una revisión de tres meses del buzón, así que hasta tenerlos se omiten como
`asunto_desconocido` — inventar la plantilla sería peor que no cubrirla.

## Catálogo MACHBANK — solo débito

Remitentes permitidos (catálogo, clave `machbank`): `no-reply@mail.machbank.cl` (transferencias),
`contacto@mail.machbank.cl` (compras y pagos, **también marketing**) y `noreply@somosmach.com`
(dominio anterior, solo abonos). Que uno de ellos mande promociones no debilita nada: cada plantilla
exige asunto de la allowlist **y** confirmación en el cuerpo.

MACHBANK se modela como **una cuenta principal CLP con su tarjeta Visa Débito**. No hay tarjeta de
crédito, cupos, cuotas, pago de tarjeta ni sobregiro: ninguna plantilla los produce, así que el
único bucket que nace de este banco es `cash`.

| Asunto | `source` | Efecto | Instrumento | Qué se extrae |
| --- | --- | --- | --- | --- |
| Realizaste una transferencia a *(destinatario)* | `transferencia` | Gasto | Cuenta principal | Monto CLP (etiqueta `Monto`), destinatario del **asunto** y `Código de confirmación`. Del destinatario solo el nombre: ni RUT, ni banco, ni su cuenta. |
| Tu compra con MACHBANK 📲 | `cargo_cuenta` | Gasto | Cuenta corriente (últimos 4 de la Visa Débito) | `Comercio`, `Monto CLP`, últimos 4 e `Identificador Visa`. |
| Le pagaste a *(destinatario)* | `transferencia` | Gasto | Cuenta principal | Monto CLP de la frase `Le pagaste <monto> a <destinatario>` y el destinatario del asunto. Sin fecha ni ID propios: recepción y `Message-ID`. |
| Recibiste una transferencia de *(remitente)* | — | **Descartado** (`abono_ignorado`) | — | Nada: la plata que entra se declara en Ingresos. |

Dos cosas que esta plantilla obliga a hacer bien:

- **El monto sale de su etiqueta.** La compra informa `Monto (moneda original) $ 1 USD` **antes** que
  `Monto CLP $ 943`, y al pie menciona "un cargo de $500 a $1.500 para validar tu tarjeta". Una
  compra en dólares con débito se cobra en pesos: el gasto es el `Monto CLP`, nunca un cargo USD.
- **El aviso de la plata que entra usa la misma maqueta que el saliente.** Lo único que los separa
  es el verbo (`Acabas de hacer` vs `Acabas de recibir`), así que la transferencia saliente exige esa
  frase en el cuerpo además del asunto.

### La cuenta principal, un instrumento sin número

La transferencia y el pago directo nombran el origen solo como "tu cuenta principal MACHBANK". El
parser lo refiere tal cual (`primary_checking`) en vez de inventar dígitos, y la resolución contra
los instrumentos confirmados exige que el vínculo tenga **exactamente una** cuenta corriente. Con
cero o varias el movimiento se omite y suma a los omitidos del vínculo: elegir una escribiría el
gasto en la cuenta equivocada.

Como esa referencia no numera nada, tampoco propone candidatos en el escaneo: la cuenta sale de las
compras con débito —que sí traen los últimos 4— o la agrega el usuario al confirmar.

## Qué debe aportar un banco nuevo

1. **Remitentes fijos.** Uno o varios, estables. Sin esto no hay allowlist y no hay fail-closed.
2. **Asuntos reconocibles por tipo de operación**, idealmente exactos o por prefijo. Un asunto
   genérico para todo obliga a clasificar por cuerpo, que es mucho más frágil.
3. **Cobertura de los dos efectos:** gasto y pago interno. Si el banco no notifica los pagos de
   tarjeta, los saldos se desalinean y hay que reconciliar a mano. Sus avisos de dinero entrante se
   descartan: ver la regla universal de arriba, que el banco nuevo no puede cambiar.
4. **Monto con moneda inequívoca.** Hoy se soportan CLP (`$ 1.234.567`, puntos de miles) y USD
   (`US$ 12,34`, `USD 1.234,56`). Cuando la plantilla trae varias cifras (interés, utilizado, tipo
   de cambio), el monto **debe** salir de una etiqueta concreta, nunca del primer `$` del texto.
5. **Instrumento identificable:** cuenta por número completo o últimos 4; tarjeta por últimos 4.
   Si la plantilla solo dice "tu cuenta principal", existe la referencia sin número, que se resuelve
   cuando el vínculo tiene una sola cuenta corriente (ver MACHBANK). Lo que no se hace nunca es
   inventar el número ni tomar los últimos 4 de otro dato del correo.
6. **Identidad estable por operación**, para que reprocesar un correo no duplique el movimiento.
   Orden de preferencia: ID de transacción del banco → ID TEF → `Message-ID` → id del proveedor de
   correo. Los tres primeros sobreviven a que el correo se reenvíe o se reindexe; el último no.
7. **Fecha del movimiento en el cuerpo.** Si no viene, se usa la de recepción, que se corre cuando
   el banco notifica con retraso.

Lo que **no** se necesita: API del banco, credenciales, scraping. Solo lectura del correo.

## Cómo se agrega un banco

Los bancos soportados viven en un catálogo (`bank-email-registry.ts`), una entrada por banco:

```ts
{ key: "bancochile", name: "Banco de Chile", senders: [...], parse: (msg) => ParsedEmail }
```

Agregar un banco es agregar su entrada y su archivo de parseo. Los use-cases no se tocan: piden el
parser por clave y enrutan cada correo **por remitente** antes de parsearlo. Ese enrutado es lo que
permite que un mismo buzón alimente varios bancos sin que los correos de uno cuenten como omitidos
del otro.

Los tipos del evento y los helpers que no dependen del banco (HTML→texto, montos CLP/USD, últimos 4,
cuentas, fechas, identidad idempotente) viven en `bank-email-map.ts`. Cada parser importa de ahí y
**nunca** del parser de otro banco: lo propio de cada uno son sus remitentes, sus asuntos y las
regex de sus plantillas.

Variantes de la misma institución (por ejemplo, los avisos de una cuenta empresa) van como
remitentes adicionales de la **misma** clave: el efecto financiero es idéntico. Lo que distingue
"personal" de "empresa" es la etiqueta del vínculo, no el parser.

El catálogo se inyecta como dependencia, así que los tests pueden registrar un banco de prueba sin
esperar a que exista uno real.

## Cómo se conecta: buzón y vínculos

- Un **buzón** es un correo autorizado: un token, un estado delta y una suscripción, sin importar
  cuántos bancos alimente. Su estado de autorización lo comparten todos sus bancos, y una sola
  reconexión los restablece.
- Un **vínculo** es lo que ese buzón alimenta en un banco concreto: su snapshot, sus instrumentos y
  sus mensajes omitidos. Se agrega sin pasar de nuevo por OAuth.
- Un banco puede venir de varios correos (personal y empresa) y se distinguen por una etiqueta, que
  el usuario elige y es obligatoria desde el segundo. Lo que **no** se puede es repetir un banco
  dentro del mismo correo: el enrutado por remitente no tendría cómo decidir a cuál imputar el
  movimiento.
- La identidad externa de las cuentas importadas incluye el banco
  (`email:<bankKey>:acct:<ref>`): dos bancos pueden tener el mismo número de cuenta o los mismos
  últimos 4.
