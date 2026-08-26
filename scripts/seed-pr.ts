// Datos falsos para los entornos EFÍMEROS de PR en Railway: cada PR levanta su propia base vacía,
// y sin datos no hay review posible (no hay con qué entrar ni qué mirar). Corre solo ahí: la guarda
// exige RAILWAY_ENVIRONMENT_NAME = "pr-*", que Railway únicamente inyecta en esos entornos.
//
// Siembra el usuario base (la app en su estado normal) y, encima, un usuario POR ESCENA: cada
// archivo de scripts/seed-pr/escenas/ es dueño de su propio usuario y arma ahí el caso que su
// feature necesita para poder mirarse. Así una escena no le deforma los datos a las demás y las
// features viejas se siguen pudiendo probar.
//
// Idempotente: un usuario que ya existe no se toca (SEED_PR_FORCE=1 lo re-siembra desde cero).

import { readdirSync } from "node:fs"

import { prDemoAccount } from "../lib/pr-demo.ts"
// Solo el tipo: no ejecuta el módulo, que debe cargarse DESPUÉS de fijar la variable de más abajo.
import type { Escena } from "./seed-pr/sembrar-usuario.ts"

// Misma fuente que usa el login para ofrecer las cuentas: null fuera de un entorno de PR.
const demo = prDemoAccount()
if (!demo) {
  console.log(
    `[seed:pr] omitido — RAILWAY_ENVIRONMENT_NAME="${process.env.RAILWAY_ENVIRONMENT_NAME ?? ""}" no es un entorno de PR.`
  )
  process.exit(0)
}

// El registro cerrado (landing) desactiva signUpEmail al CONSTRUIR Better Auth, así que la variable
// se fuerza antes de importarlo; de ahí que este import sea dinámico y no estático.
process.env.NEXT_PUBLIC_LANDING_ONLY = "false"
const { sembrarUsuario } = await import("./seed-pr/sembrar-usuario.ts")

const { env: envName, email: EMAIL, password: PASSWORD } = demo

// El usuario base: la app en su estado normal. Ninguna escena lo toca.
await sembrarUsuario({ email: EMAIL, password: PASSWORD, nombre: "Demo Luca" })

// Las escenas se descubren por directorio, en orden alfabético (el nombre empieza con el ID de la
// tarjeta, así que el orden es estable). Sin un index.ts a propósito: un archivo compartido devuelve
// el conflicto de merge que tener un archivo por escena existe para eliminar.
const escenasDir = new URL("./seed-pr/escenas/", import.meta.url)
const archivos = readdirSync(escenasDir)
  .filter((archivo) => archivo.endsWith(".ts"))
  .sort()

// Cada escena en su propio try/catch: el arranque del contenedor encadena `seed:pr && next start`,
// así que una escena rota —esquema que cambió debajo— tumbaría la app entera. Que falle sola: las
// demás igual se siembran y el entorno queda con todo lo que sí funciona.
for (const archivo of archivos) {
  try {
    const escena: Escena = await import(new URL(archivo, escenasDir).href)
    const ctx = await sembrarUsuario({
      email: escena.correo,
      password: PASSWORD,
      nombre: escena.titulo,
    })
    if (!ctx) continue // ya estaba sembrada; no se re-arma
    await escena.seed(ctx)
    console.log(`[seed:pr] escena lista: ${escena.titulo} — ${escena.correo}`)
  } catch (error) {
    console.error(`[seed:pr] la escena ${archivo} falló; sigo con las demás.`, error)
  }
}

console.log(
  `[seed:pr] listo en "${envName}": ${archivos.length + 1} cuentas — la base más ` +
    `${archivos.length} ${archivos.length === 1 ? "escena" : "escenas"}, todas con la contraseña ${PASSWORD}.`
)

process.exit(0)
