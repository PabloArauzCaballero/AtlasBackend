/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida las combinaciones inválidas de configuración del motor de decisión.
 */
import { z } from 'zod';
import type { RawAppEnv } from './env.schema.js';

/**
 * Integración con el motor de decisión: o está completa o no está.
 *
 * Una URL sin llave deja el motor configurado y no alcanzable, y la diferencia sólo se nota en
 * producción, en la primera solicitud de crédito: la llamada falla, el caso cae a revisión manual y
 * nadie relaciona la cola de casos con una variable que faltaba.
 *
 * La sal del sujeto se exige por una razón distinta y bastante peor de arreglar. Sin ella cada
 * despliegue derivaría un identificador distinto para el mismo cliente, y su historia dentro del
 * motor quedaría partida en trozos que ya no se pueden volver a unir. No es un fallo que se detecte
 * mirando una pantalla: se descubre al recalibrar, cuando la población de un cliente recurrente
 * aparece como decenas de sujetos que decidieron una vez.
 */
export function checkDecisionEngine(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (!data.DECISION_ENGINE_BASE_URL) return;

  if (!data.DECISION_ENGINE_API_KEY?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DECISION_ENGINE_API_KEY'],
      message:
        'DECISION_ENGINE_BASE_URL está configurada pero falta su credencial de ejecución. El motor autentica con ' +
        '`x-api-key` sobre la audiencia `runtime` (rol DECISION_RUNTIME).',
    });
  }

  if (!data.DECISION_ENGINE_SUBJECT_SALT?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DECISION_ENGINE_SUBJECT_SALT'],
      message:
        'La integración con el motor exige DECISION_ENGINE_SUBJECT_SALT: es lo que hace que el mismo cliente sea el ' +
        'mismo sujeto entre decisiones. Sin ella su historial en el motor queda partido y no se puede recomponer.',
    });
  }

  if (data.NODE_ENV === 'production' && !data.DECISION_ENGINE_OUTCOME_API_KEY?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DECISION_ENGINE_OUTCOME_API_KEY'],
      message:
        'Producción necesita la credencial del plano de gestión (rol OPERATIONS) para cargar desenlaces. Sin ella el ' +
        'motor decide pero nunca llega a saber si acertó, y el desenlace de una cosecha no se reconstruye después.',
    });
  }
}
