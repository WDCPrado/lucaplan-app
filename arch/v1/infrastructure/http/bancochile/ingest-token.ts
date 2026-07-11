// Token de ingesta STATELESS para el userscript/extensión: HMAC del userId con un secreto del
// servidor. No requiere tabla: el token se verifica recomputando el HMAC. La app lo genera para el
// usuario logueado y este lo pega en el userscript. Formato: base64url(userId).hmacHex.
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.BANCOCHILE_INGEST_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "lucaplan-dev-secret";
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (userId: string) => createHmac("sha256", secret()).update(userId).digest("hex");

export function makeIngestToken(userId: string): string {
  return `${b64url(userId)}.${sign(userId)}`;
}

// Devuelve el userId si el token es válido, o null. Comparación en tiempo constante.
export function verifyIngestToken(token: string | null | undefined): string | null {
  if (!token || !token.includes(".")) return null;
  const [head, mac] = token.split(".");
  let userId: string;
  try {
    userId = unb64url(head);
  } catch {
    return null;
  }
  const expected = sign(userId);
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}
