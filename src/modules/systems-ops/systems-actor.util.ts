import { AuthenticatedUser } from '../../common/types/auth.types.js';

export function actorId(user: AuthenticatedUser | undefined): string | null {
  return user?.internalUserId ?? user?.platformUserId ?? user?.sub ?? null;
}
