/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system fija el catálogo de datasets, los techos y los roles del cuaderno de datos.
 */
import { AtlasUserRole } from '../../common/types/auth.types.js';

/**
 * Quién puede abrir el cuaderno.
 *
 * `admin` está aquí por la misma lección que ya costó una vez en systems-ops (ver
 * `SYSTEMS_OPS_GOVERNANCE_ROLES`): `legacyRoleForInternalRoles` NUNCA emite `system_admin`
 * —SUPER_ADMIN, SYSTEMS_ADMIN e INTERNAL_IDENTITY_ADMIN colapsan los tres en `admin`— y
 * `platform_admin` sólo lo lleva un `platform_user`. Sin `admin`, de esta lista no había ni una
 * llave que un administrador del tenant pudiera tener: el superadministrador abría el cuaderno y
 * recibía 403 en el catálogo de datasets, que la pantalla sólo puede contar como «el servicio no
 * responde o tu sesión caducó» —ninguna de las dos cosas—. `system_admin` se queda porque el
 * vocabulario del token lo admite y un emisor futuro podría producirlo, pero hoy no abre nada.
 *
 * `fraud_analyst` NO está, y es una decisión, no un olvido: el cuaderno entrega filas de clientes
 * y de bitácora en bloque, y el análisis de fraude trabaja sobre SU caso. El portal lo espejaba
 * mal —lo tenía en `accessPolicies.dataNotebook`— y por eso ese perfil veía la pestaña para
 * chocar con un 403; ya está retirado allí. Si se decide lo contrario, se añade EN LOS DOS.
 *
 * Lo fija `el administrador interno %s puede abrir el cuaderno de datos`
 * (test/e2e/user-types/user-types.spec.ts), que nombra los tres roles RBAC de administración en
 * vez de conformarse con que la lista tenga alguna llave alcanzable.
 */
export const DATA_NOTEBOOK_ROLES: readonly AtlasUserRole[] = [
  'system_admin',
  'platform_admin',
  'admin',
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

/**
 * Los lenguajes que una celda puede llevar. Ninguno se ejecuta AQUÍ.
 *
 * El servidor los guarda y los devuelve; el código corre en la pestaña de quien lo escribió
 * —CPython y R sobre WebAssembly, JavaScript en un worker—. La lista existe para que el historial
 * y los cuadernos guardados no admitan un valor inventado, no porque el backend sepa interpretar
 * ninguno: **no hay ni un endpoint que ejecute código.**
 *
 * `sql` sólo aparece en el HISTORIAL: la consola SQL escribe en la misma tabla, y partirlo en dos
 * obligaría a quien audite a acordarse de mirar en dos sitios.
 */
export const NOTEBOOK_CELL_LANGUAGES = ['python', 'javascript', 'r'] as const;
export const NOTEBOOK_HISTORY_LANGUAGES = [...NOTEBOOK_CELL_LANGUAGES, 'sql'] as const;

/**
 * Qué forma tiene un código de dataset, y por qué son DOS formas y no una libre.
 *
 * El cuaderno lee de dos catálogos. Los de AtlasBackend son códigos planos (`customer-overview`);
 * los del motor llegan prefijados (`motor:decisiones.ejecuciones`) porque su relación vive en otro
 * servicio y en otro esquema. Cualquier otra cosa se rechaza en el borde.
 *
 * No es una validación cosmética. Ese código viaja hasta el portal, que lo usa para reabrir el
 * cuaderno donde se dejó y, en el caso del motor, para componer la relación de la consulta que
 * manda a `/v1/sql-console/query`. Admitiendo `[a-z0-9.:_-]+` a secas —como se admitía— cabía
 * `motor:pg_catalog.pg_authid`: lo paraban la guardia léxica y el plan del motor, pero la primera
 * puerta lo dejaba pasar, y una defensa que descansa entera en la última no es una defensa.
 *
 * El tope de 64 caracteres es el de la columna `dataset_code`. Se escribe también aquí para que un
 * nombre más largo se rechace con un mensaje en vez de reventar contra el driver.
 */
export const NOTEBOOK_DATASET_CODE_PATTERN =
  /^(?:[a-z0-9-]{1,64}|motor:[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62})$/;

export const NOTEBOOK_DATASET_CODE_MESSAGE =
  'El código de dataset debe ser el de una vista de read_api (minúsculas, dígitos y guiones) o uno del motor con la forma motor:esquema.tabla.';

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
  /**
   * Techo en BYTES de las filas que viajan en una respuesta.
   *
   * El techo por filas no basta, y la diferencia es de dos órdenes de magnitud: `pageSize` cuenta
   * filas, pero una fila de la bitácora de auditoría con su carga JSON pesa cien veces lo que una
   * de la cola de operaciones. Las mismas quinientas filas son decenas de KB en un dataset y
   * decenas de MB en otro — y ese segundo caso no lo aguanta el navegador, que además tiene que
   * meterlas dentro del intérprete de Python.
   *
   * Se recorta por filas ENTERAS y se DICE que se recortó: media fila serializada no es JSON, y
   * una respuesta truncada en silencio produce un análisis sobre una muestra que nadie eligió,
   * que es peor que un error.
   */
  maxResponseBytes: 8 * 1024 * 1024,
  /** Longitud máxima del código que se guarda en el historial. */
  maxHistorySourceLength: 20_000,
  /** Entradas de historial que se devuelven de una vez. */
  historyPageSize: 50,
  /**
   * Techo de celdas por cuaderno guardado.
   *
   * No es una opinión sobre cómo trabaja nadie: es que el documento entero viaja en una fila JSONB
   * y se valida en memoria en cada guardado. Sin tope, un cliente puede mandar un cuaderno de
   * cientos de miles de celdas y convertir un `PUT` en una forma barata de tumbar el proceso.
   */
  maxNotebookCells: 200,
  /** Cuadernos guardados por persona. Un tope que se ve es mejor que una tabla que crece sola. */
  maxNotebooksPerUser: 100,
  /**
   * Techo en BYTES del documento guardado, resultados incluidos.
   *
   * Es el tope que hace sostenible guardar el avance. Un cuaderno conserva las tablas que cada
   * celda devolvió y los PNG de sus gráficos, y ninguna de las dos cosas la acota el número de
   * celdas: una sola con veinte mil filas, o cuatro gráficos a 110 ppp, pesan más que doscientas
   * celdas de código. Sin este techo, cien cuadernos por persona multiplican eso.
   *
   * Se comprueba sobre el JSON ya serializado —lo que de verdad va a la fila— y no sobre una
   * estimación por celda, que es donde suelen colarse los descuadres.
   */
  maxNotebookBytes: 4 * 1024 * 1024,
} as const;
