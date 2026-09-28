/**
 * @file Caso de uso de dominio: orquesta reglas y persistencia.
 * @business Esta pieza responde si se puede certificar la documentación de flujos hoy, y qué lo impide.
 * @system evalúa FLOW_DOCUMENTATION_GATE sobre el estado vivo del catálogo, comprobación por comprobación.
 */
import { Injectable } from '@nestjs/common';
import { SystemFlowsGateRepository } from './system-flows.gate.repository.js';
import { SystemFlowsScreensService } from './system-flows.screens.service.js';

/** Los bloques con endpoints y los clientes con pantallas que deben tener su artefacto cargado. */
export const BLOQUES = ['ATLAS_BACKEND', 'DECISION_ENGINE', 'ERP_BACKEND', 'DASHBOARDS'] as const;
export const CLIENTES = ['ADMIN_PORTAL', 'CONSUMER_APP', 'ERP_PORTAL', 'MOTOR_PORTAL', 'DASHBOARDS_PORTAL'] as const;

/**
 * `measured: false` quiere decir que la cifra no se pudo tomar porque falta cargar el artefacto del que depende. Una
 * comprobación sin medir NUNCA pasa: en un entorno recién desplegado el catálogo de flujos está vacío, y «0 CRITICAL sin
 * verificar» o «0 escrituras desprotegidas» salían en verde sin haber mirado nada.
 */
export type GateCheck = { code: string; passed: boolean; measured: boolean; count: number; detail: string };

/** Alcances que cada comprobación necesita cargados para que su cifra diga algo. */
const REQUIERE_ENDPOINTS = BLOQUES.map((bloque) => `endpoints:${bloque}`);
const REQUIERE_HALLAZGOS = BLOQUES.map((bloque) => `findings:${bloque}`);
const REQUIERE_PANTALLAS = CLIENTES.map((cliente) => `screens:${cliente}`);

/**
 * FLOW_DOCUMENTATION_GATE, tal como la define el plan: antes de certificar, todos los CRITICAL
 * verificados en el código certificado; sin escrituras desprotegidas ni deriva de permisos grave
 * abiertas; cola de revisión sin pendientes de riesgo alto; y el artefacto de cada bloque presente.
 *
 * Cada comprobación lleva su CIFRA, no sólo un sí o un no: «no se puede certificar» sin decir cuánto
 * falta es una respuesta que no se puede convertir en trabajo.
 */
@Injectable()
export class SystemFlowsGateService {
  constructor(
    private readonly repository: SystemFlowsGateRepository,
    private readonly screens: SystemFlowsScreensService,
  ) {}

  async evaluate() {
    const [criticos, desprotegidas, pendientes, cargas, deriva, sinCablear] = await Promise.all([
      this.repository.criticalNotCertified(),
      this.repository.openFindingsOfKind('UNPROTECTED_WRITE'),
      this.repository.unresolvedHighReviews(),
      this.repository.importedScopes(),
      this.screens.rbacDrift(),
      this.repository.unwiredProcessSteps(),
    ]);
    const checks: GateCheck[] = [
      sinMedirSiFalta(comprobacionCriticos(criticos), cargas, REQUIERE_ENDPOINTS),
      sinMedirSiFalta(
        {
          code: 'UNPROTECTED_WRITE_OPEN',
          passed: desprotegidas === 0,
          measured: true,
          count: desprotegidas,
          detail: 'hallazgos UNPROTECTED_WRITE abiertos: escrituras sin guarda de autorización',
        },
        cargas,
        REQUIERE_HALLAZGOS,
      ),
      sinMedirSiFalta(comprobacionDeriva(deriva), cargas, [...REQUIERE_ENDPOINTS, ...REQUIERE_PANTALLAS]),
      sinMedirSiFalta(
        {
          code: 'REVIEW_PENDING_HIGH',
          passed: pendientes === 0,
          measured: true,
          count: pendientes,
          detail: 'flujos de riesgo alto pendientes de revisión humana o rechazados (un rechazo dice que su análisis está mal)',
        },
        cargas,
        REQUIERE_ENDPOINTS,
      ),
      comprobacionArtefactos(cargas),
      // Sin los endpoints cargados, TODOS los pasos salen «sin pantalla»: la cifra acusaría a los procesos de algo que
      // sólo dice que el catálogo está vacío.
      sinMedirSiFalta(comprobacionProcesos(sinCablear), cargas, REQUIERE_ENDPOINTS),
    ];
    return {
      passed: checks.every((check) => check.passed),
      // Para que la pantalla distinga «no se puede certificar» de «en este entorno no se ha cargado nada que evaluar».
      artifactsLoaded: cargas.size > 0,
      evaluatedAt: new Date(),
      checks,
    };
  }
}

/**
 * Si falta cualquiera de los alcances de los que depende, la comprobación queda sin medir y no pasa. La cifra se conserva
 * (con carga parcial dice algo de lo cargado), pero el detalle avisa de que no cubre lo que falta.
 */
