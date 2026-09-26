/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida las combinaciones inválidas de la entrega de eventos Core → ERP (P-14).
 */
import { z } from 'zod';
import type { RawAppEnv } from './env.schema.js';

/**
 * Entregar sin firmar no es una opción: el ERP rechaza (401) todo lo que no trae la firma y el
 * trabajo reintentaría para siempre. Y un lease más corto que dos plazos de red deja que otro
 * proceso retome una entrega que sigue en vuelo, que es exactamente un envío duplicado evitable.
 */
export function checkErpEvents(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (data.ERP_EVENTS_DELIVERY_URL && !data.ERP_EVENTS_DELIVERY_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ERP_EVENTS_DELIVERY_SECRET'],
      message: 'ERP_EVENTS_DELIVERY_URL está configurada sin ERP_EVENTS_DELIVERY_SECRET: la entrega al ERP va siempre firmada.',
    });
  }
  if (data.ERP_EVENTS_DELIVERY_LEASE_MS < data.ERP_EVENTS_DELIVERY_TIMEOUT_MS * 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ERP_EVENTS_DELIVERY_LEASE_MS'],
      message: 'ERP_EVENTS_DELIVERY_LEASE_MS debe ser al menos el doble de ERP_EVENTS_DELIVERY_TIMEOUT_MS.',
    });
  }
  if (data.ERP_EVENTS_DELIVERY_RETRY_MAX_MS < data.ERP_EVENTS_DELIVERY_RETRY_BASE_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ERP_EVENTS_DELIVERY_RETRY_MAX_MS'],
      message: 'ERP_EVENTS_DELIVERY_RETRY_MAX_MS no puede ser menor que ERP_EVENTS_DELIVERY_RETRY_BASE_MS.',
    });
  }
}
