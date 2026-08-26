// Cuenta de demostración de los entornos EFÍMEROS de PR en Railway: la siembra scripts/seed-pr.ts y
// la muestra el formulario de login. Vive en un solo lugar para que nunca se ofrezcan credenciales
// distintas a las sembradas. Server-only: RAILWAY_ENVIRONMENT_NAME no existe en el cliente.

export type DemoAccount = { env: string; email: string; password: string }

// Una cuenta sembrada, tal como la ofrece el login. `titulo` es el nombre del usuario: "Demo Luca"
// en la cuenta base y el título de la escena ("WDC-74 — mes anterior sobregirado") en las demás.
export type DemoUser = { email: string; titulo: string }

// Todo lo que el login del entorno de PR necesita: el entorno, la contraseña que TODAS comparten
// (varía el correo, no la clave) y las cuentas que scripts/seed-pr.ts dejó sembradas.
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
    email: process.env.SEED_PR_EMAIL ?? "demo@lucaplan.cl",
    password: process.env.SEED_PR_PASSWORD ?? "lucaplan1234",
  }
}

// Las cuentas sembradas —la base y la de cada escena— comparten el dominio del correo base. Es lo
// que le permite al login listarlas desde la base de datos sin una tabla ni una columna nuevas, y
// la regla que debe respetar el `correo` de una escena nueva.
export function prDemoEmailDomain(baseEmail: string): string {
  return baseEmail.slice(baseEmail.indexOf("@"))
}
