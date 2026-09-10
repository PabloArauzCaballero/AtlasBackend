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
import { CLIENT_EVIDENCE, type PantallasObservadas } from './system-flows.evidence.js';

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
   * Los tres desenlaces se separan porque piden acciones distintas de personas distintas, y sólo el
   * primero es una avería. Ver `RBAC_DRIFT_SQL`.
   */
  async rbacDrift() {
    const { porCliente, truncado } = await this.repository.screenRuns(30);
    const filas = await this.repository.rbacDrift();
    const porPantalla = new Map<
      string,
      { clientCode: string; route: string; navPermissions: string[]; navRoles: string[]; calls: unknown[] }
    >();
    for (const fila of filas) {
      const clave = `${fila.client_code} ${fila.route}`;
      const entrada = porPantalla.get(clave) ?? {
        clientCode: fila.client_code,
        route: fila.route,
        navPermissions: fila.nav_permissions,
        navRoles: fila.nav_roles,
        calls: [],
      };
      entrada.calls.push({
        flowId: fila.flow_id,
        method: fila.method,
        path: fila.path,
        severity: severidad(fila),
        roles: fila.roles,
      });
      porPantalla.set(clave, entrada);
    }
    // Sólo clientes que mide ESTE bloque: ni el tráfico sin cliente ni códigos que el catálogo no tiene
    // («erp», «flows-loader») son pantallas sobre las que se pueda opinar. Siguen siendo rutas concretas.
    const consideradas = [...porCliente.entries()]
      .filter(([cliente]) => CLIENT_EVIDENCE[cliente] === 'ATLAS_BACKEND')
      .reduce((n, [, pantallas]) => n + pantallas.size, 0);
    const todos = await this.repository.screenClients();
    return {
      // La deriva se mide contra los endpoints de ESTE backend y lo que se llamó en sus logs. Las
      // pantallas de clientes que declaran su origen a otro bloque no entran, y se dice: una lista
      // vacía para ellas no significaría «sin deriva».
      notMeasured: todos.filter((code) => CLIENT_EVIDENCE[code] !== 'ATLAS_BACKEND'),
      // El denominador, que en la primera versión era un booleano constante: sin él, un `[]` no se
      // distingue de «nadie ha abierto ninguna pantalla todavía».
      screensWithObservedEdges: consideradas,
      // Si el catálogo observado vino cortado, esto opina sobre datos incompletos y hay que decirlo.
      truncated: truncado,
      screens: [...porPantalla.values()].filter((pantalla) => pantalla.calls.length),
    };
  }
}

/**
 * Qué clase de desajuste es. Sólo `SIN_GUARDA` es una avería; los otros dos son otra conversación.
 */
function severidad(fila: { is_public: boolean; roles: string[] }): 'PUBLIC' | 'SOLO_ROL' | 'SIN_GUARDA' {
  if (fila.is_public) return 'PUBLIC';
  return fila.roles.length ? 'SOLO_ROL' : 'SIN_GUARDA';
}
