// Destino tras entrar, igual para el código y la biometría. Devuelve un mensaje si no se puede seguir.
export function finishSignIn(data: unknown): string | null {
  // oauthProviderClient envía oauth_query; el servidor verifica la firma y devuelve el destino.
  if (
    data &&
    typeof data === "object" &&
    "url" in data &&
    typeof data.url === "string"
  ) {
    window.location.assign(data.url)
    return null
  }
  const query = new URLSearchParams(window.location.search)
  if (query.has("sig") && query.has("ba_param"))
    return "No pudimos continuar la conexión. Vuelve al asistente e inicia la conexión de nuevo."
  // Recarga el documento para aplicar tema y preferencias antes del primer pintado.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- documento nuevo intencional
  window.location.assign("/dashboard")
  return null
}
