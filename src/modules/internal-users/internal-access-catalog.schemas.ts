/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { z } from 'zod';

export const internalRoleParamsSchema = z.object({
  roleId: z.string().regex(/^[1-9][0-9]*$/),
});

export type InternalRoleParamsDto = z.infer<typeof internalRoleParamsSchema>;
