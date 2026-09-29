/**
 * @file Reglas puras de la deriva de permisos y el SQL que las alimenta.
 * @business Esta pieza encuentra las pantallas que dejan entrar a alguien que luego recibe «sin permiso», y los permisos que el código exige y la base no tiene.
 * @system clasifica cada llamada observada pantalla→endpoint y cruza los permisos exigidos con el catálogo RBAC interno de la base.
 */
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const FLOWS = atlasSchemaFor('system_flow_catalog');
const SCREENS = atlasSchemaFor('system_screen_catalog');
const PERMISSIONS = atlasSchemaFor('internal_permissions');

/**
 * Las clases de desajuste, de la más grave a la menos. Las tres primeras rompen a usuarios reales:
 *
 * - `PERMISO_FUERA_DEL_CATALOGO`: el código exige un permiso que la base no tiene. Nadie puede
 *   tenerlo, ni SUPER_ADMIN, así que la ruta responde 403 a todo el mundo. Pasó con
 *   `partner.qr.review` el 2026-09-15: nadie podía aprobar el QR de cobro de un comercio.
 * - `MENU_PERMISO_DISTINTO`: el menú enseña la pantalla con un permiso y la API pide otro. Quien
 *   tiene sólo el del menú entra y ve «sin permiso».
 * - `SIN_GUARDA`: ni permiso, ni roles, ni `@Public`: la ruta la llama cualquiera con sesión.
 *
 * `PUBLIC` es una decisión declarada y `SOLO_ROL` otra puerta; se conservan por compatibilidad, pero
 * van al final y no cuentan como avería.
 */
export const DRIFT_SEVERITIES = ['PERMISO_FUERA_DEL_CATALOGO', 'MENU_PERMISO_DISTINTO', 'SIN_GUARDA', 'PUBLIC', 'SOLO_ROL'] as const;
export type DriftSeverity = (typeof DRIFT_SEVERITIES)[number];

/** Las clases que dejan a un usuario sin poder hacer lo que la pantalla le ofrece. */
export const BREAKING_SEVERITIES: readonly DriftSeverity[] = ['PERMISO_FUERA_DEL_CATALOGO', 'MENU_PERMISO_DISTINTO', 'SIN_GUARDA'];

/** Los permisos activos del catálogo RBAC interno, tal como están EN LA BASE (no en el código). */
export const RBAC_CATALOG_PERMISSIONS_SQL = `SELECT DISTINCT permission_code
         FROM ${PERMISSIONS}.internal_permissions
        WHERE _deleted = false AND status = 'active'`;

/**
 * Menús con permiso de los clientes cuyos permisos viven en el catálogo de AtlasBackend. El menú sale
 * del análisis del código del cliente, no del tráfico: un permiso de menú que la base no tiene
 * esconde la pantalla a todos, se haya abierto alguna vez o no. Los permisos del portal del ERP son
 * de OTRO catálogo y no se cruzan aquí.
 */
export const MENU_PERMISSIONS_SQL = `SELECT client_code, route, nav_permissions, nav_roles
         FROM ${SCREENS}.system_screen_catalog
        WHERE client_code IN (:clientCodes)
          AND jsonb_typeof(nav_permissions) = 'array' AND jsonb_array_length(nav_permissions) > 0
        ORDER BY client_code, route`;

/** Endpoints de AtlasBackend que exigen permiso fino: los únicos que pueden pedir uno que no existe. */
export const FLOWS_WITH_PERMISSIONS_SQL = `SELECT flow_id, http_method AS method, path, internal_permissions, roles
         FROM ${FLOWS}.system_flow_catalog
        WHERE system_code = 'ATLAS_BACKEND'
          AND jsonb_typeof(internal_permissions) = 'array' AND jsonb_array_length(internal_permissions) > 0
        ORDER BY path, http_method`;

export type DriftRow = {
  client_code: string;
  route: string;
  nav_permissions: string[];
  nav_roles: string[];
  method: string;
  path: string;
  flow_id: string;
  internal_permissions?: string[] | null;
  roles: string[];
  is_public: boolean;
};

export type DriftCall = {
  flowId: string | null;
  method: string | null;
  path: string | null;
  severity: DriftSeverity;
  roles: string[];
  /** Lo que exige la API. */
  permissions: string[];
  /** Lo que la API exige y el menú no pide: quien entra por el menú sin esto recibe 403. */
  missingFromMenu: string[];
  /** Lo que se exige (API o menú) y la base no tiene: nadie puede tenerlo. */
  missingFromCatalog: string[];
};

export type DriftItem = DriftCall & {
  /** Nulo en un endpoint que pide un permiso inexistente y que ninguna pantalla observada llamó. */
  clientCode: string | null;
  route: string | null;
  navPermissions: string[];
  navRoles: string[];
};

const faltan = (exigidos: readonly string[], tiene: ReadonlySet<string> | readonly string[]): string[] => {
  const conjunto = tiene instanceof Set ? tiene : new Set(tiene as readonly string[]);
  return [...new Set(exigidos.filter((permiso) => !conjunto.has(permiso)))].sort();
};

