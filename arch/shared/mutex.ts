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
