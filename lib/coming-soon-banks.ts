// Bancos que todavía no tienen adaptador de correo. Los que sí tienen viven en
// arch/v1/application/finance-use-cases/bank-email-registry.ts. Una sola lista para la conexión de
// la app (outlook-bank-connection.tsx) y la landing.
export const COMING_SOON_BANKS = [
  "Santander",
  "BCI",
  "Banco Estado",
  "Itaú",
  "Banco Falabella",
  "Scotiabank",
] as const
