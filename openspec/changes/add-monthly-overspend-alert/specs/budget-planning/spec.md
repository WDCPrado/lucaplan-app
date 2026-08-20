## ADDED Requirements

### Requirement: Excedente de topes del mes (derivado)

El sistema SHALL calcular el **excedente de topes** del mes como `Σ max(0, usado − tope)` sobre las
categorías de tipo `expense` cuyo tope efectivo es mayor a cero. El cálculo SHALL usar únicamente
el usado (gasto confirmado) y NO SHALL incluir el comprometido. Las categorías sin tope y las de
tipo `income` NO SHALL participar. El valor NO SHALL persistirse y SHALL exponerse en la vista de
presupuesto del mes.

El excedente de topes es un **descuadre entre categorías**: MAY ser positivo aunque el mes tenga
presupuesto global libre, y NO SHALL interpretarse como plata faltante.

#### Scenario: Nadie pasó su tope

- **WHEN** todas las categorías de gasto están en su tope o por debajo
- **THEN** el excedente de topes del mes es 0

#### Scenario: Una categoría excedida aporta solo su exceso

- **WHEN** Salud tiene tope 60.000 y usado 63.379, y el resto está bajo su tope
- **THEN** el excedente de topes del mes es 3.379

#### Scenario: El margen de una categoría no compensa el exceso de otra

- **WHEN** Supermercado usó 262.480 de 250.000 y Cuentas usó 20.000 de 180.000
- **THEN** el excedente de topes es 12.480: lo que sobra en Cuentas no descuenta

#### Scenario: Las categorías sin tope no generan excedente

- **WHEN** una categoría de gasto sin tope registra 250.000 de gasto en el mes
- **THEN** no aporta nada al excedente de topes: sin tope no hay de qué pasarse

#### Scenario: Superar la meta de ingreso no es un excedente

- **WHEN** una categoría de ingreso recibe más que su meta del mes
- **THEN** no aporta nada al excedente de topes

#### Scenario: El comprometido no adelanta el excedente

- **WHEN** una categoría con tope 400.000 tiene 20.000 confirmados y 350.000 comprometidos
- **THEN** no aporta nada al excedente de topes hasta que ese cargo se confirme

### Requirement: Excedente del mes (derivado)

El sistema SHALL calcular el **excedente del mes** como `max(0, gasto del mes − límite global
efectivo)`, donde el gasto del mes es la suma del usado de las categorías de gasto — el mismo total
que la vista reporta como gastado. El valor NO SHALL persistirse y SHALL exponerse en la vista de
presupuesto del mes.

El excedente del mes es **plata que no había**, a diferencia del excedente de topes. Ambos valores
SHALL exponerse por separado y NO SHALL sumarse entre sí.

#### Scenario: El gasto supera el presupuesto global

- **WHEN** el límite global efectivo es 1.000.000 y el gasto del mes es 1.053.200
- **THEN** el excedente del mes es 53.200

#### Scenario: Mientras quede presupuesto libre el excedente del mes es cero

- **WHEN** el límite global efectivo es 1.000.000 y el gasto del mes es 925.939, con cuatro
  categorías por sobre su tope
- **THEN** el excedente del mes es 0 y el excedente de topes es mayor a 0

#### Scenario: Gastar justo el presupuesto no es pasarse

- **WHEN** el gasto del mes iguala exactamente el límite global efectivo
- **THEN** el excedente del mes es 0

#### Scenario: Sin límite global no hay de qué pasarse

- **WHEN** el mes no tiene límite global definido (ni propio ni heredado)
- **THEN** el excedente del mes es 0
