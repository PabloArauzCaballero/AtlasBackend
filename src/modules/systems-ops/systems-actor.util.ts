/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { AuthenticatedUser } from '../../common/types/auth.types.js';

export function actorId(user: AuthenticatedUser | undefined): string | null {
  return user?.internalUserId ?? user?.platformUserId ?? user?.sub ?? null;
}
