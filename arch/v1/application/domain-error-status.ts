// Clasifica los errores de negocio por su status HTTP. Es la única lista: la usan los Route
// Handlers (finance-http) y el plugin MCP, que con ella distingue un rechazo de regla (el caso de
// uso validó y no escribió) de una falla inesperada. `null` = error desconocido.
import { ZodError } from "zod"
import { InvalidPushEndpointError } from "../domain/notifications/push.domain.ts"
import { SelfTargetError, UserNotFoundError } from "../domain/user/user.domain.ts"
import { UnknownBankError } from "./finance-use-cases/bank-email-registry.ts"
import {
  NotOwnerError,
  AccountNotFoundError,
  CategoryInUseError,
  CategoryNotFoundError,
  InvalidMonthlyBudgetError,
  TransactionCurrencyMismatchError,
  CardLast4RequiredError,
  ConnectedAccountReadOnlyError,
  BankConnectionError,
  WebhookSignatureError,
} from "../domain/finance/finance.domain.ts"
import {
  BankAlreadyLinkedError,
  BankLabelRequiredError,
  ConnectionMethodConflictError,
  EmailConnectionNotFoundError,
  EmailReauthRequiredError,
  EmailSetupStateError,
  OAuthStateError,
} from "../domain/finance/email-connection.domain.ts"
import {
  InvalidIncomeError,
  IncomeNotFoundError,
} from "../domain/finance/income.domain.ts"
import { InvalidPaceFrequencyError } from "../domain/finance/pace.domain.ts"
import { InvalidBudgetPeriodError } from "../domain/finance/budget-period.domain.ts"
import { BalanceScanError } from "../domain/finance/balance-scan.domain.ts"
import {
  InvalidRecurringTemplateError,
  InvalidRecurringUrlError,
  RecurringCategoryRequiredError,
  RecurringPeriodBankPaidError,
  RecurringPeriodNotManualError,
  RecurringTemplateEndedError,
  RecurringTemplateNotFoundError,
} from "../domain/finance/recurring.domain.ts"
import {
  InstallmentAccountMismatchError,
  InstallmentAmountReadOnlyError,
  InstallmentCategoryRequiredError,
  InstallmentItemAlreadySettledError,
  InstallmentPlanNotFoundError,
  InstallmentSplitMismatchError,
  InvalidInstallmentPlanError,
} from "../domain/finance/installment.domain.ts"
import {
  InvalidManualAccountError,
  StaleAccountDeletionError,
} from "../domain/finance/manual-account.domain.ts"
import {
  DuplicateBudgetAlertError,
  InvalidBudgetAlertError,
} from "../domain/notifications/budget-alert.domain.ts"
import { InvalidDueDaysError } from "../domain/notifications/due-reminder.domain.ts"
import { LockBusyError } from "../../shared/mutex.ts"
import {
  AmbiguousCategoryNameError,
  OnboardingCompletedError,
} from "../domain/onboarding/onboarding.domain.ts"

export function domainErrorStatus(e: unknown): number | null {
  if (e instanceof ZodError) return 422
  if (e instanceof WebhookSignatureError || e instanceof OAuthStateError)
    return 401
  if (
    e instanceof InvalidPushEndpointError || // el cliente propuso un endpoint ajeno
    e instanceof UnknownBankError || // clave de banco que no existe en el catálogo
    e instanceof InvalidRecurringUrlError // enlace del portal mal escrito
  )
    return 400
  if (
    e instanceof LockBusyError || // sync ya en curso
    e instanceof ConnectionMethodConflictError || // otro método de conexión activo
    e instanceof DuplicateBudgetAlertError || // ya existe una alerta a ese %
    e instanceof RecurringPeriodBankPaidError || // el período ya lo cobró el banco
    e instanceof StaleAccountDeletionError || // la cuenta cambió desde la previsualización
    e instanceof BankAlreadyLinkedError || // ese banco ya está en este correo
    e instanceof OnboardingCompletedError // el onboarding ya terminó
  )
    return 409
  if (
    e instanceof InvalidBudgetAlertError ||
    e instanceof InvalidDueDaysError ||
    e instanceof InvalidPaceFrequencyError ||
    e instanceof InvalidBudgetPeriodError ||
    e instanceof TransactionCurrencyMismatchError ||
    e instanceof CategoryInUseError ||
    e instanceof CardLast4RequiredError ||
    e instanceof ConnectedAccountReadOnlyError ||
    e instanceof BankConnectionError ||
    e instanceof InvalidMonthlyBudgetError ||
    e instanceof InvalidIncomeError ||
    e instanceof InvalidRecurringTemplateError ||
    e instanceof RecurringCategoryRequiredError ||
    e instanceof RecurringPeriodNotManualError ||
    e instanceof RecurringTemplateEndedError ||
    e instanceof InvalidInstallmentPlanError ||
    e instanceof InstallmentAccountMismatchError ||
    e instanceof InstallmentSplitMismatchError ||
    e instanceof InstallmentItemAlreadySettledError ||
    e instanceof InstallmentCategoryRequiredError ||
    e instanceof InstallmentAmountReadOnlyError ||
    e instanceof InvalidManualAccountError ||
    e instanceof EmailReauthRequiredError ||
    e instanceof EmailSetupStateError ||
    e instanceof BalanceScanError ||
    e instanceof BankLabelRequiredError ||
    e instanceof SelfTargetError ||
    e instanceof AmbiguousCategoryNameError
  )
    return 422
  if (
    e instanceof NotOwnerError ||
    e instanceof AccountNotFoundError ||
    e instanceof CategoryNotFoundError ||
    e instanceof IncomeNotFoundError ||
    e instanceof RecurringTemplateNotFoundError ||
    e instanceof InstallmentPlanNotFoundError ||
    e instanceof EmailConnectionNotFoundError ||
    e instanceof UserNotFoundError
  )
    return 404
  return null
}
