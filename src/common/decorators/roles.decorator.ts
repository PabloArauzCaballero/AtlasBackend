import { SetMetadata } from '@nestjs/common';
import { AtlasUserRole } from '../types/auth.types.js';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AtlasUserRole[]): ReturnType<typeof SetMetadata> => SetMetadata(ROLES_KEY, roles);
