// Cifrado simétrico para secretos de conexiones (hoy: refresh token OAuth del correo). AES-256-GCM
// con llave derivada por HKDF de una llave maestra. La maestra es: BANCOCHILE_ENC_KEY del entorno
// (>=32 chars) si está; si no, una llave ALEATORIA generada una vez y persistida local (gitignored).
// NUNCA una constante hardcodeada. Un dump de la DB solo no basta para descifrar (la llave no vive
// en la DB). El nombre de la env y del archivo local son históricos: cambiarlos rompería el
// descifrado de los secretos ya guardados.
// ponytail: uso personal; si algún día hay servidor/multiusuario, subir a un KMS/por-usuario.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Propósito de derivación: cada tipo de secreto usa SU llave (dominio separado por HKDF info).
export const EMAIL_PURPOSE = "email-connection-v1";

function masterSecret(): string {
  const env = process.env.BANCOCHILE_ENC_KEY;
  if (env && env.length >= 32) return env;
  if (env && env.length > 0) {
    throw new Error("BANCOCHILE_ENC_KEY debe tener al menos 32 caracteres de alta entropía.");
  }
  // Sin llave explícita: genera una aleatoria y guárdala local (una vez). Cero setup manual.
  const file = process.env.BANCOCHILE_KEY_FILE ?? path.join(process.cwd(), ".bancochile-key");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const gen = randomBytes(48).toString("base64");
  writeFileSync(file, gen, { mode: 0o600 });
  return gen;
}

// Llave AES de 32 bytes derivada por HKDF (dominio separado por `purpose`, no reutiliza el secreto
// tal cual ni comparte llave entre tipos de secreto).
function key(purpose: string): Buffer {
  const salt = Buffer.alloc(0);
  return Buffer.from(hkdfSync("sha256", Buffer.from(masterSecret(), "utf8"), salt, purpose, 32));
}

// Devuelve { enc, iv } en base64. `enc` = ciphertext || authTag (16 bytes).
export function encryptSecret(plain: string, purpose: string): { enc: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: Buffer.concat([ct, tag]).toString("base64"), iv: iv.toString("base64") };
}

export function decryptSecret(enc: string, iv: string, purpose: string): string {
  const raw = Buffer.from(enc, "base64");
  const ct = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(iv, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// Verificador derivado (HMAC-SHA256, hex) para valores que deben poder RE-derivarse en vez de
// guardarse (ej. `clientState` del webhook de Graph o la firma del estado OAuth). Mismo secreto
// maestro, dominio separado por `purpose`.
export function deriveVerifier(purpose: string, data: string): string {
  return createHmac("sha256", key(`${purpose}:hmac`)).update(data, "utf8").digest("hex");
}
