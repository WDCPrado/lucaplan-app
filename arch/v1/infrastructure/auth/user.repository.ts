// Adapter real del UserRepository sobre Prisma. Implementa el MISMO port que ya
// probamos con el mock in-memory. Intercambiable.
import { type Role } from "../../domain/authorization/authorization.domain.ts";
import { type User, type UserRepository } from "../../domain/user/user.domain.ts";
import { prisma } from "../database/prisma/client.ts";

type Row = { id: string; email: string; name: string; role: string | null; banned: boolean | null };

const toDomain = (u: Row): User => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: (u.role ?? "USER") as Role,
  banned: u.banned ?? false,
});

export const userRepository: UserRepository = {
  async findById(id) {
    const u = await prisma.user.findUnique({ where: { id } });
    return u ? toDomain(u) : null;
  },
  async setRole(id, role) {
    return toDomain(await prisma.user.update({ where: { id }, data: { role } }));
  },
  async setBanned(id, banned) {
    const u = await prisma.user.update({ where: { id }, data: { banned } });
    // Banear debe cerrar las sesiones activas; si no, el usuario sigue logueado hasta expirar.
    if (banned) await prisma.session.deleteMany({ where: { userId: id } });
    return toDomain(u);
  },
};
