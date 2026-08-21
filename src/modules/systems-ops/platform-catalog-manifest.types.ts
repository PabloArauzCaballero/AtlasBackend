/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { z } from 'zod';

/**
 * El contrato del MANIFIESTO que publica cada bloque federado sobre sí mismo.
 *
 * Se valida con Zod y no se confía en la forma: el emisor es otro repositorio, con su propio ciclo
 * de despliegue, y este backend acaba escribiendo lo que reciba en su catálogo. Un manifiesto con
 * la forma cambiada debe producir un bloque marcado `INVALID_MANIFEST` y visible en el panel, no
 * filas a medio rellenar que nadie sabe de dónde salieron.
 *
 * Los campos opcionales lo son porque un bloque puede no tener nada que decir sobre ellos —el ERP
 * no distingue planos de API, por ejemplo— y exigirlos convertiría una diferencia legítima entre
 * productos en un fallo de integración.
 */
export const catalogManifestSchema = z.object({
  block: z.object({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(180),
    repository: z.string().trim().min(1).max(180).optional(),
    service: z.string().trim().min(1).max(120).optional(),
    version: z.string().trim().max(60).optional(),
    commit: z.string().trim().max(80).optional(),
    routePrefix: z.string().trim().max(120).optional(),
    generatedAt: z.string().trim().max(60).optional(),
  }),
  endpoints: z.array(
    z.object({
      code: z.string().trim().min(1).max(180),
      module: z.string().trim().min(1).max(120),
      method: z.string().trim().min(1).max(12),
      fullPath: z.string().trim().min(1).max(1200),
      controllerName: z.string().trim().max(180).nullable().optional(),
      handlerName: z.string().trim().max(180).nullable().optional(),
      summary: z.string().trim().max(2000).optional(),
      requiresAuth: z.boolean(),
      allowedRoles: z.array(z.string().trim().max(120)).default([]),
      audience: z.string().trim().max(60).nullable().optional(),
      isReadonly: z.boolean(),
      isDestructive: z.boolean(),
      riskLevel: z.string().trim().max(20),
      /**
       * El CONTRATO de entrada, en el formato abreviado del catálogo (`{ campo: 'tipo|required' }`).
       *
       * Es opcional porque un bloque puede no publicarlo todavía, y exigirlo convertiría una
       * diferencia de madurez entre productos en un fallo de federación. Pero sin él el catálogo
       * guarda el endpoint sin un solo campo, y entonces el generador de datos de prueba del portal
       * no tiene de dónde derivar valores: hay que escribir el payload a mano, que es exactamente lo
       * que hace que nadie pruebe el caso inválido.
       *
       * Se admite un mapa de cadenas y nada más: si el bloque manda JSON Schema entero, el catálogo
       * tendría que implementar medio validador para pintar un formulario.
       */
      minPayloadSchema: z.record(z.string().max(180), z.string().max(120)).optional(),
      queryParamsSchema: z.record(z.string().max(180), z.string().max(120)).optional(),
      pathParamsSchema: z.record(z.string().max(180), z.string().max(120)).optional(),
      /** Códigos de éxito DECLARADOS. Vacío significa «el bloque no lo dice», no «devuelve 200». */
      expectedStatusCodes: z.array(z.number().int().min(100).max(599)).max(20).optional(),
    }),
  ),
  dataEntities: z.array(
    z.object({
      schemaName: z.string().trim().min(1).max(120),
      tableName: z.string().trim().min(1).max(180),
      entityName: z.string().trim().min(1).max(220),
      module: z.string().trim().min(1).max(120),
      columnCount: z.number().int().nonnegative().default(0),
      primaryKeyColumns: z.array(z.string().trim().max(180)).default([]),
      containsPii: z.boolean(),
      containsFinancialData: z.boolean(),
      containsRiskData: z.boolean(),
      isAuditCritical: z.boolean(),
      businessPurpose: z.string().trim().max(4000).optional(),
    }),
  ),
});

export type CatalogManifest = z.infer<typeof catalogManifestSchema>;

/** Desenlaces posibles de traer un manifiesto. Cada uno exige una acción distinta del operador. */
export type FederationStatus = 'OK' | 'NOT_CONFIGURED' | 'UNREACHABLE' | 'UNAUTHORIZED' | 'INVALID_MANIFEST' | 'ERROR';

export interface FederationOutcome {
  readonly systemCode: string;
  readonly status: FederationStatus;
  readonly message: string;
  readonly endpointsImported: number;
  readonly dataEntitiesImported: number;
  readonly remoteVersion: string | null;
  readonly remoteCommit: string | null;
}
