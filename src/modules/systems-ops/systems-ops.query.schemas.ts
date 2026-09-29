/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system valida los filtros de las listas de suites, corridas de suite y corridas de estrés.
 */
import { z } from 'zod';
import { queryBooleanSchema } from '../../common/pipes/query-boolean.schema.js';

/**
 * Los filtros de las listas de QA de systems-ops, separados de `systems-ops.schemas.ts` (que está
 * en la deuda congelada de tamaño) y reexportados desde allí.
 *
 * Cada filtro que se declara aquí se APLICA en el repositorio: un parámetro aceptado y no aplicado
 * es un filtro muerto, y eso es justo lo que tenía `stress-runs` con `environment` y `suiteId`.
 */
const positiveId = z.string().regex(/^[1-9][0-9]*$/);
const searchText = z.string().trim().min(1).max(120).optional();
const environment = z.enum(['LOCAL', 'STAGING', 'PRODUCTION_READONLY']).optional();
const page = z.coerce.number().int().positive().default(1);
const limit = z.coerce.number().int().positive().max(100).default(20);

export const systemsRunsQuerySchema = z.object({
  suiteId: positiveId.optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED']).optional(),
  environment,
  /** Código o nombre de la suite (contiene, sin distinguir mayúsculas), o el número exacto de la corrida. */
  q: searchText,
  page,
  limit,
});

export const systemsSuiteQuerySchema = z.object({
  module: z.string().trim().min(1).max(120).optional(),
  suiteType: z.string().trim().min(1).max(200).optional(),
  enabled: queryBooleanSchema.optional(),
  /** Código, nombre o módulo de la suite (contiene, sin distinguir mayúsculas). */
  q: searchText,
  page,
  limit,
});

/**
 * Una corrida de estrés es una fila de `system_job_runs` (`job_code = 'systems_stress_run'`): no
 * pertenece a una suite sino a un PERFIL, y su estado es el de la cola durable (`queued`, `running`,
 * `completed`, `failed`). `PASSED` se acepta como sinónimo de `COMPLETED` porque es lo que mandaba
 * el portal; `CANCELLED` no existe en esa cola y no devuelve filas.
 */
export const systemsStressRunsQuerySchema = z.object({
  profileId: positiveId.optional(),
  /** Obsoleto: alias de `profileId`. Se conserva porque el portal lo mandaba con el id del perfil. */
  suiteId: positiveId.optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PASSED', 'CANCELLED']).optional(),
  environment,
  /** Código del perfil (contiene, sin distinguir mayúsculas) o número exacto de la corrida. */
  q: searchText,
  page,
  limit,
});

export type SystemsRunsQueryDto = z.infer<typeof systemsRunsQuerySchema>;
export type SystemsSuiteQueryDto = z.infer<typeof systemsSuiteQuerySchema>;
export type SystemsStressRunsQueryDto = z.infer<typeof systemsStressRunsQuerySchema>;
