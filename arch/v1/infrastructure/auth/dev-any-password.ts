// Atajo de desarrollo local: entrar con cualquier contraseña. El correo SIGUE siendo obligatorio —
// Better Auth responde 401 antes de llegar a `verify()` si no existe el usuario, si no tiene cuenta
// `credential` o si no tiene contraseña guardada; lo único que se salta es la comparación del hash.
//
// Doble candado para que esto no exista fuera de local:
//   1. `NODE_ENV === "development"` — Next fuerza `production` en `next build`/`next start`, que es
//      como corre producción, Docker y los entornos de PR de Railway.
//   2. `DEV_ANY_PASSWORD === "true"` — opt-in explícito. Sin él nadie que clone el repo se
//      encuentra el bypass activo por sorpresa al levantar `pnpm dev`.
// Un solo candado no basta: la env sola viajaría en cualquier `.env` copiado a un deploy, y
// NODE_ENV solo abriría el login de todo el que corra el dev server sin haberlo pedido.
export function devAnyPasswordEnabled(
  env: { NODE_ENV?: string; DEV_ANY_PASSWORD?: string } = process.env
): boolean {
  return env.NODE_ENV === "development" && env.DEV_ANY_PASSWORD === "true"
}
