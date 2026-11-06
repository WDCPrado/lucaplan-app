// Al arrancar el servidor: si la base no tiene cuentas, genera e imprime el código de instalación
// de /setup («[setup] Código de instalación: ABCD-1234»). Un fallo (base caída) no frena el
// arranque: GET /api/setup lo vuelve a intentar.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  try {
    const { ensureSetupCode } = await import("./arch/v1/application/setup-use-cases/setup-use-cases.ts")
    const { setupDeps } = await import("./arch/v1/infrastructure/database/prisma/setup-deps.ts")
    await ensureSetupCode(setupDeps)
  } catch (e) {
    console.error("[setup] No se pudo revisar la instalación:", (e as Error).message)
  }
}
