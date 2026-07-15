// Persistencia del sync LOCAL (Banco de Chile) sobre el modelo por entidades. Implementa las
// operaciones que necesita `syncLocalConnection` (application), inyectando el `LocalBankConnector`.
// El dominio nunca ve Prisma; aquí se mapea Money ↔ Decimal string.
import { prisma } from "./client.ts";
import type { ImportMovement } from "../../../domain/finance/finance.domain.ts";
import { ConnectionMethodConflictError } from "../../../domain/finance/email-connection.domain.ts";
import type { LocalBankConnector } from "../../../domain/finance/local-bank-connector.port.ts";
import type { SyncLocalDeps, UnbilledInsert } from "../../../application/finance-use-cases/sync-local-connection-use-case.ts";
import { categorizePendingMovements } from "./categorize-pending.infrastructure.ts";
import { connectionMethodRepository } from "./email-connection.infrastructure.ts";

const CHUNK = 10; // ponytail: upsert de cartola en lotes acotados (no satura el pool de conexiones).

// Construye las deps de persistencia del sync local a partir de un conector ya instanciado.
export function makeSyncLocalDeps(connector: LocalBankConnector): SyncLocalDeps {
  return {
    connector,

    async upsertBank(userId, name) {
      // Exclusividad de método: si el banco está conectado por CORREO, el scraper no puede correr
      // (hay que desconectar primero). Reclama/valida la fila única (userId, banco).
      const active = await connectionMethodRepository.activeMethod(userId, "bancochile");
      if (active === "email") throw new ConnectionMethodConflictError("email");
      if (!active) await connectionMethodRepository.claim(userId, "bancochile", "scraper");
      // Un solo banco BCH por usuario (provider). lastSyncedAt se devuelve ANTES de esta sync
      // (markSynced lo actualiza al final) para calcular la ventana solapada.
      const existing = await prisma.bank.findFirst({ where: { userId, provider: "bancochile" } });
      const row = existing
        ? await prisma.bank.update({ where: { id: existing.id }, data: { name, connectionMethod: "scraper" } })
        : await prisma.bank.create({ data: { userId, name, provider: "bancochile", connectionMethod: "scraper" } });
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
              isInternal: m.isInternal ?? false,
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

    async replaceUnbilled(userId, accountId, _cardId, movements: UnbilledInsert[]) {
      // Snapshot-replace ATÓMICO: la foto previa de no-facturados de la tarjeta = sus transacciones
      // SIN id externo (las de cartola sí lo tienen). Se borra e inserta la nueva. Ahora entran como
      // `confirmed` y cuentan como gasto (salvo los pagos a la tarjeta, marcados `isInternal`).
      await prisma.$transaction(async (db) => {
        await db.transaction.deleteMany({ where: { accountId, externalId: null } });
        for (const m of movements) {
          await db.transaction.create({
            data: {
              userId,
              accountId,
              transactionDate: m.date,
              description: m.description,
              amount: m.amount.toDecimalString(),
              currency: m.amount.currency,
              direction: m.direction,
              status: "confirmed",
              pending: false,
              isInternal: m.isInternal,
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
      return categorizePendingMovements(userId);
    },
  };
}
