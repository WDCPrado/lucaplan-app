// Persistencia del sync LOCAL (Banco de Chile) sobre el modelo por entidades. Implementa las
// operaciones que necesita `syncLocalConnection` (application), inyectando el `LocalBankConnector`.
// El dominio nunca ve Prisma; aquí se mapea Money ↔ Decimal string.
import { prisma } from "./client.ts";
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts";
import type { Direction, ImportMovement, MovementStatus, Transaction } from "../../../domain/finance/finance.domain.ts";
import type { LocalBankConnector } from "../../../domain/finance/local-bank-connector.port.ts";
import type { SyncLocalDeps, UnbilledInsert } from "../../../application/finance-use-cases/sync-local-connection-use-case.ts";
import { categorizeMovements } from "../../../application/finance-use-cases/categorize-movements-use-case.ts";
import { categoryRepository, transactionRepository } from "./finance.infrastructure.ts";
import { openaiCategorizationProvider } from "../../http/ai/openai-categorization.provider.ts";

const CHUNK = 10; // ponytail: upsert de cartola en lotes acotados (no satura el pool de conexiones).

// Construye las deps de persistencia del sync local a partir de un conector ya instanciado.
export function makeSyncLocalDeps(connector: LocalBankConnector): SyncLocalDeps {
  return {
    connector,

    async upsertBank(userId, name) {
      // Un solo banco BCH por usuario (provider). lastSyncedAt se devuelve ANTES de esta sync
      // (markSynced lo actualiza al final) para calcular la ventana solapada.
      const existing = await prisma.bank.findFirst({ where: { userId, provider: "bancochile" } });
      const row = existing
        ? await prisma.bank.update({ where: { id: existing.id }, data: { name } })
        : await prisma.bank.create({ data: { userId, name, provider: "bancochile" } });
      return { id: row.id, lastSyncedAt: existing?.lastSyncedAt ?? null };
    },

    async upsertAccount(input) {
      const existing = await prisma.financialAccount.findFirst({
        where: { userId: input.userId, externalId: input.externalId },
      });
      const data = {
        bankId: input.bankId,
        name: input.name,
        accountType: input.accountType,
        currency: input.currency,
        provider: "bancochile",
        lastSyncedAt: new Date(),
      };
      const row = existing
        ? await prisma.financialAccount.update({ where: { id: existing.id }, data })
        : await prisma.financialAccount.create({ data: { userId: input.userId, externalId: input.externalId, ...data } });
      return { id: row.id };
    },

    async upsertCard(input) {
      const existing = await prisma.card.findFirst({
        where: { accountId: input.accountId, externalId: input.externalId },
      });
      const data = { cardType: input.cardType, cardLast4: input.cardLast4, brand: input.brand, provider: "bancochile" };
      const row = existing
        ? await prisma.card.update({ where: { id: existing.id }, data })
        : await prisma.card.create({ data: { userId: input.userId, accountId: input.accountId, externalId: input.externalId, ...data } });
      return { id: row.id };
    },

    async upsertBucket(input) {
      // Sin unique en DB (cardId nullable): find-first por la clave natural.
      const existing = await prisma.balanceBucket.findFirst({
        where: { accountId: input.accountId, cardId: input.cardId, kind: input.kind, currency: input.currency },
      });
      const data = {
        limitAmount: input.limitAmount.toDecimalString(),
        used: input.used.toDecimalString(),
        available: input.available.toDecimalString(),
        asOf: input.asOf,
      };
      const row = existing
        ? await prisma.balanceBucket.update({ where: { id: existing.id }, data })
        : await prisma.balanceBucket.create({
            data: { userId: input.userId, accountId: input.accountId, cardId: input.cardId, kind: input.kind, currency: input.currency, ...data },
          });
      return { id: row.id };
    },

    async importCartola(userId, accountId, bucketId, movements: ImportMovement[]) {
      for (let i = 0; i < movements.length; i += CHUNK) {
        await Promise.all(
          movements.slice(i, i + CHUNK).map((m) => {
            const fields = {
              bucketId,
              transactionDate: m.date,
              description: m.description,
              amount: m.amount.toDecimalString(),
              currency: m.amount.currency,
              direction: m.direction,
              status: m.status,
              pending: m.status === "pending",
            };
            return prisma.transaction.upsert({
              where: { accountId_externalId: { accountId, externalId: m.externalId } },
              create: { userId, accountId, externalId: m.externalId, ...fields },
              update: fields, // categoryId intacto → categoría preservada
            });
          }),
        );
      }
      return movements.length;
    },

    async replaceUnbilled(userId, accountId, cardId, movements: UnbilledInsert[]) {
      // Snapshot-replace ATÓMICO: borra la foto previa de la tarjeta (sus buckets) e inserta la nueva.
      // Los no facturados entran como `pending` → las fórmulas los excluyen de caja/presupuesto.
      await prisma.$transaction(async (db) => {
        const buckets = await db.balanceBucket.findMany({ where: { cardId }, select: { id: true } });
        const bucketIds = buckets.map((b) => b.id);
        await db.transaction.deleteMany({ where: { bucketId: { in: bucketIds }, externalId: null } });
        for (const m of movements) {
          await db.transaction.create({
            data: {
              userId,
              accountId,
              bucketId: m.bucketId,
              transactionDate: m.date,
              description: m.description,
              amount: m.amount.toDecimalString(),
              currency: m.amount.currency,
              direction: m.direction,
              status: "pending",
              pending: true,
            },
          });
        }
      });
      return movements.length;
    },

    async setAccountBalance(accountId, amount) {
      await prisma.financialAccount.update({ where: { id: accountId }, data: { balance: amount.toDecimalString() } });
    },

    async markSynced(bankId) {
      await prisma.bank.update({ where: { id: bankId }, data: { lastSyncedAt: new Date() } });
    },

    // Categoriza con IA los movimientos confirmados sin categoría del usuario (best-effort).
    async categorize(userId) {
      const rows = await prisma.transaction.findMany({
        where: { userId, categoryId: null, status: "confirmed" },
        take: 500,
      });
      if (rows.length === 0) return 0;
      const movements: Transaction[] = rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        accountId: r.accountId,
        categoryId: null,
        date: r.transactionDate,
        description: r.description,
        amount: Money.of(r.amount.toString(), r.currency as CurrencyCode),
        direction: r.direction as Direction,
        status: (r.status ?? "confirmed") as MovementStatus,
        externalId: r.externalId ?? null,
      }));
      return categorizeMovements(
        { transactions: transactionRepository, categories: categoryRepository, categorization: openaiCategorizationProvider },
        userId,
        movements,
      );
    },
  };
}
