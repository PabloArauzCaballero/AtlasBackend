/**
 * @file Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de decorators sin introducir reglas de un dominio específico.
 */
import { SetMetadata } from '@nestjs/common';
import { AtlasUserRole } from '../types/auth.types.js';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AtlasUserRole[]): ReturnType<typeof SetMetadata> => SetMetadata(ROLES_KEY, roles);
