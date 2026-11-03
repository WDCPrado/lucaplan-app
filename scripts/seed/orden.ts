// Qué siembra el seed y en qué orden. Las carpetas se recorren por estas listas, no por el disco:
// un archivo que no está acá es un error (se agregó y se olvidó declararlo, o sobró uno viejo).
//
// produccion/: lo que debe existir en todo entorno (catálogos fijos), con upsert que no pisa y sin
//   borrar. Hoy está vacío: las categorías por defecto se crean al registrarse cada usuario.
// demo/: la cuenta demo, solo fuera de producción y siempre después de producción. Áreas en orden
//   de dependencia (la base primero, los casos por dominio después); archivos sin números,
//   nombrados por lo que crean.
import { existsSync, readdirSync } from "node:fs"

export const PRODUCCION: string[] = []

export const DEMO: [area: string, archivos: string[]][] = [
  ["1-base", ["cuenta-demo.ts"]],
  ["2-casos", ["presupuesto.ts", "recurrentes.ts", "cuentas.ts", "cuotas.ts", "conciliacion.ts", "correo.ts", "plugin.ts"]],
]

/** Archivos `.ts` (sin tests) de `dir` que no están en `lista`, y los de `lista` que faltan. */
export function desajustes(dir: URL, lista: string[]): string[] {
  const enDisco = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    : []
  return [
    ...enDisco.filter((f) => !lista.includes(f)).map((f) => `sobra ${f}`),
    ...lista.filter((f) => !enDisco.includes(f)).map((f) => `falta ${f}`),
  ]
}

/** Todos los desajustes del seed; vacío = el disco coincide con las listas. */
export function desajustesDelSeed(raiz = new URL("./", import.meta.url)): string[] {
  const areas = new URL("demo/", raiz)
  const declaradas = DEMO.map(([area]) => area)
  const enDisco = existsSync(areas) ? readdirSync(areas).filter((a) => !a.includes(".")) : []
  return [
    ...desajustes(new URL("produccion/", raiz), PRODUCCION).map((d) => `produccion: ${d}`),
    ...enDisco.filter((a) => !declaradas.includes(a)).map((a) => `demo: sobra el área ${a}`),
    ...DEMO.flatMap(([area, archivos]) => desajustes(new URL(`${area}/`, areas), archivos).map((d) => `demo/${area}: ${d}`)),
  ]
}
