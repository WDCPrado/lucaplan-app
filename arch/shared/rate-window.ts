// Límite simple por clave en una ventana deslizante, en memoria del proceso. Cada llamada borra las
// claves cuya ventana ya venció, así el Map no crece con claves que nadie vuelve a usar.
// ponytail: por proceso; con varias réplicas el techo real es `limit` × réplicas y se pierde al
// reiniciar. Si hace falta uno compartido, va a la base o a Redis.
export function createRateWindow(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return {
    /** true = cabe (y queda contado); false = pasó el límite (no se cuenta). */
    take(key: string, now = Date.now()): boolean {
      for (const [k, times] of hits) {
        const fresh = times.filter((t) => now - t < windowMs)
        if (fresh.length === 0) hits.delete(k)
        else hits.set(k, fresh)
      }
      const mine = hits.get(key) ?? []
      if (mine.length >= limit) return false
      hits.set(key, [...mine, now])
      return true
    },
    /** true = la clave ya llenó su ventana; no cuenta nada. */
    full(key: string, now = Date.now()): boolean {
      return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit
    },
    size: () => hits.size,
  }
}
