// Datos falsos para los entornos EFÍMEROS de PR en Railway: cada PR levanta su propia base vacía,
// y sin datos no hay review posible (no hay con qué entrar ni qué mirar). Corre solo ahí: la guarda
// exige RAILWAY_ENVIRONMENT_NAME = "pr-*", que Railway únicamente inyecta en esos entornos.
//
// Siembra el usuario base (la app en su estado normal) y, encima, un usuario POR ESCENA: cada
// archivo de scripts/seed-pr/escenas/ es dueño de su propio usuario y arma ahí el caso que su
// feature necesita para poder mirarse. Así una escena no le deforma los datos a las demás y las
// features viejas se siguen pudiendo probar.
//
// Idempotente: un usuario ya sembrado no se toca (SEED_PR_FORCE=1 lo re-siembra desde cero).
//
// Acá solo va el arranque —guardas, orden y resumen—; el recorrido de escenas vive en
// scripts/seed-pr/correr-escenas.ts, que es lo que se puede probar sin base de datos.

import { prDemoAccount, prDemoEmailDomain } from "../lib/pr-demo.ts"
// Solo el tipo: no ejecuta el módulo, que debe cargarse DESPUÉS de fijar la variable de más abajo.
import type { Escena } from "./seed-pr/sembrar-usuario.ts"
import { archivosDeEscena, correrEscenas } from "./seed-pr/correr-escenas.ts"

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

// El dominio con el que el login lista las cuentas. Sin uno usable se siembra igual —los datos
// sirven— pero ninguna cuenta aparecería en el formulario, así que se avisa fuerte.
const dominio = prDemoEmailDomain(EMAIL)
if (!dominio) {
  console.warn(
    `[seed:pr] SEED_PR_EMAIL="${EMAIL}" no tiene un dominio usable: el login no va a ofrecer ninguna cuenta.`
  )
}

// El usuario base: la app en su estado normal. Ninguna escena lo toca.
const base = await sembrarUsuario({
  email: EMAIL,
  password: PASSWORD,
  nombre: "Demo Luca",
})

// Las escenas se descubren por directorio, sin un index.ts a propósito: un archivo compartido
// devuelve el conflicto de merge que tener un archivo por escena existe para eliminar.
const escenasDir = new URL("./seed-pr/escenas/", import.meta.url)
const resumen = await correrEscenas({
  archivos: archivosDeEscena(escenasDir),
  cargar: (archivo) =>
    import(new URL(archivo, escenasDir).href) as Promise<Escena>,
  sembrar: sembrarUsuario,
  password: PASSWORD,
  dominio,
})

console.log(
  `[seed:pr] listo en "${envName}" — sembradas: ${resumen.sembradas + (base ? 1 : 0)} · ` +
    `ya estaban: ${resumen.omitidas + (base ? 0 : 1)} · fallidas: ${resumen.fallidas}. ` +
    `Contraseña común: ${PASSWORD}.`
)

process.exit(0)
