// Cuenta de demostración de los entornos EFÍMEROS de PR en Railway: la siembra scripts/seed-pr.ts y
// la muestra el formulario de login. Vive en un solo lugar para que nunca se ofrezcan credenciales
// distintas a las sembradas. Server-only: RAILWAY_ENVIRONMENT_NAME no existe en el cliente.

export type DemoAccount = { env: string; email: string; password: string }

// null en cualquier entorno que no sea un PR de Railway (producción, local, Docker Compose).
export function prDemoAccount(): DemoAccount | null {
  const env = process.env.RAILWAY_ENVIRONMENT_NAME ?? ""
  if (!env.startsWith("pr-")) return null
  return {
    env,
    email: process.env.SEED_PR_EMAIL ?? "demo@lucaplan.cl",
    password: process.env.SEED_PR_PASSWORD ?? "lucaplan1234",
  }
}
