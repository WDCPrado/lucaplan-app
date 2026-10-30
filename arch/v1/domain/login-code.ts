/** Transporte del código de acceso; no genera ni valida credenciales. */
export interface LoginCodeMailer {
  send(email: string, code: string): Promise<void>
}

export const LOGIN_CODE_MINUTES = 10
