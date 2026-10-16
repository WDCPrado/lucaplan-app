// Editar y eliminar una cuenta MANUAL. Eliminar va en dos pasos: la previsualización calcula el
// impacto y entrega un token firmado sobre el hash de ese estado; la eliminación lo exige y vuelve
// a comprobarlo dentro de la misma transacción que borra. Si algo cambió entre los dos pasos (un
// movimiento nuevo, un vínculo distinto) el token deja de calzar y no se borra nada.
import {
  accountHasCard,
  AccountNotFoundError,
  CardLast4RequiredError,
  ConnectedAccountReadOnlyError,
  NotOwnerError,
  type AccountRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  accountDeletionImpact,
  InvalidManualAccountError,
  StaleAccountDeletionError,
  type AccountDeletionImpact,
  type ManualAccountRepository,
  type ManualAccountSnapshot,
} from "../../domain/finance/manual-account.domain.ts"
import { canonicalJson } from "../../../shared/canonical-json.ts"

// La confirmación vale para una conversación, no para siempre.
export const DELETION_TOKEN_TTL_MS = 15 * 60 * 1000

type DeletionDeps = {
  manualAccounts: ManualAccountRepository
  hash(input: string): string
  // Firma con un secreto del servidor: el token no se puede fabricar desde el chat.
  sign(input: string): string
  now?: () => Date
}

export async function updateManualAccount(
  deps: { accounts: AccountRepository; manualAccounts: ManualAccountRepository },
  userId: string,
  input: {
    accountId: string
    name: string
    color: string | null
    cardLast4: string | null
    overdraftLimit?: number
  }
) {
  const account = await deps.accounts.findById(input.accountId)
  if (!account) throw new AccountNotFoundError(input.accountId)
  if (account.userId !== userId) throw new NotOwnerError()
  if (account.provider !== "manual") throw new ConnectedAccountReadOnlyError()
  const name = input.name.trim()
  if (!name) throw new InvalidManualAccountError("La cuenta necesita un nombre")
  const digits = (input.cardLast4 ?? "").replace(/\D/g, "")
  const cardLast4 = accountHasCard(account.accountType)
    ? digits.length >= 4
      ? digits.slice(-4)
      : null
    : null
  if (accountHasCard(account.accountType) && !cardLast4)
    throw new CardLast4RequiredError()
  const overdraftLimit = input.overdraftLimit ?? account.overdraftLimit.toMajor()
  if (!Number.isFinite(overdraftLimit) || overdraftLimit < 0)
    throw new InvalidManualAccountError("La línea de sobregiro debe ser un monto ≥ 0")
  if (overdraftLimit > 0 && account.accountType !== "checking")
    throw new InvalidManualAccountError(
      "Solo una cuenta corriente (checking) tiene línea de sobregiro"
    )
  await deps.manualAccounts.update(account.id, {
    name,
    color: input.color,
    cardLast4,
    overdraftLimit,
  })
  return {
    id: account.id,
    name,
    color: input.color,
    cardLast4,
    overdraftLimit: { amount: overdraftLimit, currency: account.currency },
  }
}

function payload(userId: string, accountId: string, stateHash: string, issuedAt: number) {
  return `account-delete:v1:${userId}:${accountId}:${stateHash}:${issuedAt}`
}

function assertDeletable(
  snapshot: ManualAccountSnapshot | null
): asserts snapshot is ManualAccountSnapshot {
  if (!snapshot) throw new NotOwnerError()
  // Nunca un banco ni una cuenta conectada: su baja es desconectar el correo.
  if (snapshot.account.provider !== "manual") throw new ConnectedAccountReadOnlyError()
}

/** Paso 1: impacto de borrar la cuenta y el token que liga la confirmación a este estado. */
export async function previewManualAccountDeletion(
  deps: DeletionDeps,
  userId: string,
  accountId: string
): Promise<{
  impact: AccountDeletionImpact
  confirmationToken: string
  expiresAt: string
}> {
  const snapshot = await deps.manualAccounts.snapshot(userId, accountId)
  assertDeletable(snapshot)
  const issuedAt = (deps.now?.() ?? new Date()).getTime()
  const stateHash = deps.hash(canonicalJson(snapshot))
  return {
    impact: accountDeletionImpact(snapshot),
    confirmationToken: `v1.${issuedAt}.${deps.sign(payload(userId, accountId, stateHash, issuedAt))}`,
    expiresAt: new Date(issuedAt + DELETION_TOKEN_TTL_MS).toISOString(),
  }
}

/** Paso 2: borra solo si el token es de esta cuenta, no venció y el estado sigue idéntico. */
export async function deleteManualAccount(
  deps: DeletionDeps,
  userId: string,
  input: { accountId: string; confirmationToken: string }
): Promise<{ deleted: true; impact: AccountDeletionImpact }> {
  const [version, issuedText, signature] = input.confirmationToken.split(".")
  const issuedAt = Number(issuedText)
  const now = (deps.now?.() ?? new Date()).getTime()
  if (
    version !== "v1" ||
    !signature ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now ||
    now - issuedAt > DELETION_TOKEN_TTL_MS
  )
    throw new StaleAccountDeletionError()
  const impact = await deps.manualAccounts.deleteChecked(userId, input.accountId, (snapshot) => {
    assertDeletable(snapshot)
    const stateHash = deps.hash(canonicalJson(snapshot))
    if (deps.sign(payload(userId, input.accountId, stateHash, issuedAt)) !== signature)
      throw new StaleAccountDeletionError()
    return accountDeletionImpact(snapshot)
  })
  return { deleted: true, impact }
}
