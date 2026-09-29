/**
 * @file Esquema de consulta del informe de tráfico y latencia por ruta.
 * @business Esta pieza hace que la tabla de rutas del panel de Sistemas se pueda buscar, filtrar y recorrer entera.
 * @system valida ventana, buscador, método y página; lo no declarado aquí Zod lo descartaría en silencio.
 */
import { z } from 'zod';

export const TRAFFIC_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export const trafficLatencyQuerySchema = z.object({
  windowHours: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(24),
  q: z.string().trim().min(1).max(160).optional(),
  method: z.enum(TRAFFIC_HTTP_METHODS).optional(),
  page: z.coerce.number().int().positive().default(1),
  /** Sin `limit` se enseñan las rutas con más peticiones (el corte de siempre). */
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type TrafficLatencyQueryDto = z.infer<typeof trafficLatencyQuerySchema>;
