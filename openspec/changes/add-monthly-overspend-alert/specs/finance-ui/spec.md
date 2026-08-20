## ADDED Requirements

### Requirement: Banda de excedente en el Resumen

El Resumen SHALL mostrar, entre el bloque "Presupuesto de \<mes\>" y la sección "Cuentas", una
banda que junte cuánto se pasó el mes. La banda SHALL renderizarse únicamente cuando al menos uno
de los dos excedentes del mes es mayor a 0, y SHALL tomar ambos valores de la vista de presupuesto
sin recalcularlos.

La banda NO SHALL sumar las dos cifras entre sí ni duplicar el aviso que ya da el bloque de
presupuesto del mes.

#### Scenario: Mes cuadrado no muestra banda

- **WHEN** el excedente del mes y el excedente de topes son ambos 0
- **THEN** no se renderiza ninguna banda y el Resumen queda como hoy

#### Scenario: El mes se pasó del presupuesto

- **WHEN** el excedente del mes es mayor a 0
- **THEN** la banda muestra ese monto como cifra principal, en el color de excedido, y el excedente
  de topes queda como detalle junto a las categorías que lo causan

#### Scenario: Topes reventados con presupuesto del mes disponible

- **WHEN** el excedente del mes es 0 y el excedente de topes es mayor a 0
- **THEN** la banda muestra el excedente de topes como cifra principal y dice explícitamente que el
  presupuesto del mes todavía alcanza, para que no se lea como plata faltante

#### Scenario: Las categorías culpables son visibles

- **WHEN** la banda se muestra con categorías por sobre su tope
- **THEN** lista esas categorías con cuánto se pasó cada una, ordenadas de mayor a menor exceso, en
  una fila que se desplaza horizontalmente sin empujar el resto del Resumen
