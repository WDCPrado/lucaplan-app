## Context

La vista de presupuesto ya deriva el **excedente del mes** (`max(0, gasto − límite global)`) y lo
expone en `BudgetViewDTO.monthOverspend`; la banda del Resumen lo muestra. Es plata que no había:
lo gastado de más ya salió del colchón o de la tarjeta.

El plan del mes (`components/finance/plan-sheet.tsx`) ofrece igualar el presupuesto global a
`activeIncomeTotal` —la suma de los ingresos activos en CLP, calculada en el dashboard—. Esa oferta
ignora por completo el mes anterior, así que un mes que cerró excedido no tiene ninguna
consecuencia en el mes siguiente.

Restricciones que enmarcan el diseño:

- La app **avisa, no bloquea** (README). Nada de esto puede impedir repartir de más.
- El excedente **de topes** por categoría no es deuda: la plata existía, estaba asignada a otra
  cosa. Confundirlos es exactamente el error que el aviso de excedente vino a evitar.
- Nada que persistir: la deuda es derivada, como el uso y el comprometido.

## Goals / Non-Goals

**Goals:**

- Que el total que el plan ofrece repartir descuente lo que el mes anterior gastó de más.
- Que el número descontado sea **el mismo** que la vista del mes anterior reporta como excedente
  del mes, sin margen para que las dos superficies muestren cifras distintas.
- Que el descuento se explique en pantalla: de qué mes viene y por cuánto.

**Non-Goals:**

- Reservar plata, crear una categoría de deuda o mover el reparto: el descuento vive en la
  sugerencia.
- Acumular deuda de más de un mes hacia atrás.
- Cambiar el Resumen, la banda de excedente o el `BudgetViewDTO`.

## Decisions

### 1. La deuda se lee reusando `getBudgetView` del mes anterior

`getPreviousMonthDebt(deps, userId, year, month)` calcula el mes anterior y devuelve el
`monthOverspend` de `getBudgetView` para ese mes.

*Alternativa descartada:* una función liviana que sume el gasto del mes anterior por su cuenta y
llame a `computeMonthOverspend`. Sería una consulta más barata, pero duplicaría la definición de
"gasto del mes" —Σ `used` de las categorías de gasto, con su filtro de confirmado, no interno, en
CLP y por fecha UTC—. Esa duplicación es justo el riesgo que el aviso de excedente ya había
decidido evitar: el número que el plan descuenta tiene que ser idénticamente el que la banda del
mes anterior mostró. Reusar la vista lo garantiza por construcción, no por disciplina.

*Techo de la simplificación:* es una lectura completa del mes anterior (categorías, movimientos,
presupuestos, cuotas e ingresos) para quedarse con un solo número. Corre en paralelo con el resto
de las lecturas del dashboard, así que no alarga la cadena. Si algún día el dashboard queda corto
de latencia, el paso siguiente es extraer de `getBudgetView` la porción "gasto del mes + límite
global efectivo" y que ambos la usen — no escribir una segunda fórmula.

### 2. La deuda viaja por el server component, no por el `BudgetViewDTO`

`app/dashboard/page.tsx` la pide junto al resto de la vista y la baja como prop hasta el plan.

*Alternativa descartada:* un campo `previousMonthDebt` en `BudgetViewDTO`. Obligaría a que
`getBudgetView` se llame a sí misma para el mes anterior —recursión de un nivel que hay que cortar
a mano— y a que `GET /api/budgets` pague esa lectura extra en cada llamada, incluida la de los
consumidores a los que la deuda no les sirve de nada. La única superficie que la necesita es el
plan del mes.

### 3. El descuento se aplica al total sugerido, con piso en cero

`max(0, Σ ingresos activos − deuda)`. El piso importa: con una deuda mayor que los ingresos, un
sugerido negativo no es un presupuesto — y el endpoint que lo recibe exige un entero ≥ 0.

La sugerencia se sigue ofreciendo solo cuando el número sugerido difiere del presupuesto vigente,
igual que hoy; lo que cambia es contra qué número se compara.

### 4. Sin presupuesto global en el mes, no hay nada que mostrar

El límite global efectivo hereda por carry-forward: si el mes en pantalla no tiene límite (ni
propio ni heredado), es porque no existe ningún registro anterior — luego el mes anterior tampoco
lo tenía y la deuda es 0 por definición. No hace falta una rama de UI para ese estado: sería código
inalcanzable.

### 5. El texto cambia solo cuando hay deuda

Sin deuda, la sugerencia queda literalmente como hoy (mismo texto, misma etiqueta de botón), para
que el caso normal no se vuelva más ruidoso. Con deuda se agrega una línea que nombra el mes
anterior y el monto, y la etiqueta del botón deja de decir "al ingreso" — el número ya no es el
ingreso, y un botón que promete otra cosa que la que hace se lee como un bug.

## Risks / Trade-offs

- **Una lectura completa del mes anterior por carga del dashboard** → corre dentro del `Promise.all`
  que ya existe, en paralelo con las otras siete lecturas, así que suma consultas pero no pasos.
  El techo y el camino de salida quedan escritos en la decisión 1.
- **El descuento se aplica al sugerido, no al presupuesto vigente** → un usuario que nunca toca el
  botón sigue con su presupuesto de siempre y solo ve la explicación. Es deliberado: mover el
  presupuesto sin que lo pidan sería decidir por él, y la app avisa en vez de bloquear.
- **Un mes anterior sin presupuesto definido no genera deuda aunque se haya gastado de más** → es
  la regla, no un descuido: no se puede pasar de un límite que no existe. El usuario que quiera la
  cifra tiene que definir presupuesto.
- **El seed del entorno de PR no se corrió contra una base real** → `scripts/seed-pr-feature.ts` se
  reescribe para dejar el mes anterior excedido, pero verificarlo exige re-sembrar desde cero
  (`SEED_PR_FORCE=1`), lo que borraría los datos del usuario demo de la base local. Queda revisado
  solo de forma estática; probarlo de verdad es el turno del usuario al abrir el entorno del PR. Si
  fallara, el seed base ya lo aísla (try/catch) y el entorno queda con los datos de siempre: la
  feature se vería sin deuda, no rota.
