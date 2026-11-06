// Config de Better Auth (autenticación). Es infraestructura: implementa el authN.
// La autorización (roles → permisos) vive en el dominio (can()/authorize()); aquí el
// admin plugin solo aporta los campos role/banned al schema y reconoce ADMIN como rol
// administrador. Rol por defecto al registrarse: USER.
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { admin, jwt } from "better-auth/plugins"
import { oauthProvider } from "@better-auth/oauth-provider"
import { createAuthMiddleware, APIError } from "better-auth/api"
import { getPluginConfig } from "./plugin-config.ts"
import { pluginIssuedAt, getPluginGrant } from "./plugin-request.ts"
import { pluginConsentSchema } from "../../../../lib/schemas/plugin-auth.ts"
import { prisma } from "../database/prisma/client.ts"
import { categoryRepository } from "../database/prisma/finance.infrastructure.ts"
import { seedDefaultCategories } from "../../application/finance-use-cases/seed-default-categories-use-case.ts"
import { prDemoAccount } from "../../../../lib/pr-demo.ts"
import {
  assertLoginCodeRequest,
  createLoginCodePlugin,
  PASSWORD_DISABLED_PATHS,
} from "./login-code.ts"
import { createResendLoginCodeMailer } from "../email/resend/login-code.mailer.ts"
import { integrationDeps } from "../database/prisma/integration-deps.ts"
import { resolveIntegration } from "../../application/integration-use-cases/resolve-integration-use-case.ts"
import { isSetupVerified, promoteFirstAccount } from "../../application/setup-use-cases/setup-use-cases.ts"
import { setupTokenFrom } from "../../domain/setup/setup.domain.ts"
import { setupDeps } from "../database/prisma/setup-deps.ts"
import { firstAdminRepository } from "./user.repository.ts"

// Build sin secretos: se comprueba otra vez en cada petición OAuth, nunca al importar.
const canonical = (() => {
  try {
    return getPluginConfig()
  } catch {
    return undefined
  }
})()

