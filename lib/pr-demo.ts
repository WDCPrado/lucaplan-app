// Cuenta de demostración de los entornos EFÍMEROS de PR en Railway: la siembra scripts/seed.ts y
// la muestra el formulario de login. Vive en un solo lugar para que nunca se ofrezcan credenciales
// distintas a las sembradas. Server-only: RAILWAY_ENVIRONMENT_NAME no existe en el cliente.

// Correo de la cuenta demo que siembra scripts/seed.ts (en PR, salvo SEED_PR_EMAIL).
export const DEMO_EMAIL = "demo@lucaplan.cl"

export type DemoAccount = { env: string; email: string; password: string }

// Una cuenta sembrada, tal como la ofrece el login. `titulo` es el nombre del usuario ("Demo Luca").
export type DemoUser = { email: string; titulo: string }

// Todo lo que el login del entorno de PR necesita: el entorno, la contraseña que TODAS comparten
// (varía el correo, no la clave) y las cuentas que scripts/seed.ts dejó sembradas.
export type DemoLogin = { env: string; password: string; cuentas: DemoUser[] }

// Railway nombra el entorno del PR `pr-<n>`, y cuando el proyecto tiene varios servicios lo
// prefija con el del repo: `lucaplan-app-pr-2`. Por eso se exige el sufijo, no el prefijo.
// Se exige el número a propósito: un `includes("pr")` daría true en "production" y sembraría
// datos falsos sobre la base real.
const PR_ENVIRONMENT = /(?:^|-)(pr-\d+)$/

// null en cualquier entorno que no sea un PR de Railway (producción, local, Docker Compose).
export function prDemoAccount(): DemoAccount | null {
  const match = PR_ENVIRONMENT.exec(process.env.RAILWAY_ENVIRONMENT_NAME ?? "")
  if (!match) return null
  return {
    env: match[1], // "pr-2", sin el prefijo del servicio
    email: process.env.SEED_PR_EMAIL ?? DEMO_EMAIL,
    password: process.env.SEED_PR_PASSWORD ?? "lucaplan1234",
  }
}

// Las cuentas sembradas —la base y la de cada escena— comparten el dominio del correo base. Es lo
// que le permite al login listarlas desde la base de datos sin una tabla ni una columna nuevas, y
// la regla que debe respetar el `correo` de una escena nueva.
//
// `null` si SEED_PR_EMAIL viene sin `@`, o sin nada a alguno de sus lados: de este filtro salen los
// correos que se PUBLICAN en el login, que es una página pública, y un dominio vacío haría que
// `endsWith` matcheara a TODOS los usuarios de la base. Ante la duda no se lista a nadie.
export function prDemoEmailDomain(baseEmail: string): string | null {
  const at = baseEmail.lastIndexOf("@")
  if (at <= 0 || at === baseEmail.length - 1) return null
  return baseEmail.slice(at)
}
