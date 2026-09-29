/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { z } from 'zod';

/**
 * `q` busca «contiene» en código, nombre, dominio y equipo dueño. `domain` se conserva como igualdad
 * exacta (compatibilidad) sin el `min(2)` que daba 400 con una letra.
 */
export const listCatalogsQuerySchema = z.object({
  domain: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'pending_approval', 'approved', 'published', 'retired', 'all']).optional().default('all'),
  active: z.enum(['true', 'false', 'all']).optional().default('all'),
});
export type ListCatalogsQueryDto = z.infer<typeof listCatalogsQuerySchema>;

/**
 * `q` busca «contiene» en código y nombre. `domain` sigue siendo igualdad con la familia de cada tipo
 * (compatibilidad), pero ya no exige 2 caracteres: con `min(2)` el buscador del portal, que lo
 * mandaba en cada tecla, respondía 400 con la primera letra. Sin `page`/`limit` los cuatro
 * `findAll` devolvían TODAS las definiciones de golpe.
 */
export const definitionsQuerySchema = z.object({
  type: z.enum(['observation', 'event', 'attribute', 'feature', 'all']).optional().default('all'),
  status: z.enum(['active', 'inactive', 'all']).optional().default('all'),
  domain: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type DefinitionsQueryDto = z.infer<typeof definitionsQuerySchema>;

export const GOVERNANCE_POLICY_TYPES = ['purpose', 'retention', 'classification', 'sensitive', 'quality'] as const;

/** Filtros de la lista paginada de políticas de gobierno (`GET /operations/data-governance/policies/search`). */
export const governancePolicySearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.enum(GOVERNANCE_POLICY_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type GovernancePolicySearchDto = z.infer<typeof governancePolicySearchSchema>;
