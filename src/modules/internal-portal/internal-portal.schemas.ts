/**
 * @file Esquemas Zod: contrato de entrada del portal interno.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { zodObjectPropertySchemas } from '../../common/openapi/zod-to-schema.util.js';

/**
 * ATLAS-SEC-010 — el portal interno era el único módulo cuyos endpoints aceptaban `@Query()` y
 * `@Param()` crudos, sin `ZodValidationPipe`, contra la regla del propio proyecto ("todo endpoint
 * valida su entrada con Zod"). No había inyección —el SQL parametriza y `parsePage` acota— pero
 * tampoco había contrato: el `@ApiQuery` documentaba `minimum: 1, maximum: 100` y nada lo aplicaba,
 * así que la documentación describía un comportamiento que el código no garantizaba.
 *
 * Los límites se declaran aquí una sola vez y `parsePage` deja de ser la última línea de defensa
 * para pasar a ser una conveniencia.
 */
export const portalListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Alias legado de `limit`, conservado por compatibilidad con el Admin Portal. */
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type PortalListQueryDto = z.infer<typeof portalListQuerySchema>;

/**
 * Los identificadores del portal son opacos y compuestos (`dq:103`, `field:42`, `purpose:MKT`), no
 * enteros: se validan por forma, no por tipo. El tope de longitud y la lista de caracteres impiden
 * que un id absurdo llegue a la capa de consulta o al log.
 */
const portalIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:_.\-%]+$/u, 'El identificador solo admite letras, dígitos y los separadores : _ . - %');

export const portalIdParamSchema = (key: string) => z.object({ [key]: portalIdentifier });

export const lineageQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  node: z.string().trim().max(200).optional(),
  nodeId: z.string().trim().max(200).optional(),
  depth: z.coerce.number().int().min(1).max(5).optional(),
  direction: z.enum(['upstream', 'downstream', 'both']).optional(),
});

export type LineageQueryDto = z.infer<typeof lineageQuerySchema>;

/**
 * Cuerpo de `POST /internal/reports/:reportId/run`. `filters` se pasa tal cual al cómputo del
 * reporte, así que se acota su forma (objeto plano) en vez de aceptar cualquier JSON.
 */
export const runReportSchema = z.object({
  filters: z.record(z.string().max(120), z.unknown()).optional(),
});

export type RunReportDto = z.infer<typeof runReportSchema>;

/**
 * Los cuatro `@ApiQuery` de una lista paginada del portal se repetían literalmente en seis
 * endpoints. Componerlos evita que la documentación de un endpoint se desincronice de la de sus
 * hermanos —que fue justo lo que pasó con `minimum/maximum`, documentados y no aplicados— y devuelve
 * el controller por debajo del gate de tamaño.
 */
export function ApiPortalListQuery(): MethodDecorator {
  const properties = zodObjectPropertySchemas(portalListQuerySchema);
  return applyDecorators(
    ApiQuery({
      name: 'q',
      required: false,
      schema: properties.q,
      description: 'Filtro de texto libre; se aplica sobre los campos descriptivos del recurso.',
    }),
    ApiQuery({ name: 'page', required: false, schema: properties.page, description: 'Página solicitada, desde 1.' }),
    ApiQuery({ name: 'limit', required: false, schema: properties.limit, description: 'Elementos por página (1-100).' }),
    ApiQuery({
      name: 'pageSize',
      required: false,
      schema: properties.pageSize,
      deprecated: true,
      description: 'Alias legado de `limit`, conservado por compatibilidad con el Admin Portal.',
    }),
  );
}
