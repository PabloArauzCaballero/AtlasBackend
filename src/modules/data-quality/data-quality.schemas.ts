/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje.
 * @system administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones.
 */
import { z } from 'zod';

export const dataQualityQuerySchema = z.object({
  /** Texto libre: tabla del registro, código de la regla o notas de la resolución (contiene, sin mayúsculas). */
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  severity: z.string().trim().min(1).max(40).optional(),
  entityType: z.string().trim().min(1).max(120).optional(),
  customerId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const dataQualityIssueParamsSchema = z.object({ issueId: z.string().regex(/^[1-9][0-9]*$/) });

/**
 * `acknowledged` («reconocida»): el problema es real y alguien se hace cargo, con motivo y notas, pero
 * el dato sigue sin corregir. La incidencia sigue PENDIENTE (cuenta en el semáforo de salida) y se
 * cierra después con `resolved` o `ignored`. Antes sólo existía por `POST /internal/alerts/:id/acknowledge`,
 * sin motivo, y dejaba la incidencia sin poder cerrarse (409).
 */
export const resolveDataQualityIssueSchema = z.object({
  resolution: z.enum(['resolved', 'ignored', 'acknowledged']),
  reasonCode: z.string().trim().min(1).max(120),
  notes: z.string().trim().min(1).max(2000),
});

export type DataQualityQueryDto = z.infer<typeof dataQualityQuerySchema>;
export type DataQualityIssueParamsDto = z.infer<typeof dataQualityIssueParamsSchema>;
export type ResolveDataQualityIssueDto = z.infer<typeof resolveDataQualityIssueSchema>;
