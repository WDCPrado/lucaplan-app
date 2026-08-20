## Why

El dashboard avisa **categoría por categoría** cuando el gasto pasa el tope ("Sin margen · $3.379
sobre el tope"), pero nunca junta esos avisos en una cifra. Con cuatro categorías reventadas hay
que sumar de cabeza para saber cuánto se pasó el mes.

El titular tampoco lo responde: `MonthStatus` compara el gasto contra el **presupuesto global**, y
ahí puede quedar plata libre mientras varias categorías están por sobre su tope. Hoy conviven, sin
que la app lo diga, dos cifras que el usuario necesita distinguir:

- **Excedente de topes** — lo que se pasó categoría por categoría. Es un descuadre del reparto: la
  plata existía, estaba asignada a otra cosa.
- **Excedente del mes** — lo gastado por sobre el presupuesto global. Esta sí es plata que no
  había, y la que un mes siguiente tendrá que reservar.

Sin esa distinción, un "me pasé $74.313" se lee como "debo $74.313" aunque el mes tenga $647.902
de presupuesto libre.

## What Changes

- El sistema deriva el **excedente de topes** del mes: `Σ max(0, usado − tope)` sobre las
  categorías de **gasto** con tope mayor a cero. Solo cuenta lo confirmado (`usado`), no el
  comprometido.
- El sistema deriva el **excedente del mes**: `max(0, gasto del mes − límite global)`. Vale 0
  mientras quede presupuesto libre, y 0 también si el mes no tiene límite global definido.
- Ambos viajan como campos del `BudgetViewDTO`; el front no recalcula ninguno.
- El Resumen gana una **banda** entre "Presupuesto de \<mes\>" y la sección "Cuentas" que junta el
  panorama: la cifra grande es la que duele (el excedente del mes cuando existe, el de topes en
  caso contrario), y las categorías culpables van como detalle. Con ambos en $0 no se renderiza.
- Cuando el excedente del mes es 0 pero el de topes no, la banda dice explícitamente que el
  presupuesto del mes todavía alcanza — es el caso que más se malinterpreta.

Fuera de alcance:

- `MonthStatus` **no cambia**: su "Te pasaste por $X" ya es el excedente del mes y no se duplica
  ahí. La banda es la que junta las dos cifras.
- No se arrastra el excedente al mes siguiente ni se reserva nada automáticamente: la banda
  informa, no mueve plata.
- La banda no es accionable (no abre el plan ni el detalle de categoría). Es un titular, no un
  flujo.

## Capabilities

### Modified Capabilities

- `budget-planning`: dos derivados nuevos del mes (excedente de topes y excedente del mes), con la
  regla de qué categorías participan y por qué no son la misma cifra.
- `finance-ui`: la banda del Resumen — cuándo aparece, qué cifra manda y qué dice en cada caso.

## Impact

- **Application**: dos funciones puras en `budget-formulas.ts` y dos campos nuevos en
  `BudgetViewDTO` (`getBudgetView`). El cálculo por categoría se reordena para conservar los montos
  en `Money` antes de bajarlos al DTO, en vez de reconstruirlos desde los números.
- **UI**: componente nuevo `components/finance/overspend-banner.tsx`, montado en el dashboard entre
  `MonthStatus` y "Cuentas".
- **API**: `GET /api/budgets` devuelve dos campos más. Cambio aditivo: ningún consumidor existente
  se rompe.
- **Sin migración ni cambios de schema**: los dos valores son derivados, como el uso y el
  comprometido.
