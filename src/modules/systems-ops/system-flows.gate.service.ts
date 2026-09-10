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

export type GateCheck = { code: string; passed: boolean; count: number; detail: string };

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
    const [criticos, desprotegidas, pendientes, cargas, deriva] = await Promise.all([
      this.repository.criticalNotCertified(),
      this.repository.openFindingsOfKind('UNPROTECTED_WRITE'),
      this.repository.pendingHighReviews(),
      this.repository.importedScopes(),
      this.screens.rbacDrift(),
    ]);
    const checks: GateCheck[] = [
      comprobacionCriticos(criticos),
      {
        code: 'UNPROTECTED_WRITE_OPEN',
        passed: desprotegidas === 0,
        count: desprotegidas,
        detail: 'hallazgos UNPROTECTED_WRITE abiertos: escrituras sin guarda de autorización',
      },
      comprobacionDeriva(deriva),
      {
        code: 'REVIEW_PENDING_HIGH',
        passed: pendientes === 0,
        count: pendientes,
        detail: 'flujos de riesgo alto pendientes de revisión humana',
      },
      comprobacionArtefactos(cargas),
    ];
    return { passed: checks.every((check) => check.passed), evaluatedAt: new Date(), checks };
  }
}

function comprobacionCriticos(filas: Array<{ systemCode: string; count: number }>): GateCheck {
  const total = filas.reduce((n, fila) => n + Number(fila.count), 0);
  const porBloque = filas.map((fila) => `${fila.systemCode} ${fila.count}`).join(', ');
  return {
    code: 'CRITICAL_VERIFIED',
    passed: total === 0,
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
      count: 0,
      detail: 'sin uso observado de pantallas: no se puede afirmar que no haya llamadas sin guarda',
    };
  }
  return {
    code: 'RBAC_DRIFT_SIN_GUARDA',
    passed: sinGuarda === 0 && !deriva.truncated,
    count: sinGuarda,
    detail: deriva.truncated
      ? 'llamadas sin guarda sobre una consulta cortada: la cifra puede quedarse corta'
      : 'llamadas desde pantallas a endpoints sin permiso ni rol',
  };
}

function comprobacionArtefactos(cargas: Set<string>): GateCheck {
  const faltan = [
    ...BLOQUES.filter((bloque) => !cargas.has(`endpoints:${bloque}`)).map((bloque) => `endpoints de ${bloque}`),
    ...CLIENTES.filter((cliente) => !cargas.has(`screens:${cliente}`)).map((cliente) => `pantallas de ${cliente}`),
  ];
  return {
    code: 'ARTIFACTS_PRESENT',
    passed: faltan.length === 0,
    count: faltan.length,
    detail: faltan.length ? `falta cargar: ${faltan.join(', ')}` : 'artefacto cargado para los cuatro bloques y los cinco clientes',
  };
}
