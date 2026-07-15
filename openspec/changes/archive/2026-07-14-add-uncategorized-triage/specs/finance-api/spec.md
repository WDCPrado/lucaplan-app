## ADDED Requirements

### Requirement: Lectura de movimientos sin categoría

La capa de lectura SHALL exponer `listUncategorized(deps, userId)`: movimientos del usuario
con `categoryId = null`, excluyendo `status ∈ {reversed, duplicated}` y `isInternal = true`,
de todos los periodos, ordenados por fecha descendente. Se implementa como filtro
`uncategorized` en `TransactionSearchFilters`; el repo Prisma SHALL traducir el flag al
criterio completo dentro del `where` (no post-filtrado), de modo que el `limit` no se consuma
con filas inelegibles. La lectura pide `limit + 1` (51) para señalar "hay más" sin count. El
dato llega al dashboard por server component (sin endpoint HTTP nuevo).

#### Scenario: Filtro uncategorized

- **WHEN** se busca con `{ uncategorized: true, limit: 50 }`
- **THEN** solo se devuelven movimientos sin categoría elegibles, más nuevos primero

#### Scenario: Ownership

- **WHEN** se consulta la lectura para un usuario
- **THEN** solo devuelve movimientos de cuentas de ese usuario
