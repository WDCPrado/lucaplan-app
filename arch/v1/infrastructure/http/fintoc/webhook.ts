// Verificación de firma del webhook de Fintoc. Fintoc firma con HMAC-SHA256 sobre `${t}.${body}`
// y manda el header `Fintoc-Signature: t=<ts>,v1=<hmac hex>` (patrón tipo Stripe). Comparación en
// tiempo constante. Si no hay secret configurado, se rechaza (fail-closed).
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyFintocSignature(rawBody: string, signatureHeader: string | null, secret: string | null): boolean {
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
