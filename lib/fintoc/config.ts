import "server-only";

// Config de Fintoc (agregación de datos). La secret key es **server-only** (nunca al cliente); la
// public key va al widget vía NEXT_PUBLIC (inlined en build). En dev se usan test keys.
// ponytail: sin SDK Node — el adapter usa `fetch` contra la REST API.
export type FintocConfig = {
  secretKey: string;
  webhookSecret: string | null;
  baseUrl: string;
};

export function fintocConfig(): FintocConfig {
  const secretKey = process.env.FINTOC_SECRET_KEY;
  if (!secretKey) throw new Error("Falta FINTOC_SECRET_KEY (server-only). Configúrala en .env");
  return {
    secretKey,
    webhookSecret: process.env.FINTOC_WEBHOOK_SECRET ?? null,
    baseUrl: process.env.FINTOC_BASE_URL ?? "https://api.fintoc.com/v1",
  };
}

// ¿Hay config de servidor para Fintoc? (para no exponer rutas si falta la secret).
export const fintocServerEnabled = (): boolean => !!process.env.FINTOC_SECRET_KEY;

// Base pública para el `webhookUrl` del widget (Fintoc entrega ahí el link_token). Debe ser
// alcanzable desde internet (en dev, el túnel/funnel). Cae a BETTER_AUTH_URL si no se define aparte.
export function fintocWebhookBase(): string {
  const base = process.env.FINTOC_WEBHOOK_BASE ?? process.env.BETTER_AUTH_URL;
  if (!base) throw new Error("Falta FINTOC_WEBHOOK_BASE (o BETTER_AUTH_URL) para el webhookUrl del widget");
  return base.replace(/\/$/, "");
}
