import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { env } from '../../config/env.js';
import { buildEndpointCode, moduleFromPath, routeNameFromMethodAndPath } from './endpoint-code.util.js';
import { SystemsCatalogClassifierService } from './systems-catalog-classifier.service.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { EndpointSeed } from './systems-ops.types.js';

const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Options|Head)\(([^)]*)\)([\s\S]*?)(?:\n\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\()/g;
const CONTROLLER_DECORATOR = /@Controller\(([^)]*)\)[\s\S]*?export\s+class\s+([A-Za-z0-9_]+)\s*\{/g;

export type DiscoveredEndpoint = EndpointSeed & {
  controllerName: string | null;
  handlerName: string | null;
};

const ROLE_CONSTANTS: Record<string, string[]> = {
  SYSTEMS_OPS_ROLES: [
    'system_admin',
    'platform_admin',
    'admin',
    'qa_engineer',
    'devops',
    'risk_analyst',
    'compliance_analyst',
    'readonly_auditor',
  ],
  SYSTEMS_OPS_GOVERNANCE_ROLES: ['system_admin', 'platform_admin'],
  SYSTEMS_OPS_QA_ROLES: ['system_admin', 'platform_admin', 'qa_engineer'],
  SYSTEMS_OPS_STRESS_ROLES: ['system_admin', 'platform_admin', 'qa_engineer', 'devops'],
};

function methodDecoratorBlock(classBlock: string, routeIndex: number): string {
  const beforeRoute = classBlock.slice(0, routeIndex);
  const previousMethodEnd = Math.max(beforeRoute.lastIndexOf('\n  }'), beforeRoute.lastIndexOf('\n}'));
  return beforeRoute.slice(previousMethodEnd + 1);
}

function rolesFromDecorators(decorators: string): string[] {
  const rolesCall = decorators.match(/@Roles\(([^)]*)\)/s)?.[1];
  if (!rolesCall) return [];
  const roles = [...rolesCall.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const constant of rolesCall.matchAll(/\.\.\.([A-Z0-9_]+)/g)) roles.push(...(ROLE_CONSTANTS[constant[1]] ?? []));
  return [...new Set(roles)];
}

