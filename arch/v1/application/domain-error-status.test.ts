// Errores de dominio que llegan por `withUser`: sin status mapeado caían en 500 y la pantalla
// mostraba «Algo salió mal» en vez de su mensaje (WDC-178).
// Corre con: node --test arch/v1/application/domain-error-status.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { domainErrorStatus } from "./domain-error-status.ts"
import { CurrencyMismatchError } from "../domain/finance/money.ts"
import { InvalidPushEndpointError } from "../domain/notifications/push.domain.ts"
import { SelfTargetError, UserNotFoundError } from "../domain/user/user.domain.ts"
import {
  BankAlreadyLinkedError,
  BankLabelRequiredError,
} from "../domain/finance/email-connection.domain.ts"
import { InvalidRecurringUrlError } from "../domain/finance/recurring.domain.ts"
import { UnknownBankError } from "./finance-use-cases/bank-email-registry.ts"

test("Cada error de dominio que llega por withUser tiene su status y deja pasar su mensaje", () => {
  const cases: [Error, number][] = [
    [new InvalidPushEndpointError(), 400],
    [new UnknownBankError("x"), 400],
    [new InvalidRecurringUrlError("Escribe un enlace válido"), 400],
    [new UserNotFoundError("u1"), 404],
    [new BankAlreadyLinkedError(), 409],
    [new SelfTargetError("banear"), 422],
    [new BankLabelRequiredError(), 422],
  ]
  for (const [error, status] of cases) assert.equal(domainErrorStatus(error), status, error.name)
  // Sale de la aritmética de Money en cualquier punto, también después de escribir: no se mapea,
  // así el plugin deja la operación incierta en vez de «rechazada sin cambios».
  assert.equal(domainErrorStatus(new CurrencyMismatchError("CLP", "USD")), null)
})

test("Un error que no es de dominio no tiene status: withUser lo oculta como 500", () => {
  assert.equal(domainErrorStatus(new Error("select * from user")), null)
})
