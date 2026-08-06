// Adapter Prisma de la frecuencia del ritmo de gasto. Vive en la tabla global `app_setting` bajo
// la clave `pace_frequency`; un valor corrupto se trata como "sin configurar".
import {
  PACE_FREQUENCIES,
  type PaceFrequency,
  type PaceFrequencyRepository,
} from "../../../domain/finance/pace.domain.ts"
import { prisma } from "./client.ts"

const KEY = "pace_frequency"

export const paceFrequencyRepository: PaceFrequencyRepository = {
  async get(): Promise<PaceFrequency | null> {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
    return (PACE_FREQUENCIES as readonly string[]).includes(row?.value ?? "")
      ? (row!.value as PaceFrequency)
      : null
  },

  async set(frequency: PaceFrequency): Promise<void> {
    await prisma.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: frequency },
      update: { value: frequency },
    })
  },
}

// Deps listos para inyectar (mismo criterio que push-deps).
export const paceDeps = { paceFrequency: paceFrequencyRepository }
