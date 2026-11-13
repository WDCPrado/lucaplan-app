// Mutex en memoria por clave. Proceso local, un usuario: evita sincronizaciones concurrentes sobre
// el mismo perfil de navegador (Chromium bloquea el perfil si se abre dos veces).
// ponytail: Set en memoria; si algún día hay multiproceso, subir a un lock por archivo/DB.

const active = new Set<string>()

export class LockBusyError extends Error {
  constructor(message = "Ya hay una sincronización en curso") {
    super(message)
    this.name = "LockBusyError"
  }
}

// Ejecuta `fn` con el lock de `key` tomado; lanza LockBusyError si ya está tomado. Libera al terminar.
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  if (active.has(key)) throw new LockBusyError()
  active.add(key)
  try {
    return await fn()
  } finally {
    active.delete(key)
  }
}

// Como withLock, pero espera a que se libere en vez de fallar. Para trabajo que nadie reintenta
// (el webhook ya respondió): tres avisos seguidos no pueden perder dos por llegar juntos.
export async function withLockWaiting<T>(
  key: string,
  fn: () => Promise<T>,
  maxWaitMs = 120_000
): Promise<T> {
  const deadline = Date.now() + maxWaitMs
  while (active.has(key)) {
    if (Date.now() > deadline) throw new LockBusyError()
    await new Promise((r) => setTimeout(r, 250))
  }
  return withLock(key, fn) // sin await entre el chequeo y la toma: nadie se cuela
}
