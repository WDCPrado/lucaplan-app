## Context

La conexión por correo ya es multi-banco: un buzón de Outlook alimenta N vínculos, el enrutado
atribuye cada mensaje por remitente y cada banco aporta su parser puro
(`docs/bank-email-contract.md`). Banco de Chile y BICE entraron así, sin tocar los use-cases.

MACHBANK trae dos novedades respecto de esos dos:

1. **Es solo débito.** No hay tarjeta de crédito, cupos, cuotas ni línea. El único bucket es `cash`.
   La tarjeta Visa Débito pertenece a la cuenta corriente, igual que la que Banco de Chile ya crea
   junto a la cuenta (`cardLast4` + `card: { cardType: "debito" }`).
2. **Dos de sus tres plantillas no numeran la cuenta de cargo**: dicen "tu cuenta principal
   MACHBANK". El contrato actual solo sabe expresar cuenta por número/últimos 4 o tarjeta por
   últimos 4.

La evidencia son cuatro correos reales del buzón del usuario (adjuntos en WDC-62), uno por caso.

## Goals / Non-Goals

**Goals:**

- MACHBANK conectable desde el mismo flujo de Outlook, con sus tres plantillas de salida como gasto
  CLP y el abono descartado.
- Expresar "la cuenta principal" en el contrato del parser sin inventar números de cuenta.
- Mantener el parser fail-closed pese a que uno de los remitentes también manda marketing.

**Non-Goals:**

- Tarjeta de crédito MACHBANK, cupos nacional/internacional, compras en cuotas, pago de tarjeta,
  línea de crédito y sobregiro. Ninguno tiene evidencia y el usuario no los tiene contratados.
- Cargar en USD lo que MACHBANK cobra en pesos: una compra internacional con débito es un cargo CLP.
- Cambiar la UI del selector de bancos o del snapshot: MACHBANK sale del catálogo y el formulario de
  confirmación ya soporta "cuenta corriente sin sobregiro y sin tarjetas".

## Decisions

### 1. `primary_checking` como tercera variante de `EmailInstrumentRef`

```ts
export type EmailInstrumentRef =
  | { kind: "checking"; ref: string }
  | { kind: "credit_card"; last4: string }
  | { kind: "primary_checking" } // la plantilla dice "tu cuenta principal", sin número
```

Se resuelve en `resolveEventTarget` a la **única** cuenta `checking` confirmada del vínculo; con
cero o varias devuelve `null` y el movimiento se omite, que es el comportamiento que ya tiene
cualquier mapeo ambiguo.

Alternativas descartadas:

- **Un `ref` centinela** (`{ kind: "checking", ref: "principal" }`): no cambia el tipo, pero mete un
  string mágico en un campo documentado como "solo dígitos", y hay que interceptarlo igual en la
  resolución y en la detección de candidatos —donde además generaría un candidato con "últimos 4"
  basura. Mismo trabajo, peor contrato.
- **`instrument: null`**: ya significa "el correo no identifica el instrumento" y se omite. Perdería
  los movimientos que sí queremos importar.

La variante nueva rompe la compilación en los tres sitios que hoy discriminan `checking` vs
`credit_card` (resolución, proyección del setup, proyección de la sync) — que es exactamente donde
hay que decidir algo. La detección de candidatos la ignora: sin número no hay candidato que
proponer.

### 2. El monto sale siempre de su etiqueta, nunca del primer `$`

Las tres plantillas traen más de una cifra en pesos:

- la compra informa `Monto (moneda original) $ 1 USD` **antes** que `Monto CLP $ 943`, y su letra
  chica menciona "un cargo de $500 a $1.500 para validar tu tarjeta";
- el pie de la transferencia trae textos de seguridad.

Entonces: `Monto CLP` para la compra, `Monto` para la transferencia y la frase `Le pagaste <monto> a
<destinatario>` para el pago directo. Es el mismo criterio que ya obliga BICE.

### 3. Identidad idempotente propia por plantilla

- Transferencia → `Código de confirmación`.
- Compra → `Identificador Visa`.
- Pago directo → **no trae ninguno**: cae al fallback existente (`internetMessageId` → id de Graph).

Van por `txnId` (`email:txn:<id>`), no por `tefId`: no son IDs TEF.

### 4. El destinatario/comercio sale del asunto cuando el asunto lo trae

La transferencia y el pago directo lo llevan en el asunto (`Realizaste una transferencia a <nombre>`,
`Le pagaste a <nombre>`), que es más estable que la maqueta del cuerpo — mismo criterio que
`Transferencias de Fondos a …` (Banco de Chile) y `Enviamos tu pago a …` (BICE). El cuerpo se usa
solo para **validar** la plantilla y sacar monto e identidad. El comercio de la compra sí sale del
cuerpo (`Comercio`), porque su asunto es genérico.

El RUT, el banco y la cuenta de destino no se extraen: no se necesitan para el movimiento.

### 5. Fail-closed con un remitente que también manda marketing

`contacto@mail.machbank.cl` envía la compra, el pago directo **y** promociones. No hay problema de
diseño: el parser exige asunto de la allowlist **y** confirmación en el cuerpo, y todo lo demás
devuelve `asunto_desconocido`. Los tres remitentes entran al catálogo con la misma clave `machbank`,
igual que las variantes de una institución.

`noreply@somosmach.com` (dominio viejo de MACH) entra solo para poder descartar sus abonos con
`abono_ignorado`; sin él, esos correos contarían como "descartados" del buzón.

### 6. La tarjeta de débito no crea una cuenta aparte

La compra identifica los últimos 4 de la Visa Débito (`6220`), y esa tarjeta es de la cuenta
corriente. El evento se emite con `{ kind: "checking", ref: "6220" }`: el escaneo lo propone como
candidato de cuenta corriente y la confirmación crea la cuenta con `cardLast4 = 6220` y su tarjeta
de débito, que es exactamente lo que ya hace el flujo. No se crea `credit_card`.

## Risks / Trade-offs

- **La cuenta principal se resuelve por "hay exactamente una"** → si el usuario llegara a confirmar
  dos cuentas corrientes en el mismo vínculo MACHBANK, las transferencias dejan de importarse (se
  cuentan como omitidas, visibles en el estado). Es el trade-off correcto: adivinar la cuenta
  escribiría el gasto en el lugar equivocado. Hoy el formulario de confirmación admite una sola
  cuenta corriente por vínculo, así que el caso es teórico.
- **Sin compras con débito en el mes del escaneo no hay candidato de cuenta** (las transferencias no
  numeran nada) → el usuario agrega la cuenta a mano en la confirmación, que el formulario ya
  permite. Alternativa descartada: proponer una cuenta con un número inventado.
- **El asunto de la compra trae un emoji** (`Tu compra con MACHBANK 📲`) → se compara por prefijo
  normalizado, no por igualdad exacta, para que un cambio de emoji o su ausencia no rompa el
  adapter.
- **MACHBANK no notifica todos los movimientos** (por ejemplo cargos automáticos o devoluciones sin
  correo) → el saldo proyectado se corrige con "Actualizar saldos", igual que en los otros bancos.
