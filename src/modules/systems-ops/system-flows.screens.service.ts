/**
 * @file Caso de uso de dominio: orquesta reglas y persistencia.
 * @business Esta pieza dice qué pantallas del ecosistema se usan de verdad, y contra qué llaman.
 * @system cruza el catálogo de pantallas con el origen declarado en las corridas reales.
 */
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { SystemFlowsScreensRepository } from './system-flows.screens.repository.js';
import { VerifyFlowsDto } from './system-flows.schemas.js';
import { SIN_CLIENTE } from './system-flows.screens.repository.js';
import { matchScreenRuns, screenVerificationFrom } from './system-flows.verification.util.js';
import { CLIENT_EVIDENCE, CLIENTES_CON_DERIVA, type PantallasObservadas } from './system-flows.evidence.js';
import { RBAC_DRIFT_LIMIT } from './system-flows.sql.constants.js';
import {
  byGravity,
  classifyCall,
  endpointItemsOutsideCatalog,
  menuItemsOutsideCatalog,
  summarizeDrift,
  type DriftCall,
  type DriftItem,
} from './system-flows.rbac-drift.js';
import { containsText, slicePage, type RbacDriftQueryDto } from './system-flows.list-query.js';

/** Clientes cuyos permisos de menú viven en el catálogo RBAC de AtlasBackend. */
const CLIENTES_DEL_CATALOGO = Object.keys(CLIENT_EVIDENCE).filter((cliente) => CLIENT_EVIDENCE[cliente] === 'ATLAS_BACKEND');

@Injectable()
export class SystemFlowsScreensService {
  constructor(private readonly repository: SystemFlowsScreensRepository) {}

  /**
   * Verifica las PANTALLAS contra lo que de verdad se hizo desde ellas.
   *
   * ## Quién puede verificar a quién
   *
   * La evidencia la guarda el backend al que cada cliente declara su origen, y sólo ése opina de sus
   * pantallas (`CLIENT_EVIDENCE`). Antes la verificación del Backend recorría TODOS los clientes y
   * degradaba lo que no veía en sus propios logs: en cuanto el ERP aportara evidencia, cada
   * verificación del Backend habría despintado las pantallas que acababa de verificar el ERP.
   *
   * ## Degradar exige una ventana
   *
   * Los logs del Backend y la auditoría del Motor cubren una ventana: «no apareció» significa «no se
   * usó en N días». El contador del ERP cuenta desde que arrancó su proceso, y un despliegue lo
   * vacía: «no apareció» sólo significa «no desde el último arranque». Con esa evidencia se AFIRMA
   * uso y nunca se niega (`screensScope`).
   *
   * ## Qué NO se hace aquí
   *
   * No se marca ninguna pantalla como rota. Lo que falla es el endpoint, que ya tiene su eje y su
   * ficha; una pantalla que llama a algo roto hace su trabajo y enseña el error.
   */
  async verify(
    dto: VerifyFlowsDto,
    tx: Transaction,
    federadas: PantallasObservadas | null = null,
    source?: string,
    scope: 'window' | 'process' = 'process',
  ) {
    const propias = dto.systemCode === 'ATLAS_BACKEND';
    const conVentana = propias || scope === 'window';
    const evidencia = propias ? await this.repository.screenRuns(dto.windowDays) : federadas;
    if (!evidencia) return undefined;
    const { porCliente: observado, truncado } = evidencia;
    const todos = await this.repository.screenClients();
    const clientes = todos.filter((code) => CLIENT_EVIDENCE[code] === dto.systemCode);
    const resumen: Record<string, { total: number; verified: number }> = {};
    const sinCatalogar: string[] = [];
    let conTrafico = 0;

    for (const clientCode of clientes) {
      const pantallas = await this.repository.screensOfClient(clientCode);
      // Sólo lo que ESE cliente declaró: `/` existe en los cinco portales y `/login` en tres, así
      // que cruzar el tráfico de todos contra las plantillas de cada uno marcaría verificadas las
      // cinco de golpe.
      const { porPlantilla, sinCatalogar: suyas } = matchScreenRuns(
        observado.get(clientCode) ?? new Map(),
        pantallas.map((pantalla) => pantalla.route),
      );
      sinCatalogar.push(...suyas.map((ruta) => `${clientCode} ${ruta}`));
      conTrafico += porPlantilla.size;
      resumen[clientCode] = { total: pantallas.length, verified: porPlantilla.size };

      for (const [route, runs] of porPlantilla) {
        const outcome = screenVerificationFrom(runs, source);
        if (outcome) await this.repository.applyScreenVerification(clientCode, route, outcome, tx);
      }
      // Degradar sólo con ventana propia y completa: si la consulta vino cortada no se sabe si una
      // pantalla falta por no usarse o por el tope, y con un contador de proceso, tampoco.
      if (conVentana && !truncado) await this.repository.resetScreensNotSeen(clientCode, [...porPlantilla.keys()], tx);
    }

    // Clientes que declararon origen y NO están en el catálogo de pantallas: `x-atlas-product` la
    // mandan también backends («erp», «flows-loader») con otro vocabulario.
    const desconocidos = [...observado.keys()].filter((code) => code !== SIN_CLIENTE && !todos.includes(code));

    return {
      evidence: conVentana ? 'window' : 'process',
      screensWithRuns: conTrafico,
      screensWithoutClient: observado.get(SIN_CLIENTE)?.size ?? 0,
      unknownClients: desconocidos.slice(0, 10),
      truncated: truncado,
      byClient: resumen,
      // Clientes cuyo origen no guarda este bloque: aquí ni se verifican ni se degradan.
      notMeasuredHere: todos.filter((code) => !clientes.includes(code)),
      uncatalogued: sinCatalogar.slice(0, 20),
    };
  }

