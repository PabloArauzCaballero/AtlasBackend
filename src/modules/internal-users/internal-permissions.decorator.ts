import { SetMetadata } from '@nestjs/common';

export const INTERNAL_PERMISSIONS_KEY = 'internal_permissions';
export const InternalPermissions = (...permissions: string[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(INTERNAL_PERMISSIONS_KEY, permissions);
