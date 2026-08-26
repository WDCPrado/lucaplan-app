// Descubrimiento y recorrido de las escenas. Vive separado de scripts/seed-pr.ts —que es un script
// de arranque, con guardas y `process.exit`— para que esta parte, que es la que tiene la lógica que
// puede fallar, se pueda probar sin base de datos: `sembrar` y `cargar` entran por parámetro.

import { readdirSync } from "node:fs"

import type { Escena, EscenaContext } from "./sembrar-usuario.ts"

// Lo que el recorrido necesita de `sembrarUsuario`, sin arrastrar Prisma ni Better Auth al test.
export type Sembrador = (args: {
  email: string
  password: string
  nombre: string
}) => Promise<EscenaContext | null>

// Qué pasó de verdad, para que el resumen final cuente siembras y no archivos en disco.
export type Resumen = { sembradas: number; omitidas: number; fallidas: number }

/**
 * Los archivos de escena de `dir`, en orden alfabético (el nombre empieza con el ID de la tarjeta,
 * así que el orden es estable). Devuelve `[]` —en vez de tirar— si la carpeta no existe: el
 * arranque del contenedor encadena `seed:pr && next start`, así que un ENOENT acá tumbaría la app
 * entera por no tener datos de adorno.
 *
 * Los `.test.ts` quedan fuera: son tests del seed, no escenas que sembrar.
 */
export function archivosDeEscena(dir: URL | string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
      )
      .map((e) => e.name)
      .sort()
  } catch (error) {
    console.error(
      "[seed:pr] no se pudo leer la carpeta de escenas; sigo sin ellas.",
      error
    )
    return []
  }
}

/**
 * Siembra un usuario por escena y ejecuta la suya. Cada una va en su propio try/catch: una rota
 * —esquema que cambió debajo, import que revienta— no puede cancelar a las que vienen después ni
 * tumbar el arranque del contenedor.
 */
export async function correrEscenas({
  archivos,
  cargar,
  sembrar,
  password,
  dominio,
}: {
  archivos: string[]
  cargar: (archivo: string) => Promise<Escena>
  sembrar: Sembrador
  password: string
  // Dominio de los correos que el login lista; null si no hay uno usable.
  dominio: string | null
}): Promise<Resumen> {
  const resumen: Resumen = { sembradas: 0, omitidas: 0, fallidas: 0 }

  for (const archivo of archivos) {
    try {
      const escena = await cargar(archivo)
      // Un correo fuera del dominio se siembra igual, pero el login no lo lista: sin este aviso la
      // escena queda invisible y en silencio, que es la peor forma de fallar.
      if (dominio && !escena.correo.endsWith(dominio)) {
        console.warn(
          `[seed:pr] la escena ${archivo} usa "${escena.correo}", que no termina en "${dominio}": ` +
            `se siembra, pero el login NO la va a ofrecer.`
        )
      }
      const ctx = await sembrar({
        email: escena.correo,
        password,
        nombre: escena.titulo,
      })
      if (!ctx) {
        // Ya estaba sembrada y completa; no se rehace.
        resumen.omitidas++
        continue
      }
      await escena.seed(ctx)
      resumen.sembradas++
      console.log(`[seed:pr] escena lista: ${escena.titulo} — ${escena.correo}`)
    } catch (error) {
      resumen.fallidas++
      console.error(
        `[seed:pr] la escena ${archivo} falló; sigo con las demás.`,
        error
      )
    }
  }

  return resumen
}
