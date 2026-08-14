// Catálogo de bancos soportados por correo: clave estable, nombre visible, remitentes propios y su
// parser. Los use-cases piden el parser por clave y NUNCA importan el de un banco concreto, así que
// agregar un banco es agregar una entrada aquí más su archivo de parseo.
//
// El enrutado corre ANTES del parseo: un mensaje se atribuye por remitente al banco que lo reclama.
// Eso es lo que permite que un mismo buzón alimente varios bancos sin que los correos de uno se
// cuenten como omitidos del otro.
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"
import type { ParsedEmail } from "./bank-email-map.ts"
import { parseBancoChileEmail } from "./bancochile-email-map.ts"
import { BICE_SENDER, parseBiceEmail } from "./bice-email-map.ts"
import { MACHBANK_SENDERS, parseMachbankEmail } from "./machbank-email-map.ts"

export type BankEmailDefinition = {
  key: string // identifica al banco en los datos del usuario (Bank.provider)
  name: string // nombre visible al crear el banco
  senders: string[] // remitentes exactos, en minúsculas
  parse: (msg: BankEmailMessage) => ParsedEmail
}

// Variantes de la misma institución (por ejemplo avisos de una cuenta empresa) van como remitentes
// adicionales de ESTA misma entrada: el efecto financiero es idéntico, solo cambia el buzón.
export const BANCOCHILE: BankEmailDefinition = {
  key: "bancochile",
  name: "Banco de Chile",
  senders: [
    "enviodigital@bancochile.cl",
    "serviciodetransferencias@bancochile.cl",
  ],
  parse: parseBancoChileEmail,
}

export const BICE: BankEmailDefinition = {
  key: "bice",
  name: "Banco BICE",
  senders: [BICE_SENDER],
  parse: parseBiceEmail,
}

// Solo débito: una cuenta principal CLP con su tarjeta Visa Débito. Sus correos no producen
// crédito, cuotas ni sobregiro (docs/bank-email-contract.md).
export const MACHBANK: BankEmailDefinition = {
  key: "machbank",
  name: "MACHBANK",
  senders: MACHBANK_SENDERS,
  parse: parseMachbankEmail,
}

export type BankEmailRegistry = readonly BankEmailDefinition[]

export const BANK_EMAIL_REGISTRY: BankEmailRegistry = [
  BANCOCHILE,
  BICE,
  MACHBANK,
]

// Banco de una clave. Lanza si no existe: procesar correo con un parser ajeno sería peor que fallar.
export function bankByKey(
  key: string,
  registry: BankEmailRegistry = BANK_EMAIL_REGISTRY
): BankEmailDefinition {
  const bank = registry.find((b) => b.key === key)
  if (!bank) throw new UnknownBankError(key)
  return bank
}

// ¿A qué banco pertenece este mensaje? null = a ninguno del catálogo (no se parsea).
export function routeEmail(
  msg: BankEmailMessage,
  registry: BankEmailRegistry = BANK_EMAIL_REGISTRY
): BankEmailDefinition | null {
  const from = msg.from.trim().toLowerCase()
  return registry.find((b) => b.senders.includes(from)) ?? null
}

export class UnknownBankError extends Error {
  constructor(key: string) {
    super(`Banco no soportado: ${key}`)
    this.name = "UnknownBankError"
  }
}