function sinMedirSiFalta(check: GateCheck, cargas: Set<string>, requiere: readonly string[]): GateCheck {
  const faltan = requiere.filter((alcance) => !cargas.has(alcance));
  if (!faltan.length) return check;
  const nada = faltan.length === requiere.length;
  return {
    ...check,
    passed: false,
    measured: false,
    detail: `sin medir: falta cargar ${faltan.map(alcanceLegible).join(', ')}${nada ? '' : ' (la cifra cubre sólo lo cargado)'} · ${check.detail}`,
  };
}

function alcanceLegible(alcance: string): string {
  const [scope, code] = alcance.split(':');
  const que = scope === 'endpoints' ? 'endpoints' : scope === 'findings' ? 'hallazgos' : 'pantallas';
  return `${que} de ${code}`;
}

function comprobacionCriticos(filas: Array<{ systemCode: string; count: number }>): GateCheck {
  const total = filas.reduce((n, fila) => n + Number(fila.count), 0);
  const porBloque = filas.map((fila) => `${fila.systemCode} ${fila.count}`).join(', ');
  return {
    code: 'CRITICAL_VERIFIED',
    passed: total === 0,
    measured: true,
    count: total,
    detail: `flujos CRITICAL sin verificar sobre su código actual${porBloque ? ` (${porBloque})` : ''}`,
  };
}

/**
 * Sin uso observado NO pasa. Una lista de deriva vacía porque nadie ha abierto una pantalla no dice
 * que no haya deriva: dice que no se ha podido mirar, y certificar sobre eso sería inventar un verde.
 */
function comprobacionDeriva(deriva: Awaited<ReturnType<SystemFlowsScreensService['rbacDrift']>>): GateCheck {
  const sinGuarda = deriva.screens.reduce(
    (n, pantalla) => n + pantalla.calls.filter((call) => (call as { severity?: string }).severity === 'SIN_GUARDA').length,
    0,
  );
  if (deriva.screensWithObservedEdges === 0) {
    return {
      code: 'RBAC_DRIFT_SIN_GUARDA',
      passed: false,
      measured: false,
      count: 0,
      detail: 'sin uso observado de pantallas: no se puede afirmar que no haya llamadas sin guarda',
    };
  }
  const noMedidos = deriva.notMeasured ?? [];
  const limites = [
    deriva.truncated ? 'la consulta vino cortada y la cifra puede quedarse corta' : null,
    // Los portales que llaman a otro bloque no entran en esta medida: afirmar que no tienen deriva sería
    // afirmar lo que no se ha podido mirar.
    noMedidos.length ? `no se mide para ${noMedidos.join(', ')}` : null,
  ].filter(Boolean);
  return {
    code: 'RBAC_DRIFT_SIN_GUARDA',
    passed: sinGuarda === 0 && limites.length === 0,
    measured: true,
    count: sinGuarda,
    detail: `llamadas desde pantallas a endpoints sin permiso ni rol, sobre ${deriva.screensWithObservedEdges} pantalla(s) con uso observado${limites.length ? ` · ${limites.join(' · ')}` : ''}`,
  };
}

function comprobacionArtefactos(cargas: Set<string>): GateCheck {
  const faltan = [
    ...BLOQUES.filter((bloque) => !cargas.has(`endpoints:${bloque}`)).map((bloque) => `endpoints de ${bloque}`),
    // Sin carga de hallazgos, «0 escrituras desprotegidas abiertas» no dice nada.
    ...BLOQUES.filter((bloque) => !cargas.has(`findings:${bloque}`)).map((bloque) => `hallazgos de ${bloque}`),
    ...CLIENTES.filter((cliente) => !cargas.has(`screens:${cliente}`)).map((cliente) => `pantallas de ${cliente}`),
  ];
  return {
    code: 'ARTIFACTS_PRESENT',
    passed: faltan.length === 0,
    measured: true,
    count: faltan.length,
    detail: faltan.length
      ? `falta cargar: ${faltan.join(', ')}`
      : 'endpoints y hallazgos de los cuatro bloques y pantallas de los cinco clientes cargados',
  };
}

/** Sexta comprobación (plan de procesos 2026-09-26): ningún paso de persona sin pantalla en procesos P0/P1. */
function comprobacionProcesos(filas: Array<{ workflowCode: string; count: number }>): GateCheck {
  const total = filas.reduce((n, f) => n + f.count, 0);
  return {
    code: 'PROCESS_STEPS_WIRED',
    passed: total === 0,
    measured: true,
    count: total,
    detail: total
      ? `pasos de personas sin pantalla en procesos P0/P1: ${filas.map((f) => `${f.workflowCode} (${f.count})`).join(', ')}`
      : 'todos los pasos de personas de los procesos P0/P1 tienen una pantalla que los llama',
  };
}
