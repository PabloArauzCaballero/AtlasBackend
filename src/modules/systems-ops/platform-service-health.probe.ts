/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { env } from '../../config/env.js';
import { SystemsHealthStatus } from './systems-ops.dtos.js';

type ProbeResult = Pick<SystemsHealthStatus, 'checkType' | 'isHealthy' | 'healthMessage'>;

type ServiceProbeConfig = {
  label: string;
  baseUrl: string | undefined;
  healthPath: string;
  timeoutMs: number;
  /** Qué se pierde si no responde. Va en el mensaje para que el operador no tenga que deducirlo. */
  degradation: string;
};

/**
 * Servicios del ecosistema que se comprueban por HTTP, no por conexión de base ni por tabla.
 *
 * La configuración se lee de `env` en cada llamada a propósito: `getToolsHealth` corre bajo demanda
 * desde el panel, no en el arranque, y leerla aquí evita capturar en un módulo un valor que el
 * despliegue puede haber cambiado.
 */
function probeConfigFor(code: string): ServiceProbeConfig | null {
  if (code === 'DECISION_ENGINE') {
    return {
      label: 'El motor de decisión',
      // La integración real manda; si no la hay, la dirección de sólo-observabilidad.
      baseUrl: env.DECISION_ENGINE_BASE_URL ?? env.DECISION_ENGINE_HEALTH_BASE_URL,
      healthPath: env.DECISION_ENGINE_HEALTH_PATH,
      timeoutMs: env.DECISION_ENGINE_TIMEOUT_MS,
      degradation: 'la decisión de crédito cae a revisión manual (nunca a aprobación automática)',
    };
  }
  if (code === 'ERP_BACKEND') {
    return {
      label: 'El ERP',
      baseUrl: env.ERP_BACKEND_BASE_URL,
      healthPath: env.ERP_BACKEND_HEALTH_PATH,
      timeoutMs: env.ERP_BACKEND_TIMEOUT_MS,
      degradation: 'sólo se pierde visibilidad: Atlas no consume su API y no se degrada',
    };
  }
  return null;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * Comprueba por HTTP la salud de un servicio hermano del ecosistema.
 *
 * Devuelve `null` cuando el código no es uno de ellos, para que quien llama siga con sus otros
 * chequeos. Los tres desenlaces posibles se distinguen a propósito, porque exigen acciones
 * distintas: sin dirección configurada es un hueco de despliegue (CONFIGURATION), un HTTP no-2xx es
 * el servicio contestando mal, y un fallo de red es el servicio sin contestar.
 */
export async function probePlatformService(code: string): Promise<ProbeResult | null> {
  const config = probeConfigFor(code);
  if (!config) return null;

  if (!config.baseUrl) {
    return {
      checkType: 'CONFIGURATION',
      isHealthy: false,
      healthMessage: `${config.label} no tiene dirección configurada en este despliegue, así que no se puede comprobar su salud. No es lo mismo que estar caído: nadie ha dicho dónde buscarlo.`,
    };
  }

  const url = joinUrl(config.baseUrl, config.healthPath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    const elapsed = Date.now() - startedAt;
    if (!response.ok) {
      return {
        checkType: 'LIVE',
        isHealthy: false,
        healthMessage: `${config.label} respondió HTTP ${response.status} en ${url} (${elapsed} ms). Está en pie pero su healthcheck no da por buena su propia salud; ${config.degradation}.`,
      };
    }
    return {
      checkType: 'LIVE',
      isHealthy: true,
      healthMessage: `${config.label} respondió HTTP ${response.status} en ${elapsed} ms desde ${url}.`,
    };
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const motivo =
      error instanceof Error && error.name === 'AbortError'
        ? `no respondió en ${config.timeoutMs} ms`
        : `no se pudo contactar (${error instanceof Error ? error.message : 'error desconocido'})`;
    return {
      checkType: 'LIVE',
      isHealthy: false,
      healthMessage: `${config.label} ${motivo} en ${url} tras ${elapsed} ms; ${config.degradation}.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
