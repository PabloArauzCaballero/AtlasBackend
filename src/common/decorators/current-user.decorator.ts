/**
 * @file Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de decorators sin introducir reglas de un dominio específico.
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, RequestWithAuth } from '../types/auth.types.js';

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
  const request = context.switchToHttp().getRequest<RequestWithAuth>();
  return request.user;
});
