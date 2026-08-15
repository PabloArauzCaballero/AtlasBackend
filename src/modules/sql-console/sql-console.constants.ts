/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system fija el vocabulario prohibido, los techos y los roles de la consola SQL de solo lectura.
 */
import { AtlasUserRole } from '../../common/types/auth.types.js';

/**
 * Quién puede consultar. Espeja los roles del cuaderno de datos a propósito: las dos pantallas
 * leen exactamente la misma superficie (`read_api`) y con el mismo enmascarado, así que dar acceso
 * a una y no a la otra no protegería nada — sólo obligaría a elegir herramienta por permisos.
 */
export const SQL_CONSOLE_ROLES: readonly AtlasUserRole[] = [
  'system_admin',
  'platform_admin',
  'admin',
  'readonly_auditor',
  'risk_analyst',
  'compliance_analyst',
];

/** Quién puede ver los valores SIN enmascarar. */
export const SQL_CONSOLE_REVEAL_ROLES: readonly AtlasUserRole[] = ['platform_admin', 'admin'];

/**
 * Esquemas que la consola puede leer.
 *
 * `read_api` va primero porque es la superficie versionada y ya desidentificada — la que alguien
 * debería usar salvo que sepa por qué necesita otra cosa. Los demás son el modelo real, y están
 * aquí porque una consola que sólo enseña siete vistas sobre una base de 158 relaciones no sirve
 * para responder las preguntas por las que se abre.
 *
 * Es una lista y no «todo lo que no sea del sistema»: `pg_catalog` y `pg_toast` quedan fuera, y un
 * esquema nuevo no entra solo — alguien tiene que añadirlo aquí, que es donde se mira al preguntar
 * qué expone esta consola.
 *
 * Abrir el modelo real tiene un coste que conviene tener presente: en `read_api` la
 * desidentificación está hecha a propósito y versionada, mientras que en las tablas base el
 * enmascarado depende de la heurística por nombre de columna. Las credenciales no dependen de esa
 * heurística —van por nombre exacto en `SQL_FORBIDDEN_RELATIONS`, que es una lista aparte
 * justamente para que ampliar los esquemas no las arrastre—, pero un campo personal con un nombre
 * inesperado sí podría pasar en claro.
 */
export const SQL_CONSOLE_SCHEMAS = [
  'read_api',
  'customer',
  'credit',
  'risk',
  'case_management',
  'privacy',
  'telemetry',
  'catalog',
  'iam',
  'audit',
  'integrations',
  'messaging',
  'platform_ops',
  'public',
] as const;

/** Sentencias con las que una consulta puede empezar. */
export const SQL_ALLOWED_LEADING_KEYWORDS = ['select', 'with', 'table', 'values'] as const;

/**
 * Palabras que NO pueden aparecer como token en ninguna posición.
 *
 * Es una lista de PALABRAS, no de subcadenas: `updated_at` es una columna legítima y una búsqueda
 * de texto la confundiría con `UPDATE`. El tokenizador entrega palabras ya separadas de literales,
 * comentarios e identificadores entrecomillados, así que aquí se compara token a token.
 *
 * Varias son inalcanzables si el resto de defensas funciona —una sola sentencia que empieza por
 * SELECT no puede contener un `VACUUM`—, y siguen aquí por eso mismo: si el conteo de sentencias
 * falla algún día, esta lista es la segunda red. Una columna que se llame como una de ellas se
 * escribe entre comillas dobles, que además es SQL correcto.
 */
export const SQL_FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'drop',
  'alter',
  'create',
  'grant',
  'revoke',
  'copy',
  'do',
  'call',
  'execute',
  'prepare',
  'deallocate',
  'vacuum',
  'reindex',
  'refresh',
  'lock',
  'listen',
  'notify',
  'unlisten',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'set',
  'reset',
  'discard',
  'declare',
  'checkpoint',
  'into',
] as const;

/**
 * Funciones que leen fuera de las tablas, escriben en el servidor o abren otra conexión.
 *
 * `dblink` y los envoltorios foráneos son el agujero clásico: la consulta sigue siendo un SELECT,
 * pero abre una conexión NUEVA con otra identidad, y ahí ya no rige nada de esto.
 */
export const SQL_FORBIDDEN_FUNCTIONS = [
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_stat_file',
  'lo_import',
  'lo_export',
  'lo_get',
  'dblink',
  'dblink_exec',
  'dblink_connect',
  'pg_sleep',
  'pg_sleep_for',
  'pg_sleep_until',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'pg_reload_conf',
  'set_config',
  'current_setting',
  'query_to_xml',
  'database_to_xml',
  'pg_advisory_lock',
] as const;

/**
 * Relaciones que nunca se sirven, ni se listan en el catálogo.
 *
 * Dos familias. Las del catálogo de Postgres: `pg_authid` y `pg_shadow` guardan el hash de las
 * contraseñas de la propia base, y `pg_statistic` publica los valores más comunes de cada columna
 * —que para una tabla de documentos de identidad ES el dato—.
 *
 * Y las de ATLAS, que entraron en juego al abrir la consola al modelo real: `iam.auth_credentials`
 * guarda las contraseñas, `iam.auth_refresh_tokens` las sesiones vivas y `messaging.device_tokens`
 * los identificadores de envío a dispositivo. Un SELECT sobre cualquiera de ellas no es un
 * diagnóstico: es una extracción de credenciales, y con los refresh tokens es además una
 * suplantación.
 *
 * Van por NOMBRE y no por heurística de columna a propósito: el enmascarado adivina por el nombre
 * del campo y podría fallar; esta lista no adivina. Se comprobó contra la base qué relaciones de
 * los esquemas abiertos llevan credenciales, en vez de suponerlo.
 */
export const SQL_FORBIDDEN_RELATIONS = [
  'pg_authid',
  'pg_shadow',
  'pg_statistic',
  'pg_user_mappings',
  'pg_largeobject',
  'pg_stat_statements',
  'auth_credentials',
  'auth_refresh_tokens',
  'device_tokens',
] as const;

export const SQL_CONSOLE_LIMITS = {
  /** Filas máximas que devuelve una consulta. Por encima, se recorta y se DICE. */
  maxRows: 1_000,
  /** Plazo de la sentencia, aplicado por Postgres con `statement_timeout`. */
  timeoutMs: 15_000,
  /** Tamaño máximo del texto de la consulta. */
  maxStatementBytes: 20_000,
  /** Techo en bytes del resultado servido. */
  maxResponseBytes: 8 * 1024 * 1024,
  /** Entradas de historial devueltas de una vez. */
  historyPageSize: 50,
} as const;