function isRoutePublic(classBlock: string, routeIndex: number, decoratorsAfterRoute: string): boolean {
  if (decoratorsAfterRoute.includes('@Public()')) return true;
  const publicIndex = classBlock.lastIndexOf('@Public()', routeIndex);
  if (publicIndex < 0) return false;
  const between = classBlock.slice(publicIndex + '@Public()'.length, routeIndex);
  return !/@(Get|Post|Put|Patch|Delete|Options|Head)\(/.test(between);
}

function decoratorPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '') return '';
  const match = trimmed.match(/['"`]([^'"`]*)['"`]/);
  return match?.[1] ?? '';
}

function joinPaths(...parts: string[]): string {
  const normalized = parts
    .map((part) => part.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .join('/');
  return `/${normalized}`;
}

function endpointBusinessContext(method: string, path: string, handlerName: string | null) {
  const normalized = path.toLowerCase();
  const action = handlerName ?? `${method} ${path}`;
  if (/risk|score|assessment|decision/.test(normalized)) {
    return {
      businessPurpose: `Ejecuta una operación relacionada con riesgo/scoring (${action}). Debe explicar qué datos leyó, qué versión de reglas/modelo usó y qué resultado produjo para que el comité de riesgo pueda auditar decisiones.`,
      businessValue: 'Permite aprobar, rechazar, escalar o monitorear decisiones de crédito/fraude con evidencia reconstruible.',
      auditStrategy:
        'Registrar actor, requestId, sujeto evaluado, feature snapshot, ruleset/model version, reglas disparadas, resultado, razones y latencia sin exponer PII innecesaria.',
      decisionUseCases: [
        'asignación de línea',
        'revisión manual',
        'monitoreo de cartera',
        'calibración de reglas',
        'auditoría de decisiones',
      ],
    };
  }
  if (/fraud|watchlist|manual-review/.test(normalized)) {
    return {
      businessPurpose: `Gestiona investigación, listas o revisión antifraude (${action}). Debe conectar evidencia, dispositivo, cliente, caso y resultado operativo.`,
      businessValue: 'Reduce pérdidas, abuso multi-cuenta, identidad falsa y exposición operativa frente a comercios.',
      auditStrategy:
        'Registrar apertura/cierre de caso, motivo, evidencia, usuario interno responsable, cambios de estado y decisión final.',
      decisionUseCases: ['bloqueo preventivo', 'escalamiento a analista', 'rehabilitación', 'retroalimentación de reglas antifraude'],
    };
  }
  if (/consent|privacy|data-subject|retention/.test(normalized)) {
    return {
      businessPurpose: `Administra consentimiento, privacidad o derechos del titular (${action}). Debe demostrar finalidad, versión legal, canal y vigencia del tratamiento.`,
      businessValue: 'Permite operar con privacidad por diseño y reducir riesgo legal al escalar a nuevos mercados.',
      auditStrategy:
        'Registrar versión de documento, finalidad, estado granted/revoked, canal, sesión, IP, dispositivo y usuario interno si aplica.',
      decisionUseCases: [
        'habilitar procesamiento permitido',
        'bloquear uso no autorizado',
        'responder auditoría legal',
        'gestionar solicitudes de titular',
      ],
    };
  }
  if (/customer|identity|kyc|contact|address|evidence/.test(normalized)) {
    return {
      businessPurpose: `Opera identidad, perfil, contacto o evidencia del cliente (${action}). Debe sostener KYC, contactabilidad, soporte y trazabilidad de cambios.`,
      businessValue: 'Permite saber quién es el cliente, cómo contactarlo y qué evidencia respalda su elegibilidad.',
      auditStrategy:
        'Registrar origen del dato, versión, validación, evidencia, hashes/cifrado, usuario/servicio que cambió estado y timestamps.',
      decisionUseCases: ['onboarding', 'validación KYC', 'soporte operativo', 'resolución de disputas', 'calidad de datos'],
    };
  }
  if (/device|session|auth|telemetry|sim|ip/.test(normalized)) {
    return {
      businessPurpose: `Captura o consulta señales técnicas de sesión/dispositivo (${action}). Debe servir para seguridad, abuso, continuidad de sesión y señales tempranas de fraude.`,
      businessValue:
        'Permite detectar dispositivos reutilizados, VPN/proxy, SIM swap, sesiones anómalas y patrones de riesgo antes de la mora.',
      auditStrategy:
        'Registrar fingerprint, versión, sesión, IP, canal, app version, estado de autenticación y vínculos con cliente cuando exista.',
      decisionUseCases: ['detección de fraude temprano', 'seguridad de sesión', 'feature engineering', 'investigación de incidentes'],
    };
  }
  if (/system|operation|catalog|definition|quality|test|stress|health/.test(normalized)) {
    return {
      businessPurpose: `Soporta gobierno interno, catálogo, QA o salud operativa (${action}). Debe hacer visible qué existe, cómo se prueba y qué impacto tiene.`,
      businessValue: 'Convierte el backend en plataforma gobernable, auditable y mantenible para escalar internacionalmente.',
      auditStrategy:
        'Registrar cambios de catálogo, ejecuciones de prueba, health checks, errores, actor, endpoint y entidades impactadas.',
      decisionUseCases: ['gobierno de datos', 'QA del portal', 'priorización técnica', 'auditoría interna', 'monitoreo operativo'],
    };
  }
  return {
    businessPurpose: `Endpoint detectado automáticamente (${action}). Requiere revisión funcional para cerrar propósito de negocio, payload, owner e impacto de datos.`,
    businessValue: 'Aporta capacidad operativa al backend Atlas; debe completarse en el catálogo antes de aprobarse para producción.',
    auditStrategy: 'Registrar requestId, actor, método, ruta, parámetros seguros, resultado y side effects detectados.',
    decisionUseCases: ['operación del portal', 'soporte', 'auditoría', 'diagnóstico técnico'],
  };
}

function endpointPayloadSummary(method: string, path: string) {
  const hasPathParams = /:[A-Za-z0-9_]+/.test(path);
  const normalized = path.toLowerCase();
  const bodyExpected = method !== 'GET' && method !== 'DELETE';
  return {
    inputPayloadContract: {
      body: bodyExpected
        ? { inferred: true, reviewRequired: true, reason: 'Endpoint de escritura; validar DTO/Zod y documentar campos obligatorios.' }
        : {},
      query: /page|catalog|list|search|queue|report|history|mine/.test(normalized)
        ? { page: 'number?', limit: 'number?', filters: 'object?' }
        : {},
      path: hasPathParams ? { inferredFromRoute: path.match(/:[A-Za-z0-9_]+/g)?.map((value) => value.slice(1)) ?? [] } : {},
      headers: { authorization: 'Bearer JWT cuando no sea público', 'x-request-id': 'opcional para trazabilidad' },
    },
    payloadOriginSummary: bodyExpected
      ? 'Payload principal viene de body; filtros/paginación vienen de query; identificadores vienen de path; actor y tenant se derivan del JWT/contexto backend.'
      : 'Payload esperado principalmente por query/path/headers; actor y tenant se derivan del JWT/contexto backend.',
  };
}

@Injectable()
export class EndpointDiscoveryService {
  constructor(
    private readonly repository: SystemsCatalogRepository,
    private readonly classifier: SystemsCatalogClassifierService,
  ) {}

  async discoverAndMaybePersist(
    persist: boolean,
  ): Promise<{ discovered: number; persisted: number; deprecatedCandidates: number; items: DiscoveredEndpoint[] }> {
    const items = this.scanControllers();
    let persisted = 0;
    if (persist) {
      for (const item of items) {
        await this.repository.upsertEndpoint(item);
        persisted += 1;
      }
    }
    const activeKeys = new Set(items.map((item) => `${item.method} ${item.fullPath}`));
    const deprecatedCandidates = persist ? await this.repository.markDeprecatedCandidates(activeKeys) : 0;
    return { discovered: items.length, persisted, deprecatedCandidates, items };
  }

  scanControllers(): DiscoveredEndpoint[] {
    const root = join(process.cwd(), 'src', 'modules');
    if (!existsSync(root)) return [];
    const seen = new Set<string>();
    return this.walk(root)
      .filter((file) => file.endsWith('.controller.ts'))
      .flatMap((file) => this.scanControllerFile(file))
      .filter((item) => {
        const key = `${item.method} ${item.fullPath}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private scanControllerFile(file: string): DiscoveredEndpoint[] {
    const source = readFileSync(file, 'utf8');
    const controllers = [...source.matchAll(CONTROLLER_DECORATOR)];
    const endpoints: DiscoveredEndpoint[] = [];

    for (const [index, controller] of controllers.entries()) {
      const controllerPath = decoratorPath(controller[1] ?? '');
      const controllerName = controller[2] ?? null;
      const start = controller.index ?? 0;
      const end = controllers[index + 1]?.index ?? source.length;
      const classBlock = source.slice(start, end);

      for (const route of classBlock.matchAll(ROUTE_DECORATOR)) {
        const method = route[1].toUpperCase();
        const handlerName = route[4] ?? null;
        const apiPath = joinPaths(env.API_PREFIX, controllerPath, decoratorPath(route[2] ?? ''));
        const riskLevel = this.classifier.riskLevelForEndpoint(method, apiPath);
        const businessContext = endpointBusinessContext(method, apiPath, handlerName);
        const payloadSummary = endpointPayloadSummary(method, apiPath);
        const decorators = `${methodDecoratorBlock(classBlock, route.index ?? 0)}\n${route[3] ?? ''}`;
        const explicitRoles = rolesFromDecorators(decorators);
        const systemsController = classBlock.includes('@SystemsOpsControllerSecurity()');
        endpoints.push({
          code: buildEndpointCode(method, apiPath),
          module: moduleFromPath(apiPath),
          method,
          fullPath: apiPath,
          routeName: routeNameFromMethodAndPath(method, apiPath),
          businessPurpose: businessContext.businessPurpose,
          businessAction: handlerName ?? method,
          technicalPurpose: `Controller ${controllerName ?? 'desconocido'} handler ${handlerName ?? 'desconocido'} expone ${method} ${apiPath}.`,
          businessValue: businessContext.businessValue,
          auditStrategy: businessContext.auditStrategy,
          decisionUseCases: businessContext.decisionUseCases,
          inputPayloadContract: payloadSummary.inputPayloadContract,
          outputContract: {
            expectedStatusCodes: [method === 'POST' ? 201 : 200],
            envelope: 'Respuesta HTTP del backend Atlas; revisar OpenAPI para estructura final.',
          },
          payloadOriginSummary: payloadSummary.payloadOriginSummary,
          sideEffectsSummary:
            method === 'GET'
              ? 'Lectura esperada. No debería modificar estado salvo auditoría técnica de acceso.'
              : 'Escritura esperada. Debe registrar cambios de estado, auditoría, eventos internos y entidades impactadas cuando aplique.',
          metadataCompletenessScore: 82,
          expectedStatusCodes: [method === 'POST' ? 201 : 200],
          requiresAuth: !isRoutePublic(classBlock, route.index ?? 0, route[3] ?? ''),
          allowedRoles: explicitRoles.length > 0 ? explicitRoles : systemsController ? ROLE_CONSTANTS.SYSTEMS_OPS_ROLES : [],
          containsPii: this.classifier.containsPiiForEndpoint(apiPath),
          riskLevel,
          isDestructive: method === 'DELETE',
          isReadonly: method === 'GET',
          idempotencyRequired: method !== 'GET' && /decision|start|submit|package|run|retry|cancel|resolve|request/i.test(apiPath),
          requiresStressTest: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
          requiresIntegrationTest: riskLevel !== 'LOW',
          isTestableFromPortal: false,
          testEnvironmentOnly: true,
          detectedFrom: 'controller',
          confidenceLevel: 'HIGH',
          reviewStatus: 'AUTO_DETECTED',
          sourceFile: relative(process.cwd(), file),
          controllerName,
          handlerName,
        });
      }
    }
    return endpoints;
  }

  private walk(directory: string): string[] {
    const entries = readdirSync(directory).map((entry) => join(directory, entry));
    return entries.flatMap((entry) => (statSync(entry).isDirectory() ? this.walk(entry) : [entry]));
  }
}
