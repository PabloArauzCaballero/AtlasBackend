import { AuthenticatedUser } from '../../types/auth.types.js';

/**
 * Identificador del actor autenticado para logs/auditoría. Consolida las copias locales que
 * vivían en `systems-ops` (systems-actor.util) y `runtime-jobs`.
 *
 * OJO: hay dos variantes parecidas que NO deben unificarse con esta:
 * - `idempotency.interceptor.ts` antepone `customerId` (los clientes también generan claves
 *   de idempotencia).
 * - `external-data.controller.ts` retorna `undefined` y usa `customerId` como último fallback.
 */
export function actorId(user: AuthenticatedUser | undefined): string | null {
  return user?.internalUserId ?? user?.platformUserId ?? user?.sub ?? null;
}
