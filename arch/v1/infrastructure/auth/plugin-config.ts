// Nunca se obtiene la identidad del servidor desde Host/X-Forwarded-Host de una petición.
export function getPluginConfig() {
  const configured = process.env.BETTER_AUTH_URL
  if (
    !configured ||
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32
  ) {
    throw new Error(
      "Configura BETTER_AUTH_URL y BETTER_AUTH_SECRET para conectar el plugin."
    )
  }
  const url = new URL(configured)
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/api/auth", "/api/auth/"].includes(url.pathname) ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        local &&
        process.env.NODE_ENV !== "production"
      ))
  )
    throw new Error("BETTER_AUTH_URL debe ser una URL canónica HTTPS.")
  return {
    origin: url.origin,
    issuer: `${url.origin}/api/auth`,
    resource: `${url.origin}/api/mcp`,
    resourceMetadata: `${url.origin}/.well-known/oauth-protected-resource/api/mcp`,
  }
}

export const getPluginResourceUrl = () => getPluginConfig().resource
export const getPluginIssuerUrl = () => getPluginConfig().issuer