/**
 * Clasifica UNA llamada observada. Devuelve nulo si no hay desajuste: un endpoint con permiso fino
 * que el menú ya pide está bien, y antes ni siquiera entraba en la consulta.
 *
 * `catalogo` nulo significa que el catálogo de la base no se pudo leer o está vacío: entonces no se
 * afirma que falte nada, porque «falta todo» sería un artefacto del entorno.
 */
export function classifyCall(fila: DriftRow, catalogo: ReadonlySet<string> | null): DriftCall | null {
  const permissions = [...(fila.internal_permissions ?? [])];
  const base = { flowId: fila.flow_id, method: fila.method, path: fila.path, roles: fila.roles, permissions };
  if (permissions.length) {
    const missingFromCatalog = catalogo ? faltan(permissions, catalogo) : [];
    // Un menú sólo por rol no se puede comparar con un permiso sin el reparto rol→permiso de la base.
    const missingFromMenu = fila.nav_permissions.length ? faltan(permissions, fila.nav_permissions) : [];
    if (missingFromCatalog.length) return { ...base, severity: 'PERMISO_FUERA_DEL_CATALOGO', missingFromMenu, missingFromCatalog };
    if (missingFromMenu.length) return { ...base, severity: 'MENU_PERMISO_DISTINTO', missingFromMenu, missingFromCatalog };
    return null;
  }
  const severity: DriftSeverity = fila.is_public ? 'PUBLIC' : fila.roles.length ? 'SOLO_ROL' : 'SIN_GUARDA';
  return { ...base, severity, missingFromMenu: [], missingFromCatalog: [] };
}

/** Menús cuyo permiso no existe en la base: la entrada del menú no la ve nadie. */
export function menuItemsOutsideCatalog(
  menus: Array<{ client_code: string; route: string; nav_permissions: string[]; nav_roles: string[] }>,
  catalogo: ReadonlySet<string> | null,
): DriftItem[] {
  if (!catalogo) return [];
  return menus.flatMap((menu) => {
    const missingFromCatalog = faltan(menu.nav_permissions, catalogo);
    if (!missingFromCatalog.length) return [];
    return [
      {
        clientCode: menu.client_code,
        route: menu.route,
        navPermissions: menu.nav_permissions,
        navRoles: menu.nav_roles,
        flowId: null,
        method: null,
        path: null,
        severity: 'PERMISO_FUERA_DEL_CATALOGO' as const,
        roles: [],
        permissions: [],
        missingFromMenu: [],
        missingFromCatalog,
      },
    ];
  });
}

/**
 * Endpoints que exigen un permiso inexistente y que ninguna pantalla observada llamó. No depende del
 * tráfico: el 403 es para todos desde el primer intento, así que esperar a que alguien lo sufra para
 * listarlo sería llegar tarde.
 */
export function endpointItemsOutsideCatalog(
  flows: Array<{ flow_id: string; method: string; path: string; internal_permissions: string[]; roles: string[] }>,
  catalogo: ReadonlySet<string> | null,
  yaListados: ReadonlySet<string>,
): DriftItem[] {
  if (!catalogo) return [];
  return flows.flatMap((flow) => {
    const missingFromCatalog = faltan(flow.internal_permissions, catalogo);
    if (!missingFromCatalog.length || yaListados.has(flow.flow_id)) return [];
    return [
      {
        clientCode: null,
        route: null,
        navPermissions: [],
        navRoles: [],
        flowId: flow.flow_id,
        method: flow.method,
        path: flow.path,
        severity: 'PERMISO_FUERA_DEL_CATALOGO' as const,
        roles: flow.roles,
        permissions: flow.internal_permissions,
        missingFromMenu: [],
        missingFromCatalog,
      },
    ];
  });
}

/** Lo más grave primero; dentro de cada clase, por cliente y pantalla. `SOLO_ROL` queda al final. */
export function byGravity(a: DriftItem, b: DriftItem): number {
  return (
    DRIFT_SEVERITIES.indexOf(a.severity) - DRIFT_SEVERITIES.indexOf(b.severity) ||
    (a.clientCode ?? '~').localeCompare(b.clientCode ?? '~') ||
    (a.route ?? '').localeCompare(b.route ?? '') ||
    (a.path ?? '').localeCompare(b.path ?? '')
  );
}

/** Las cifras de la deriva, sobre el conjunto entero. */
export function summarizeDrift(todos: readonly DriftItem[]) {
  const cuantas = (severity: DriftSeverity) => todos.filter((item) => item.severity === severity).length;
  return {
    screensWithDrift: new Set(todos.filter((item) => item.route).map((item) => `${item.clientCode} ${item.route}`)).size,
    calls: todos.length,
    breaking: todos.filter((item) => BREAKING_SEVERITIES.includes(item.severity)).length,
    bySeverity: Object.fromEntries(DRIFT_SEVERITIES.map((severity) => [severity, cuantas(severity)])) as Record<DriftSeverity, number>,
    clients: [...new Set(todos.map((item) => item.clientCode).filter((code): code is string => Boolean(code)))].sort(),
    permissionsOutsideCatalog: [...new Set(todos.flatMap((item) => item.missingFromCatalog))].sort(),
  };
}
