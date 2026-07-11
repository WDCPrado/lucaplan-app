// Cifrado simétrico para secretos locales (clave del banco). AES-256-GCM con llave derivada por HKDF
// de una llave maestra. La maestra es: BANCOCHILE_ENC_KEY del entorno (>=32 chars) si está; si no,
// una llave ALEATORIA generada una vez y persistida local (gitignored). NUNCA una constante
// hardcodeada. Un dump de la DB solo no basta para descifrar (la llave no vive en la DB).
// ponytail: uso personal/local; si algún día hay servidor/multiusuario, subir a un KMS/por-usuario.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

// Llave AES de 32 bytes derivada por HKDF (dominio separado, no reutiliza el secreto tal cual).
function key(): Buffer {
  const salt = Buffer.alloc(0);
  return Buffer.from(hkdfSync("sha256", Buffer.from(masterSecret(), "utf8"), salt, "bancochile-cred-v1", 32));
}

// Devuelve { enc, iv } en base64. `enc` = ciphertext || authTag (16 bytes).
export function encryptSecret(plain: string): { enc: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: Buffer.concat([ct, tag]).toString("base64"), iv: iv.toString("base64") };
}

export function decryptSecret(enc: string, iv: string): string {
  const raw = Buffer.from(enc, "base64");
  const ct = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
