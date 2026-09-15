/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { optionalUrlEnvSchema } from './env.primitives.js';

/**
 * ATLAS Dashboards Backend: el bloque de tableros y KPI del ecosistema.
 *
 * A diferencia del motor y del ERP, este bloque **no publica manifiesto de catálogo**: lo único que
 * federa hoy es su resumen de accesos, que es lo que Flujos necesita para verificar sus flujos
 * contra ejecución real. Sin dirección o sin credencial, Flujos lo declara como bloque sin
 * evidencia y cuenta sus flujos como saltados —un hueco visible, nunca una cobertura supuesta—.
 *
 * Bloque propio y no dentro de `env.schema.ts` por el gate de tamaño de archivo, igual que el
 * bloque del motor y el del ERP.
 */
export const dashboardsEnvShape = {
  DASHBOARDS_BASE_URL: optionalUrlEnvSchema,
  /**
   * Ruta del resumen de accesos. Se parametriza porque el prefijo de su API (`api/v1`) es suyo y
   * puede cambiar sin que este repo se entere; clavarla en código convertiría un cambio de rutas
   * ajeno en un 404 que aquí se leería como «ese bloque no ha ejecutado nada».
   */
  DASHBOARDS_ACCESS_RUNS_PATH: z.string().trim().min(1).max(200).default('/api/v1/platform/access-runs'),
  DASHBOARDS_ACCESS_RUNS_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(5_000),
  /**
   * Credencial de UN SOLO propósito para esa lectura, la misma idea que en el ERP: no se comparte
   * el secreto JWT ni el token de métricas, que son de otros consumidores y con otro alcance.
   * Vacía = el bloque se reporta como NO FEDERADO con ese nombre; nunca como «sin corridas».
   */
  DASHBOARDS_CATALOG_API_KEY: z.string().optional(),
} as const;
