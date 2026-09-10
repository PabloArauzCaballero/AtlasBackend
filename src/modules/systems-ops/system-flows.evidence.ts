/**
 * @file Tipos y reglas de dominio: de dónde saca cada bloque su evidencia de ejecución.
 * @business Esta pieza decide contra qué uso real se verifica cada flujo y cada pantalla del ecosistema.
 * @system declara por bloque dónde pedir las corridas, cómo indexarlas, con qué clave cruzarlas y qué cliente mide.
 */
import { env } from '../../config/env.js';
import {
  indexBlockPathRuns,
  indexBlockRuns,
  type BlockAccessRun,
  type BlockPathRun,
  type RouteRuns,
  type ScreenRuns,
} from './system-flows.verification.util.js';

/** Lo mínimo de un flujo que hace falta para nombrarlo en el índice de otro bloque. */
export type FlujoIdentificable = { httpMethod: string; path: string; controller: string | null; handler: string | null };

/** Lo observado por cliente y pantalla, y si la fuente vino cortada. */
export type PantallasObservadas = { porCliente: Map<string, Map<string, ScreenRuns>>; truncado: boolean };

/**
 * Dónde pide cada bloque su evidencia de ejecución, cómo se indexa lo que devuelve y —lo que de
 * verdad separa a un bloque de otro— con qué identidad se cruza: el Motor sólo registra controlador
 * y handler, el ERP registra la plantilla de ruta. Cruzarlos con la clave del otro no da un error:
 * da cero coincidencias, que se leería como «nada se ejecutó». Por eso la clave vive aquí, junto a
 * la fuente que la produce, y no en un `if` del bucle de verificación.
 */
export type EvidenciaDeBloque = {
  /** Ruta de la evidencia en ese bloque, leída de su configuración; `dias` es la ventana pedida. */
  path: (dias: number) => string;
  index: (body: unknown) => Map<string, RouteRuns>;
  key: (flow: FlujoIdentificable) => string;
  /** Qué se guarda como procedencia de la verificación: de dónde salió, textualmente. */
  source: string;
  /** Si el bloque guarda también desde qué pantalla se le llamó, cómo leerlo. Nulo = no lo publica. */
  screens?: (body: unknown) => PantallasObservadas | null;
  screensSource?: string;
  /**
   * `window`: la evidencia cubre N días, así que «no apareció» es «no se usó en N días» y se puede
   * degradar. `process`: cuenta desde que arrancó el proceso, y sólo sirve para afirmar uso.
   */
  screensScope?: 'window' | 'process';
};

export const ACCESS_EVIDENCE: Record<string, EvidenciaDeBloque> = {
  DECISION_ENGINE: {
    path: (dias) => `${env.DECISION_ENGINE_ACCESS_RUNS_PATH}?windowDays=${dias}`,
    index: (body) => indexBlockRuns((body as { resources?: BlockAccessRun[] })?.resources ?? []),
    key: (flow) => `${flow.httpMethod} ${flow.controller}.${flow.handler}`,
    source: 'decision_access_audit (federado)',
    // Su portal le declara la pantalla y el Motor la guarda con cada acceso, en una tabla con ventana.
    //
    // Aun así, PROCESO y no ventana: la lectura del Motor pasa por RLS con el tenant de quien llama
    // (`applyTenantRls`), y AtlasBackend reenvía el token del operador. Así que la lista cubre SÓLO su
    // tenant. Con alcance de ventana, un operador del tenant 1 degradaba las pantallas que sólo usó el
    // tenant 2, y otro del tenant 2 las volvía a verificar. Hasta que el Motor declare qué cubre, esta
    // evidencia afirma uso y nunca lo niega.
    screens: indexBlockScreens,
    screensSource: 'decision_access_audit.origin_screen (federado, ventana de días, sólo el tenant de quien verifica)',
    screensScope: 'process',
  },
  DASHBOARDS: {
    // Este bloque no instrumenta nada nuevo: su `MetricsInterceptor` ya contaba las peticiones por
    // (método, patrón de ruta, estado) para Prometheus, y lo que publica es ese mismo contador.
    path: () => env.DASHBOARDS_ACCESS_RUNS_PATH,
    index: (body) => indexBlockPathRuns((body as { entries?: BlockPathRun[] })?.entries ?? []),
    key: (flow) => `${flow.httpMethod} ${flow.path}`,
    source: 'atlas_dashboards_http_requests_total (federado, desde el arranque del proceso)',
    // Su portal le declara la pantalla y Tableros la cuenta en un registro de proceso, aparte de Prometheus.
    screens: indexBlockScreens,
    screensSource: 'screen-runs.registry (federado, desde el arranque del proceso)',
    screensScope: 'process',
  },
  ERP_BACKEND: {
    // El ERP no acota por ventana: cuenta desde que arrancó la instancia y lo declara en la respuesta.
    path: () => env.ERP_BACKEND_ACCESS_RUNS_PATH,
    index: (body) => indexBlockPathRuns((body as { entries?: BlockPathRun[] })?.entries ?? []),
    key: (flow) => `${flow.httpMethod} ${flow.path}`,
    source: 'http_access_registry (federado, desde el arranque del proceso)',
    // Su portal sólo le llama a él, así que sólo él sabe desde qué pantalla se le llamó.
    screens: indexBlockScreens,
    screensSource: 'http_access_registry.screens (federado, desde el arranque del proceso)',
    screensScope: 'process',
  },
};

