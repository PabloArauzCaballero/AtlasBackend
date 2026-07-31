/**
 * @file Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de decorators sin introducir reglas de un dominio específico.
 */
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint como accesible sin token.
 *
 * Hace DOS cosas con una sola declaración, y esa es toda su razón de ser:
 *
 * 1. `SetMetadata(IS_PUBLIC_KEY)` — lo que lee `JwtAuthGuard` para dejar pasar la petición.
 * 2. `ApiSecurity('')` — emite `security: []` en el contrato OpenAPI, que es la forma estándar de
 *    decir "esta operación NO requiere autenticación".
 *
 * Antes sólo hacía lo primero, y el contrato dejaba esas 11 operaciones sin ningún `security`. Un
 * consumidor no podía distinguir "es pública" de "a alguien se le olvidó documentarlo": los dos
 * casos se ven idénticos. Derivarlo del MISMO decorador que gobierna el guard es lo que garantiza
 * que el contrato no pueda mentir — si el endpoint deja de ser público, ambas cosas cambian juntas.
 */
export const Public = (): MethodDecorator & ClassDecorator => applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiSecurity(''));
