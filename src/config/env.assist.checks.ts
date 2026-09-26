/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida las combinaciones inválidas de configuración de Atlas Assist.
 */
import { z } from 'zod';
import type { RawAppEnv } from './env.schema.js';

/**
 * Atlas Assist encendido a medias no existe: o hay URL y clave, o el arranque falla aquí.
 *
 * Sin esta comprobación, `ASSIST_ENABLED=true` sin URL o sin clave arranca tan campante y el fallo
 * aparece donde menos se parece a su causa: en el teléfono de un cliente, como un asistente que
 * contesta «no está disponible» a todo, mientras el despliegue se declara sano. La variable que
 * faltaba se busca entonces desde el síntoma equivocado.
 */
export function checkAssist(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (!data.ASSIST_ENABLED) return;

  if (!data.ATLAS_AI_SERVICE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ATLAS_AI_SERVICE_URL'],
      message:
        'ASSIST_ENABLED=true exige ATLAS_AI_SERVICE_URL: sin ella el asistente de la app queda encendido y ' +
        'no alcanzable, y el error sólo se ve en el teléfono del cliente.',
    });
  }

  if (!data.ATLAS_AI_SERVICE_KEY?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ATLAS_AI_SERVICE_KEY'],
      message:
        'ASSIST_ENABLED=true exige ATLAS_AI_SERVICE_KEY (≥32 caracteres): es la clave de servidor a servidor ' +
        'con la que AtlasAIService reconoce a Core; nunca viaja a la app.',
    });
  }
}
