/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { optionalUrlEnvSchema } from './env.primitives.js';

/**
 * ATLAS ERP Backend: el servicio de administración, inventario y facturación del ecosistema.
 *
 * Este backend no consume su API —hoy son dos productos con bases separadas—, pero sí necesita
 * saber DÓNDE vive para poder responder por su salud. Sin esa dirección, el panel de sistemas del
 * portal interno no puede distinguir «el ERP está caído» de «nadie configuró dónde buscarlo», y
 * ambas cosas se ven igual: un hueco. Vacío = la herramienta se reporta como NO CONFIGURADA, que
 * es una respuesta honesta; nunca como sana.
 *
 * Bloque propio y no dentro de `env.schema.ts` por el gate de tamaño de archivo, igual que el
 * bloque del motor de decisión.
 */
export const erpEnvShape = {
  ERP_BACKEND_BASE_URL: optionalUrlEnvSchema,
  /**
   * Ruta del healthcheck del ERP. Se parametriza porque el prefijo de su API (`api/v1`) es suyo y
   * puede cambiar sin que este repo se entere; clavarla en código convertiría un cambio de rutas
   * ajeno en un falso «ERP caído» aquí.
   */
  ERP_BACKEND_HEALTH_PATH: z.string().trim().min(1).max(200).default('/api/v1/health'),
  ERP_BACKEND_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(5_000),
};
