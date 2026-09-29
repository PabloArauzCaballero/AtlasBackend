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
 * Filtros de las listas de corridas y de alertas. Antes no estaban declarados: el portal mandaba
 * `status`, `queue` y `severity`, Zod los descartaba en silencio y la tabla seguía mostrando todo.
 * Un desplegable que no filtra es peor que no tenerlo: el operador cree que no hay fallidos.
 */
const facetFilter = z.string().trim().min(1).max(60).optional();

export const portalJobsQuerySchema = portalListQuerySchema.extend({
  status: facetFilter,
  queue: facetFilter,
});

export type PortalJobsQueryDto = z.infer<typeof portalJobsQuerySchema>;

/** Búsqueda global: `kind` pagina UN tipo (endpoint, tabla, regla de calidad o reporte). */
export const portalSearchQuerySchema = portalListQuerySchema.extend({
  kind: z.enum(['endpoint', 'table', 'quality_rule', 'report']).optional(),
});

export type PortalSearchQueryDto = z.infer<typeof portalSearchQuerySchema>;

export const portalAlertsQuerySchema = portalListQuerySchema.extend({
  status: facetFilter,
  severity: facetFilter,
});

export type PortalAlertsQueryDto = z.infer<typeof portalAlertsQuerySchema>;

/**
 * Filtros de las reglas de calidad. El portal ya mandaba `severity` y `status`, pero la ruta usaba
 * `portalListQuerySchema`, que los descartaba en silencio: los dos desplegables no filtraban nada.
 * `status` es el estado de la DEFINICIÓN (`is_active`), no de una ejecución: las reglas no se ejecutan.
 */
export const portalDataQualityRulesQuerySchema = portalListQuerySchema.extend({
  severity: facetFilter,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type PortalDataQualityRulesQueryDto = z.infer<typeof portalDataQualityRulesQuerySchema>;

/**
 * Glosario: `domain` (exacto, sin distinguir mayúsculas) y `type` (dominio, tabla o campo). Antes el
 * portal mandaba `domain` y Zod lo descartaba: el desplegable «Dominio» no filtraba nada.
 */
export const portalGlossaryQuerySchema = portalListQuerySchema.extend({
  domain: z.string().trim().min(1).max(120).optional(),
  type: z.enum(['domain', 'table', 'field']).optional(),
});

export type PortalGlossaryQueryDto = z.infer<typeof portalGlossaryQuerySchema>;

/** Reportería: los dos desplegables de la pantalla, que antes se descartaban en silencio. */
export const portalReportsQuerySchema = portalListQuerySchema.extend({
  domain: facetFilter,
  status: facetFilter,
});

export type PortalReportsQueryDto = z.infer<typeof portalReportsQuerySchema>;

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
  // El portal ya mandaba `nodeType` y la paginación de `/lineage/impact`; al no estar declarados
  // aquí, Zod los descartaba en silencio: el selector «tipo de nodo» no hacía nada y la lista de
  // impactos se quedaba clavada en la primera página de 20 pasara lo que pasara.
  nodeType: z.enum(['table', 'endpoint']).optional(),
  nodeLimit: z.coerce.number().int().min(1).max(2000).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // Módulo exacto de los nodos (grafo) o de alguno de los dos extremos (impacto).
  domain: z.string().trim().min(1).max(120).optional(),
  // Sólo `/lineage/impact`: severidad de la arista endpoint→tabla y familia de arista. `severity` lo
  // mandaba el portal desde siempre y se descartaba aquí, así que el desplegable no filtraba.
  severity: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']))
    .optional(),
  family: z.enum(['impact', 'relationship']).optional(),
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

/** Documenta los filtros de `/lineage` y `/lineage/impact` (los del grafo y los de la lista). */
export function ApiLineageQuery(options: { impact: boolean }): MethodDecorator {
  const properties = zodObjectPropertySchemas(lineageQuerySchema);
  const query = (name: keyof typeof properties, description: string) =>
    ApiQuery({ name, required: false, schema: properties[name], description });
  const common = [
    query(
      'q',
      options.impact
        ? 'Texto en origen, destino, tipo, descripción o tabla (ILIKE).'
        : 'Texto en nombre, tabla, esquema, ruta o módulo (ILIKE).',
    ),
    query('domain', 'Módulo exacto (sin distinguir mayúsculas) de los nodos o de alguno de los dos extremos.'),
  ];
  const specific = options.impact
    ? [
        query('severity', 'Severidad de la arista endpoint→tabla (LOW, MEDIUM, HIGH, CRITICAL). Las relaciones entre tablas no tienen.'),
        query('family', 'Familia de arista: `impact` (endpoint→tabla) o `relationship` (tabla→tabla).'),
        query('page', 'Página solicitada, desde 1.'),
        query('limit', 'Elementos por página (1-100).'),
      ]
    : [
        query('nodeType', 'Sólo nodos de este tipo: `table` o `endpoint`.'),
        query('nodeLimit', 'Tope de nodos de cada tipo (1-2000, por defecto 1000).'),
      ];
  return applyDecorators(...common, ...specific);
}

/** Documenta un filtro exacto (sin distinguir mayúsculas) de una lista del portal. */
export function ApiPortalFacetQuery(name: string, description: string): MethodDecorator {
  return ApiQuery({ name, required: false, schema: { type: 'string', maxLength: 60 }, description });
}

/** La lista paginada de siempre más `kind`, con lo que busca en cada tipo dicho con exactitud. */
export function ApiPortalSearchQuery(): MethodDecorator {
  return applyDecorators(
    ApiPortalListQuery(),
    ApiQuery({
      name: 'kind',
      required: false,
      schema: zodObjectPropertySchemas(portalSearchQuerySchema).kind,
      description:
        'Tipo a paginar. Endpoints: ruta, nombre de ruta o módulo; tablas: tabla, entidad o módulo; reglas: código, nombre o ' +
        'tabla objetivo; reportes: cualquier texto de su definición. Sin `kind` trae hasta `limit` de cada tipo.',
    }),
  );
}
