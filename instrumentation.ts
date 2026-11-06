// Al arrancar el servidor: si la base no tiene cuentas, genera e imprime el código de instalación
// de /setup («[setup] Código de instalación: ABCD-EFGH-JKLM»). Un fallo (base caída) no frena el
// arranque: GET /api/setup lo vuelve a intentar.
export async function register() {
  // El import va DENTRO del if: así el bundle edge no incluye el código de Node.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkSetup } = await import("./instrumentation-node")
    await checkSetup()
  }
}
