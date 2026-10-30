// Preferencias por usuario, guardadas como clave → valor (texto) en `user_setting`. Qué claves
// existen y cómo se interpretan lo decide el use-case; el port solo lee y escribe filas.
export interface UserSettingRepository {
  // Todas las claves guardadas del usuario (las que no tiene, no vienen).
  list(userId: string): Promise<Record<string, string>>
  // Crea o reemplaza cada clave del usuario, todas en una transacción.
  upsert(userId: string, values: Record<string, string>): Promise<void>
}
