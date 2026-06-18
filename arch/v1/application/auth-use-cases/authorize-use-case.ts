import {
  type Action,
  type Actor,
  type Resource,
  can,
  ForbiddenError,
  UnauthenticatedError,
} from "../../domain/authorization/authorization.domain.ts";

// Guard reusable por los use-cases de cada feature: exige actor autenticado y
// autorizado para la acción. Devuelve el actor para encadenar (ej. validar ownership).
export function authorize<R extends Resource>(
  actor: Actor | null,
  resource: R,
  action: Action<R>,
): Actor {
  if (!actor) throw new UnauthenticatedError();
  if (!can(actor.role, resource, action)) throw new ForbiddenError(resource, action);
  return actor;
}
