import { prisma } from "../database/prisma/client.ts"
import { Prisma } from "../database/prisma/generated/client.ts"
import type {
  PluginOperation,
  PluginOperationStore,
  PluginOperationStatus,
  PluginJsonValue,
} from "../../domain/plugin/plugin.domain.ts"

const toOperation = (
  row: Awaited<ReturnType<typeof prisma.pluginOperation.findUniqueOrThrow>>
): PluginOperation => ({
  ...row,
  status: row.status as PluginOperationStatus,
  result: row.result as PluginJsonValue,
})

export const pluginOperationStore: PluginOperationStore = {
  async claim(input) {
    try {
      const operation = await prisma.pluginOperation.create({
        data: { ...input, status: "pending" },
      })
      return { claimed: true, operation: toOperation(operation) }
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error
      const { userId, clientId, operationId } = input
      const operation = await prisma.pluginOperation.findUniqueOrThrow({
        where: {
          userId_clientId_operationId: { userId, clientId, operationId },
        },
      })
      return { claimed: false, operation: toOperation(operation) }
    }
  },
  async get(key) {
    const operation = await prisma.pluginOperation.findUnique({
      where: { userId_clientId_operationId: key },
    })
    return operation ? toOperation(operation) : null
  },
  async finish(key, outcome) {
    const changed = await prisma.pluginOperation.updateMany({
      where: { ...key, status: "pending" },
      data: {
        status: outcome.status,
        result: outcome.result === null ? Prisma.JsonNull : outcome.result,
        finishedAt: new Date(),
      },
    })
    return changed.count === 1
  },
  async release(key) {
    await prisma.pluginOperation.deleteMany({
      where: { ...key, status: "pending" },
    })
  },
}
