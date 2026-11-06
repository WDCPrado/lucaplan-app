// Adapter Prisma de las claves de integración (WDC-181). Viven en la tabla global `app_setting`
// con el prefijo `integration:` para no chocar con las otras preferencias (`due_days`, …). El
// valor llega ya cifrado si es secreto: este adapter no sabe de secretos.
import type { IntegrationSettingsRepository } from "../../../domain/integrations/integrations.domain.ts"
import { integrationKey } from "../../../../../lib/integration-settings-schemas.ts"
import { prisma } from "./client.ts"

const PREFIX = "integration:"

export const integrationSettingsRepository: IntegrationSettingsRepository = {
  async list() {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } })
    return rows.flatMap((r) => {
      const key = integrationKey.safeParse(r.key.slice(PREFIX.length))
      return key.success ? [{ key: key.data, value: r.value, updatedAt: r.updatedAt }] : []
    })
  },
  async save(key, value) {
    await prisma.appSetting.upsert({
      where: { key: PREFIX + key },
      create: { key: PREFIX + key, value },
      update: { value },
    })
  },
  async remove(key) {
    await prisma.appSetting.deleteMany({ where: { key: PREFIX + key } })
  },
}
