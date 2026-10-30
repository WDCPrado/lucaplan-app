// Adapter Prisma de las preferencias por usuario (tabla `user_setting`, clave compuesta
// usuario + clave).
import type { UserSettingRepository } from "../../../domain/user/user-settings.domain.ts"
import { prisma } from "./client.ts"

export const userSettingRepository: UserSettingRepository = {
  async list(userId) {
    const rows = await prisma.userSetting.findMany({ where: { userId } })
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  },

  async upsert(userId, values) {
    await prisma.$transaction(
      Object.entries(values).map(([key, value]) =>
        prisma.userSetting.upsert({
          where: { userId_key: { userId, key } },
          create: { userId, key, value },
          update: { value },
        })
      )
    )
  },
}

// Deps listos para inyectar (mismo criterio que pace/push-deps).
export const userSettingsDeps = { userSettings: userSettingRepository }
