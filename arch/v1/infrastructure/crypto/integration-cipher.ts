// Cifrado de las claves de integración guardadas en app_setting: el mismo AES-256-GCM de los
// tokens de correo, con su propia llave derivada. Se guarda como «iv.enc» en un solo string.
import type { IntegrationCipher } from "../../domain/integrations/integrations.domain.ts"
import { decryptSecret, encryptSecret } from "./secret-crypto.ts"

const PURPOSE = "integration-setting-v1"

export const integrationCipher: IntegrationCipher = {
  encrypt(plain) {
    const { enc, iv } = encryptSecret(plain, PURPOSE)
    return `${iv}.${enc}`
  },
  decrypt(stored) {
    const [iv, enc] = stored.split(".")
    if (!iv || !enc) throw new Error("Valor cifrado mal formado")
    return decryptSecret(enc, iv, PURPOSE)
  },
}
