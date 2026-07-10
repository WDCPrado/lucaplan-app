// Firma/verifica el `uid` que viaja en el `webhookUrl` del widget, para asociar el Link que Fintoc
// entrega por webhook con el usuario que inició la conexión. HMAC-SHA256 con BETTER_AUTH_SECRET.
// Sin esto el webhook (endpoint de sistema) no sabría de quién es el banco conectado.
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("Falta BETTER_AUTH_SECRET para firmar el uid del webhook");
  return s;
}

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function signUid(userId: string): string {
  const payload = b64u(userId);
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

// Devuelve el userId si la firma es válida; null si falta o no verifica (tiempo constante).
export function verifyUid(token: string | null): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return unb64u(payload);
}