/**
 * Qué bloque guarda el origen que declara cada cliente, y por tanto quién puede verificar sus
 * pantallas. Un cliente que no está aquí no se verifica ni se degrada en ninguna parte: sigue sin
 * evidencia, y la respuesta lo dice en vez de contarlo como «no usado».
 */
/**
 * Clientes cuyo origen guarda OTRO bloque. Sus filas en los logs de un bloque —el portal del Motor
 * llama a AtlasBackend por su proxy— no se usan para verificar, y tampoco deben gastar el tope de la
 * consulta de pantallas de ese bloque ni contar en su denominador.
 */
export function clientesMedidosFuera(bloque: string): string[] {
  return Object.entries(CLIENT_EVIDENCE)
    .filter(([, medidoPor]) => medidoPor !== bloque)
    .map(([cliente]) => cliente);
}

export const CLIENT_EVIDENCE: Record<string, string> = {
  ADMIN_PORTAL: 'ATLAS_BACKEND',
  CONSUMER_APP: 'ATLAS_BACKEND',
  ERP_PORTAL: 'ERP_BACKEND',
  // El portal del Motor llama también a AtlasBackend por su proxy, pero sus pantallas las mide sólo
  // el Motor: con dos bloques, uno degradaría lo que acababa de verificar el otro.
  MOTOR_PORTAL: 'DECISION_ENGINE',
  DASHBOARDS_PORTAL: 'DASHBOARDS',
};

type BlockScreenRun = {
  client?: unknown;
  screen?: unknown;
  calls?: unknown;
  failed?: unknown;
  lastAt?: unknown;
  routes?: unknown;
};

/**
 * Lee las pantallas que publica un bloque. Es otro servicio, así que lo que no tenga forma de
 * pantalla se ignora en vez de tumbar la verificación.
 *
 * Un bloque que NO publica `screens` (una versión anterior) devuelve nulo, no un mapa vacío: con
 * evidencia de ventana, un mapa vacío se leería como «ninguna pantalla se usó» y degradaría todas.
 */
export function indexBlockScreens(body: unknown): PantallasObservadas | null {
  const cuerpo = (body ?? {}) as { screens?: unknown; screensTruncated?: unknown };
  if (!Array.isArray(cuerpo.screens)) return null;
  const porCliente = new Map<string, Map<string, ScreenRuns>>();
  const filas = cuerpo.screens as Array<BlockScreenRun | null>;
  for (const fila of filas) {
    if (typeof fila?.client !== 'string' || typeof fila.screen !== 'string') continue;
    const porPantalla = porCliente.get(fila.client) ?? new Map<string, ScreenRuns>();
    porPantalla.set(fila.screen, {
      calls: Number(fila.calls) || 0,
      failed: Number(fila.failed) || 0,
      lastAt: typeof fila.lastAt === 'string' && fila.lastAt ? new Date(fila.lastAt) : null,
      routes: Array.isArray(fila.routes) ? (fila.routes as ScreenRuns['routes']) : [],
    });
    porCliente.set(fila.client, porPantalla);
  }
  return { porCliente, truncado: cuerpo.screensTruncated === true };
}
