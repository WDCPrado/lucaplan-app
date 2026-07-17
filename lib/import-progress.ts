// Lógica PURA del progreso de la importación inicial (sin React). Los pasos 0 y 1 avanzan por
// tiempo (dwell mínimo, para que no parpadeen aunque la petición responda al instante); el paso 2
// ("categorizando") se QUEDA hasta que la petición responde, y sólo entonces pasa al 3 ("listo").
// Así la animación nunca declara "listo" antes de que el backend termine de verdad.

export const IMPORT_STEPS = [
  {
    title: "Revisando tu correo",
    detail: "Leemos 2 meses de notificaciones de Banco de Chile",
  },
  {
    title: "Importando movimientos",
    detail: "Vinculamos cada movimiento a tus cuentas y tarjetas",
  },
  {
    title: "Categorizando con IA",
    detail: "Clasificamos tus gastos automáticamente",
  },
  { title: "Listo", detail: "Tu banco quedó conectado" },
] as const

// Dwell mínimo (ms) de los pasos 0 y 1. El 2 no tiene dwell fijo: espera la respuesta.
export const IMPORT_STEP_DWELL_MS = [1200, 1500] as const

// Índice del paso actual [0..3] según el tiempo transcurrido y si la petición ya respondió.
export function importStep(elapsedMs: number, resolved: boolean): number {
  const afterStep0 = IMPORT_STEP_DWELL_MS[0]
  const afterStep1 = afterStep0 + IMPORT_STEP_DWELL_MS[1]
  if (elapsedMs < afterStep0) return 0
  if (elapsedMs < afterStep1) return 1
  if (!resolved) return 2 // categorizando: se queda hasta que responda
  return 3 // listo
}
