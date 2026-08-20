## ADDED Requirements

### Requirement: Banda de excedente en el Resumen

El Resumen SHALL mostrar, entre el bloque "Presupuesto de \<mes\>" y la sección "Cuentas", una
banda que junte cuánto se pasó el mes. La banda SHALL renderizarse únicamente cuando al menos uno
de los dos excedentes del mes es mayor a 0, y SHALL tomar ambos valores de la vista de presupuesto
sin recalcularlos.

La banda SHALL ser la **única superficie del Resumen que anuncia el excedente**: ninguna otra
sección repite esa cifra. La banda NO SHALL sumar los dos excedentes entre sí.

#### Scenario: Mes cuadrado no muestra banda

- **WHEN** el excedente del mes y el excedente de topes son ambos 0
- **THEN** no se renderiza ninguna banda y el Resumen queda como hoy

#### Scenario: El mes se pasó del presupuesto

- **WHEN** el excedente del mes es mayor a 0
- **THEN** la banda muestra ese monto como cifra principal y el excedente de topes queda como
  detalle junto a las categorías que lo causan

#### Scenario: Topes reventados con presupuesto del mes disponible

- **WHEN** el excedente del mes es 0, el excedente de topes es mayor a 0 y el mes tiene presupuesto
  global definido
- **THEN** la banda muestra el excedente de topes como cifra principal y dice explícitamente que el
  presupuesto del mes todavía alcanza, para que no se lea como plata faltante

#### Scenario: Topes reventados sin presupuesto del mes definido

- **WHEN** el excedente de topes es mayor a 0 y el mes no tiene límite global definido
- **THEN** la banda NO SHALL afirmar que el presupuesto del mes alcanza —no hay contra qué
  medirlo— y en su lugar SHALL decir que la cifra es solo lo que se pasó de los topes, de modo que
  no contradiga al bloque de presupuesto, que en ese estado está pidiendo definirlo

#### Scenario: Las categorías culpables son visibles

- **WHEN** la banda se muestra con categorías por sobre su tope
- **THEN** lista esas categorías con cuánto se pasó cada una, ordenadas de mayor a menor exceso, en
  una fila que se desplaza horizontalmente sin empujar el resto del Resumen

#### Scenario: La cifra principal se lee en ambos temas

- **WHEN** la banda se renderiza en tema claro o en tema oscuro
- **THEN** la cifra principal cumple el contraste mínimo de texto, quedando el color del estado en
  elementos decorativos (ícono y borde) que no cargan la legibilidad

### Requirement: El bloque de presupuesto del mes no anuncia el excedente

El bloque "Presupuesto de \<mes\>" del Resumen SHALL reportar el presupuesto del mes y el avance de
lo gastado, y NO SHALL anunciar que el usuario se pasó: ese aviso pertenece a la banda de
excedente. El "Libre" en negativo se mantiene como señal propia del bloque.

#### Scenario: Gasto por sobre el presupuesto

- **WHEN** el gasto del mes supera el límite global
- **THEN** el bloque de presupuesto sigue mostrando cuánto lleva gastado y su porcentaje, y es la
  banda —una sola vez en la pantalla— la que anuncia por cuánto se pasó
