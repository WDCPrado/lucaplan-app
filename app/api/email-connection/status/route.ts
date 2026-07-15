// Estado de la conexión por correo del usuario: método activo, fase del setup, última sync,
// fecha del snapshot vigente y conteo de omitidos. Sin tokens ni contenido de correo.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import {
  connectionMethodRepository,
  emailConnectionRepository,
} from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import { isOutlookConfigured } from "@/arch/v1/infrastructure/http/outlook/outlook-oauth"

export async function GET(req: Request) {
  return withUser(req, async (userId) => {
    const [conn, activeMethod] = await Promise.all([
      emailConnectionRepository.findByUser(userId, "bancochile"),
      connectionMethodRepository.activeMethod(userId, "bancochile"),
    ])
    return {
      configured: isOutlookConfigured(),
      activeMethod,
      connection: conn
        ? {
            status: conn.status,
            emailAddress: conn.emailAddress,
            pendingSetup: !conn.bankId,
            lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
            lastBalanceReconciledAt:
              conn.lastBalanceReconciledAt?.toISOString() ?? null,
            skippedCount: conn.skippedCount,
            lastError: conn.lastError,
            webhookActive: Boolean(conn.subscriptionId),
            subscriptionExpiresAt:
              conn.subscriptionExpiresAt?.toISOString() ?? null,
          }
        : null,
    }
  })
}