  /**
   * Pantallas cuya puerta declarada en el menú NO es la que aplica la API.
   *
   * La primera versión preguntaba «¿el endpoint tiene permiso fino?» y llamaba a eso estar
   * desprotegido. No lo es: `RolesGuard` es global y `@Roles(...)` deniega igual. De 1 029 flujos,
   * 995 no tienen permiso fino pero 914 sí tienen roles, así que el 92 % de aquellos hallazgos era
   * falso —incluido el único que produjo con tráfico real—. Una lista donde casi todo es ruido no
   * la lee nadie, que es justo el fallo que este proyecto lleva persiguiendo.
   *
   * Las clases se separan porque piden acciones distintas de personas distintas; sólo las de
   * `BREAKING_SEVERITIES` dejan a un usuario fuera. Además de las llamadas observadas, se listan los menús
   * y endpoints que piden un permiso que la base no tiene: ese 403 es para todos y no espera al tráfico.
   * Ver `RBAC_DRIFT_SQL` y `system-flows.rbac-drift.ts`.
   */
  async rbacDrift(query: Partial<RbacDriftQueryDto> = {}) {
    const [filas, catalogo, menus, conPermiso] = await Promise.all([
      this.repository.rbacDrift(),
      this.repository.rbacCatalogPermissions(),
      this.repository.menusWithPermissions(CLIENTES_DEL_CATALOGO),
      this.repository.flowsWithPermissions(),
    ]);
    const porPantalla = new Map<
      string,
      { clientCode: string; route: string; navPermissions: string[]; navRoles: string[]; calls: DriftCall[] }
    >();
    for (const fila of filas) {
      const call = classifyCall(fila, catalogo);
      // Un endpoint con permiso fino que el menú ya pide y que la base tiene está bien: no es deriva.
      if (!call) continue;
      const clave = `${fila.client_code} ${fila.route}`;
      const entrada = porPantalla.get(clave) ?? {
        clientCode: fila.client_code,
        route: fila.route,
        navPermissions: fila.nav_permissions,
        navRoles: fila.nav_roles,
        calls: [],
      };
      entrada.calls.push(call);
      porPantalla.set(clave, entrada);
    }
    const screens = [...porPantalla.values()];
    // Una fila por hallazgo: es lo que el portal enseña y lo que se busca, filtra y pagina.
    const llamadas: DriftItem[] = screens.flatMap((pantalla) =>
      pantalla.calls.map((call) => ({
        clientCode: pantalla.clientCode,
        route: pantalla.route,
        navPermissions: pantalla.navPermissions,
        navRoles: pantalla.navRoles,
        ...call,
      })),
    );
    const vistos = new Set(llamadas.map((llamada) => llamada.flowId).filter((id): id is string => Boolean(id)));
    const todos = [
      ...llamadas,
      ...menuItemsOutsideCatalog(menus, catalogo),
      ...endpointItemsOutsideCatalog(conPermiso, catalogo, vistos),
    ].sort(byGravity);
    const filtradas = todos.filter(
      (item) =>
        (!query.severity || item.severity === query.severity) &&
        (!query.clientCode || item.clientCode === query.clientCode) &&
        containsText(
          query.q,
          item.clientCode,
          item.route,
          item.method,
          item.path,
          item.flowId,
          ...item.permissions,
          ...item.navPermissions,
        ),
    );
    const { items, meta } = slicePage(filtradas, query.page ?? 1, query.limit);
    // Las cifras son del conjunto SIN filtrar: filtrar la tabla no debe cambiar cuántas hay en total.
    const summary = summarizeDrift(todos);
    const [consideradas, conPuertaDeMenu] = await Promise.all([
      this.repository.screensWithObservedRoutes(CLIENTES_CON_DERIVA),
      this.repository.clientsWithMenuGates(),
    ]);
    return {
      // Clientes cuyo MENÚ filtra por permiso o rol y cuya deriva no se mide. Un cliente sin puerta de menú
      // no tiene deriva posible, y listarlo dejaba la compuerta en rojo por algo que no existe.
      notMeasured: conPuertaDeMenu.filter((code) => !CLIENTES_CON_DERIVA.includes(code)),
      // El denominador, que en la primera versión era un booleano constante: sin él, un `[]` no se
      // distingue de «nadie ha abierto ninguna pantalla todavía».
      screensWithObservedEdges: consideradas,
      // Sin catálogo RBAC en la base no se afirma que falte ningún permiso: faltarían todos.
      catalogMeasured: catalogo !== null,
      // Si la consulta de deriva llegó a su tope, esto opina sobre datos incompletos y hay que decirlo.
      truncated: filas.length >= RBAC_DRIFT_LIMIT,
      screens,
      items,
      meta,
      summary,
    };
  }
}
