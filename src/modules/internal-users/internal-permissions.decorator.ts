/**
 * @file Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { SetMetadata } from '@nestjs/common';

export const INTERNAL_PERMISSIONS_KEY = 'internal_permissions';
export const InternalPermissions = (...permissions: string[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(INTERNAL_PERMISSIONS_KEY, permissions);
