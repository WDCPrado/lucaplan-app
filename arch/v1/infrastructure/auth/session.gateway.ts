// Adapter del SessionPort: traduce la sesión de Better Auth al Actor del dominio.
import { type Actor, type Role, type SessionPort } from "../../domain/authorization/authorization.domain.ts";
import { auth } from "./auth.ts";

export const sessionGateway: SessionPort = {
  async getActor(headers) {
    const session = await auth.api.getSession({ headers });
    if (!session) return null;
    return { userId: session.user.id, role: (session.user.role ?? "USER") as Role };
  },
};
