// Adapter Prisma del repositorio de suscripciones Web Push.
import type {
  PushSubscription,
  PushSubscriptionRepository,
} from "../../../domain/notifications/push.domain.ts"
import { prisma } from "./client.ts"

export const pushSubscriptionRepository: PushSubscriptionRepository = {
  // Upsert por endpoint: el navegador puede renovar las claves del mismo dispositivo, y un
  // endpoint solo pertenece a un usuario (el último que lo registró en este navegador).
  async save(sub: PushSubscription): Promise<void> {
    const data = {
      userId: sub.userId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    }
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { endpoint: sub.endpoint, ...data },
      update: data,
    })
  },

  async deleteByEndpoint(endpoint: string, userId?: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, ...(userId ? { userId } : {}) },
    })
  },

  async listByUser(userId: string): Promise<PushSubscription[]> {
    const rows = await prisma.pushSubscription.findMany({ where: { userId } })
    return rows.map((r) => ({
      userId: r.userId,
      endpoint: r.endpoint,
      keys: { p256dh: r.p256dh, auth: r.auth },
    }))
  },
}
