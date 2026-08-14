/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system fija el catálogo de datasets, los techos y los roles del cuaderno de datos.
 */
import { AtlasUserRole } from '../../common/types/auth.types.js';

/** Quién puede abrir el cuaderno. */
export const DATA_NOTEBOOK_ROLES: readonly AtlasUserRole[] = [
  'system_admin',
  'platform_admin',
  'readonly_auditor',
  'risk_analyst',
  'compliance_analyst',
];

/**
 * Quién puede pedir los valores SIN enmascarar.
 *
 * Separado del acceso a propósito: leer la forma de los datos (¿cuántos casos abiertos por
 * prioridad?) y leer el dato personal de alguien concreto son dos permisos distintos, y
 * colapsarlos convierte cada análisis en un acceso a PII.
 */
export const DATA_NOTEBOOK_REVEAL_ROLES: readonly AtlasUserRole[] = ['platform_admin'];

/**
 * A quién pertenecen las filas de un dataset.
 *
 * `TENANT` se acota por la columna de inquilino y NO se sirve si esa columna falta: entregarlo
 * sin acotar sería dar datos de otras organizaciones. `PLATFORM` describe la plataforma misma
 * —la salud de los proveedores externos, el catálogo técnico de endpoints— y no tiene inquilino
 * porque no habla de los clientes de nadie.
 *
 * Se DECLARA aquí y no se deduce de si la vista tiene la columna. La diferencia importa: dedujera
 * lo que dedujera, una vista de clientes a la que una migración le quitara `tenant_id` pasaría en
 * silencio de «acotada» a «todas las filas». Declarado, ese mismo caso se queda sin servir y
 * alguien tiene que venir a cambiar esta línea a mano.
 */
export type NotebookDatasetScope = 'TENANT' | 'PLATFORM';

export type NotebookDataset = {
  /** Identificador estable que viaja por la API y que el código del cuaderno usa para cargar. */
  code: string;
  /** Vista de `read_api`. NUNCA se compone desde la entrada del usuario: se busca por `code`. */
  view: string;
  label: string;
  description: string;
  scope: NotebookDatasetScope;
};

/**
 * El catálogo es una lista CERRADA de vistas de `read_api`, no el esquema `public`.
 *
 * Dos motivos, y el segundo es el que importa. El primero es de seguridad: si el nombre de la
 * relación sólo puede salir de esta constante, no existe forma de que la entrada del usuario
 * llegue a formar parte de un identificador SQL, y la inyección deja de ser una clase de fallo
 * posible en vez de una que hay que recordar mitigar en cada consulta.
 *
 * El segundo es de gobierno: `read_api` es la superficie de lectura que este repositorio ya
 * declara, versiona (`_v1`) y verifica (`yarn check:read-api-views`). Un cuaderno que leyera las
 * tablas base congelaría en los análisis de la gente la forma interna del modelo, y cualquier
 * migración pasaría a romper el trabajo de terceros sin que nadie lo supiera hasta que ocurriera.
 * Contra una vista versionada, cambiar el modelo por debajo es un problema de quien mantiene la
 * vista, que es donde debe estar.
 */
export const NOTEBOOK_DATASETS: readonly NotebookDataset[] = [
  {
    code: 'customer-overview',
    view: 'v_customer_overview_v1',
    label: 'Panorama de clientes',
    description: 'Una fila por cliente con su estado, consentimientos, casos abiertos y última evaluación de riesgo.',
    scope: 'TENANT',
  },
  {
    code: 'risk-assessment-summary',
    view: 'v_risk_assessment_summary_v1',
    label: 'Resumen de evaluaciones de riesgo',
    description: 'Corridas de evaluación con su desenlace, puntaje y motivo.',
    scope: 'TENANT',
  },
  {
    code: 'operations-work-queue',
    view: 'v_operations_work_queue_v1',
    label: 'Cola de trabajo de operaciones',
    description: 'Revisiones manuales abiertas por prioridad y antigüedad.',
    scope: 'TENANT',
  },
  {
    code: 'provider-health-latest',
    view: 'v_provider_health_latest_v1',
    label: 'Salud de proveedores',
    description: 'Último estado observado de cada proveedor externo.',
    // Salud de proveedores externos: describe la plataforma, no a los clientes de nadie.
    scope: 'PLATFORM',
  },
  {
    code: 'notification-delivery-summary',
    view: 'v_notification_delivery_summary_v1',
    label: 'Entrega de notificaciones',
    description: 'Envíos por canal y desenlace de entrega.',
    scope: 'TENANT',
  },
  {
    code: 'system-endpoint-coverage',
    view: 'v_system_endpoint_coverage_v1',
    label: 'Cobertura de endpoints',
    description: 'Catálogo técnico de endpoints con su cobertura de pruebas y revisión.',
    // Catalogo tecnico del propio backend: describe la plataforma, no a sus clientes.
    scope: 'PLATFORM',
  },
  {
    code: 'audit-event-feed',
    view: 'v_audit_event_feed_v1',
    label: 'Bitácora de auditoría',
    description: 'Eventos de auditoría en orden cronológico inverso.',
    scope: 'TENANT',
  },
];

/** Esquema único desde el que se sirve el cuaderno. */
export const NOTEBOOK_SCHEMA = 'read_api';

/** Nombres admitidos para la columna de inquilino. Una vista sin ninguna de ellas NO se sirve. */
export const NOTEBOOK_TENANT_COLUMNS = ['tenant_id', '_tenant_id'] as const;

export const DATA_NOTEBOOK_LIMITS = {
  /** Filas por página en la vista de tabla. */
  maxPageSize: 500,
  defaultPageSize: 100,
  /** Filas máximas que una carga completa hacia el cuaderno puede materializar. */
  maxDatasetRows: 20_000,
  /** Techo del conteo total: contar más allá de esto cuesta más que el propio resultado. */
  countCeiling: 200_000,
  /** Cargas de dataset por minuto y usuario. */
  ratePerMinute: 60,
} as const;
