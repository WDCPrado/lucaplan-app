## Context

`getBudgetView` ya calcula por categoría el `usado` (confirmado del mes), el `tope` efectivo con
carry-forward y el `disponible = tope − usado`, y los baja al DTO en unidad mayor. El dashboard
pinta con eso el aviso por categoría ("Sin margen · $3.379 sobre el tope") y `MonthStatus` compara
el gasto total contra el límite global ("Te pasaste por $X").

Lo que falta no es un dato nuevo: es la **suma**. Y falta decir que las dos sumas posibles no
significan lo mismo.

## Goals / Non-Goals

**Goals:**

- Una cifra que responda "¿cuánto me pasé este mes?" sin sumar de cabeza.
- Separar el descuadre entre categorías de la plata que de verdad faltó.
- Que la banda no contradiga a `MonthStatus`: donde ambos muestran el excedente del mes, la cifra
  es idéntica.

**Non-Goals:**

- Arrastrar el excedente al mes siguiente (reserva automática). Es otra discusión: toca el
  presupuesto del mes que viene, no este aviso.
- Sumar el comprometido. El comprometido es una capa aparte en todo el modelo y mezclarlo haría
  que el excedente subiera por movimientos que el banco aún no cobró.
- Convertir la banda en un flujo (abrir el plan, filtrar movimientos). Primero que exista la cifra.

## Decisions

### 1. Dos funciones puras, no una

`computeCapsOverspend(categories, currency)` y `computeMonthOverspend(spent, globalLimit)` viven en
`budget-formulas.ts` junto al resto de derivados del presupuesto. Son cifras distintas con reglas
distintas: la primera recorre categorías, la segunda compara dos totales. Fundirlas en una función
que devuelva ambas obligaría a pasarle datos que cada una no usa.

`computeCapsOverspend` recibe `{ type, used, limit }` en `Money` — no el `CategoryDTO` ya
aplanado — para no reconstruir montos desde números y para no acoplar `budget-formulas` al DTO.

### 2. El excedente de topes solo mira categorías de gasto **con tope**

Sin tope no hay de qué pasarse: una categoría sin límite (transferencias, inversión) no puede
generar excedente, y contarla como "todo lo gastado es exceso" convertiría el aviso en ruido. Las
categorías de ingreso quedan fuera por definición: superar la meta de ingreso es lo deseable.

### 3. Solo lo confirmado

Se suma sobre `usado`, que ya excluye `pending` e internos. El comprometido tiene su propia capa en
el modelo (`committed`) y en la UI; meterlo aquí haría que el excedente creciera por cargos que
todavía pueden no ocurrir.

### 4. El excedente del mes se mide contra el mismo total que muestra la UI

`spent` es `Σ usado` de las categorías de **gasto**, exactamente el total que el dashboard rotula
"Gastado" y que `MonthStatus` usa para su "Te pasaste por $X". Calcularlo de otra forma (por
ejemplo sumando todos los movimientos del mes, incluidos los sin categoría) daría dos cifras
distintas para la misma frase en la misma pantalla.

Sin límite global el resultado es 0, no `null`: "no hay presupuesto definido" ya lo comunica
`MonthStatus` con su propio estado vacío, y un `null` extra obligaría a la banda a distinguir un
caso en el que igual no se muestra.

### 5. La jerarquía de la banda la decide el excedente del mes

- `monthOverspend > 0` → cifra grande = excedente del mes, en `destructive`. Es plata que no había.
  El de topes baja a detalle, con las categorías culpables.
- `monthOverspend === 0` y `capsOverspend > 0` → cifra grande = excedente de topes, en `warning`, y
  una línea explícita de que el presupuesto del mes todavía alcanza. El cambio de color es parte
  del mensaje: el rojo de la app significa "te pasaste de verdad".
- Ambos en 0 → no se renderiza nada.

Alternativa descartada: **mostrar siempre las dos cifras con el mismo peso**. Dos montos grandes
lado a lado se leen como sumables, que es justo el error que la banda viene a evitar.

Alternativa descartada: **poner la cifra dentro de `MonthStatus`**. Ese card responde "¿cuánto
puedo gastar?" con el presupuesto como titular; meterle un segundo titular en rojo competía con el
suyo. La banda va fuera, pegada abajo.

### 6. Las categorías culpables se derivan en el front

El DTO expone solo los dos totales. El front ya recibe `budget.categories` con `used` y `limit` por
categoría, así que la lista de culpables sale de ahí con un filtro. Un segundo campo con el
desglose sería el mismo dato dos veces, con el riesgo de que se contradigan.