export const auth = betterAuth({
  baseURL: canonical?.issuer,
  disabledPaths: [
    ...PASSWORD_DISABLED_PATHS,
    "/token",
    "/oauth2/update-consent",
    "/oauth2/delete-consent",
    "/oauth2/introspect",
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      assertLoginCodeRequest(ctx.path, ctx.body)
      if (!ctx.path.startsWith("/oauth2/")) return
      try {
        getPluginConfig()
      } catch {
        throw new APIError("SERVICE_UNAVAILABLE", {
          message: "El plugin no está configurado.",
        })
      }
      if (ctx.path === "/oauth2/userinfo") {
        const { getPluginActor } = await import("./plugin-auth.ts")
        try {
          await getPluginActor(ctx.headers ?? new Headers())
        } catch {
          throw new APIError("UNAUTHORIZED", {
            message: "Conexión no autorizada.",
          })
        }
      }
      if (ctx.path === "/oauth2/token") {
        const { preparePluginTokenGrant } =
          await import("./plugin-token-grant.ts")
        try {
          await preparePluginTokenGrant(
            ctx.headers ?? new Headers(),
            ctx.body ?? {}
          )
        } catch {
          throw new APIError("BAD_REQUEST", {
            error: "invalid_grant",
            error_description: "Conexión no autorizada.",
          })
        }
      }
      if (ctx.path === "/oauth2/revoke") {
        const { revokePluginCredential } = await import("./plugin-auth.ts")
        try {
          await revokePluginCredential(
            ctx.headers ?? new Headers(),
            ctx.body ?? {}
          )
        } catch {
          throw new APIError("UNAUTHORIZED", {
            message: "Cliente no autorizado.",
          })
        }
        return ctx.json(null)
      }
      if (
        ctx.path === "/oauth2/consent" &&
        !pluginConsentSchema.safeParse(ctx.body).success
      ) {
        throw new APIError("BAD_REQUEST", {
          message: "Solicitud de autorización inválida.",
        })
      }
    }),
  },
  appName: "Luca Plan",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Entornos efímeros de PR (Railway): el dominio es dinámico (…-pr-N.up.railway.app), así que
  // Better Auth rechazaría el login por origin desconocido. Se confía el dominio del servicio y,
  // como red, cualquier https de Railway — SOLO en PR (datos seed); producción no agrega nada.
  trustedOrigins: prDemoAccount()
    ? [
        ...(process.env.RAILWAY_PUBLIC_DOMAIN
          ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]
          : []),
        "https://*.up.railway.app",
      ]
    : [],
  emailAndPassword: { enabled: false },
  plugins: [
    createLoginCodePlugin(
      // El plugin se arma al importar; la clave se resuelve en cada envío (entorno o Ajustes).
      createResendLoginCodeMailer({
        credentials: async () => ({
          apiKey: await resolveIntegration(integrationDeps, "RESEND_API_KEY"),
          from: await resolveIntegration(integrationDeps, "RESEND_FROM"),
        }),
      }),
      process.env,
      // Base vacía: la primera cuenta solo nace con la cookie del asistente de /setup.
      {
        hasAccounts: () => setupDeps.accounts.hasAccounts(),
        isVerified: (headers) => isSetupVerified(setupDeps, setupTokenFrom(headers)),
      }
    ),
    admin({ defaultRole: "USER", adminRoles: ["ADMIN"] }),
    jwt({ jwt: { issuer: canonical?.issuer } }),
    oauthProvider({
      schema: {
        oauthClient: { modelName: "oAuthClient" },
        oauthAccessToken: { modelName: "oAuthAccessToken" },
        oauthRefreshToken: { modelName: "oAuthRefreshToken" },
        oauthConsent: { modelName: "oAuthConsent" },
      },
      loginPage: "/login",
      consentPage: "/plugin/consent",
      scopes: [
        "openid",
        "email",
        "offline_access",
        "finance:read",
        "finance:write",
      ],
      validAudiences: canonical ? [canonical.resource] : [],
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      allowPublicClientPrelogin: true,
      clientRegistrationDefaultScopes: [
        "openid",
        "email",
        "offline_access",
        "finance:read",
        "finance:write",
      ],
      accessTokenExpiresIn: 600,
      storeTokens: "hashed",
      storeClientSecret: "hashed",
      generateRefreshToken: async () => {
        const { randomBytes } = await import("node:crypto")
        return `${getPluginGrant().epoch}_${randomBytes(32).toString("base64url")}`
      },
      customAccessTokenClaims: async ({ user, scopes }) => {
        getPluginConfig()
        const grant = getPluginGrant()
        if (!user || user.id !== grant.userId)
          throw new APIError("UNAUTHORIZED", {
            message: "Conexión no autorizada.",
          })
        const { assertPluginGrantActive } =
          await import("./plugin-token-grant.ts")
        await assertPluginGrantActive(grant, scopes)
        return { plugin_issued_at_ms: grant.epoch }
      },
    }),
  ],
  // 30 días en vez de los 7 del default: Luca Plan se instala como PWA y se abre cada varios
  // días, así que a la semana sacaba al usuario. La ventana se corre sola con cada uso
  // (updateAge default: 1 día), así que usándola nunca expira.
  session: { expiresIn: 60 * 60 * 24 * 30 },
  // Cuenta nueva → categorías por defecto, si no el usuario aterriza sin nada contra qué
  // categorizar (ni él en el triage, ni la IA). Auth actúa aquí como adaptador conductor: recibe
  // un evento externo y llama a un use-case, igual que el wiring de push (push-deps.ts). Un fallo
  // NO puede tumbar el registro: se loguea y la cuenta queda creada.
  databaseHooks: {
    verification: {
      create: {
        before: async (verification) => {
          // El provider redondea createdAt a segundos. Guardamos el inicio exacto del
          // grant dentro del código opaco para que revocar también invalide códigos pendientes.
          let value
          try {
            value = JSON.parse(verification.value)
          } catch {
            return
          }
          if (value?.type !== "authorization_code") return
          return {
            data: {
              ...verification,
              value: JSON.stringify({
                ...value,
                plugin_grant_epoch_ms: pluginIssuedAt(),
              }),
            },
          }
        },
      },
    },
    user: {
      create: {
        after: async (user, ctx) => {
          // La primera cuenta de una base vacía, creada con la cookie del asistente de /setup,
          // queda ADMIN para que alguien pueda configurar las integraciones. Un fallo deja la
          // cuenta como USER (se loguea, no tumba el alta).
          try {
            const token = setupTokenFrom(ctx?.headers ?? null)
            if (await promoteFirstAccount(setupDeps, firstAdminRepository, user.id, token))
              console.info(`[first-admin] ${user.id} es la primera cuenta: queda ADMIN`)
          } catch (e) {
            console.error("[first-admin]", (e as Error).message)
          }
          try {
            await seedDefaultCategories(
              { categories: categoryRepository },
              user.id
            )
          } catch (e) {
            console.error("[seed-categories]", (e as Error).message)
          }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
