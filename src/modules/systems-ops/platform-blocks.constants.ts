/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { env } from '../../config/env.js';

/**
 * Los BLOQUES del ecosistema ATLAS: las unidades por las que el portal agrupa catálogo y salud.
 *
 * ## Por qué existe este registro
 *
 * Hasta ahora «el catálogo» significaba, sin decirlo, «las tablas y rutas de Atlas Backend»: era el
 * único que se introspeccionaba a sí mismo. El motor de decisión y el ERP existían en el catálogo de
 * HERRAMIENTAS —se les tomaba el pulso— pero no en el de datos ni en el de endpoints, así que un
 * operador que abría «Catálogo de datos» veía un ecosistema de un solo producto y no tenía forma de
 * notar la ausencia. Este registro convierte esa suposición implícita en una lista explícita: si un
 * bloque está aquí y no aparece en el portal, es un fallo visible y con motivo, no un hueco mudo.
 *
 * ## Por qué la dirección se lee de `env` en cada llamada
 *
 * Igual que en `platform-service-health.probe.ts`: la federación y la salud corren bajo demanda
 * desde el panel, no en el arranque. Congelar la configuración en una constante de módulo
 * capturaría un valor que el despliegue puede haber cambiado, y el panel enseñaría el estado de una
 * dirección que ya nadie usa.
 *
 * ## Por qué Atlas Backend también es un bloque
 *
 * Porque si no lo fuera, el filtro «bloque» del portal tendría un valor implícito —«todo lo que no
 * dijo de quién era»— y las cuentas no cuadrarían con la suma de los bloques listados. Se
 * introspecciona a sí mismo en vez de federarse, y eso es lo único que lo distingue.
 */
export type PlatformBlockKind = 'SELF' | 'FEDERATED';

export interface PlatformBlockDefinition {
  /** Código estable. Es el valor que viaja en `system_code` y en el filtro `block` del portal. */
  readonly code: string;
  readonly name: string;
  readonly repository: string;
  readonly kind: PlatformBlockKind;
  /** Herramienta del catálogo que ya reporta su salud, para no tener dos verdades sobre el mismo servicio. */
  readonly toolCode: string | null;
  /** Qué se pierde cuando este bloque no responde. Va en el panel para que no haya que deducirlo. */
  readonly degradation: string;
  readonly purpose: string;
}

export const PLATFORM_BLOCKS: readonly PlatformBlockDefinition[] = [
  {
    code: 'ATLAS_BACKEND',
    name: 'ATLAS Backend',
    repository: 'AtlasBackend',
    kind: 'SELF',
    toolCode: null,
    degradation: 'es este mismo proceso: si no responde, no hay portal que consultar',
    purpose: 'Núcleo de clientes, crédito, riesgo, privacidad y gobierno de la plataforma.',
  },
  {
    code: 'DECISION_ENGINE',
    name: 'ATLAS Decision Engine',
    repository: 'AtlasDecisionEngineBackend',
    kind: 'FEDERATED',
    toolCode: 'DECISION_ENGINE',
    degradation: 'la decisión de crédito cae a revisión manual (nunca a aprobación automática)',
    purpose: 'Motor de políticas versionadas que decide crédito, riesgo y fraude.',
  },
  {
    code: 'ERP_BACKEND',
    name: 'ATLAS ERP Backend',
    repository: 'AtlasERPBackend',
    kind: 'FEDERATED',
    toolCode: 'ERP_BACKEND',
    degradation: 'sólo se pierde visibilidad: Atlas no consume su API y no se degrada',
    purpose: 'Backend de administración comercial, contabilidad, publicidad y facturación.',
  },
];

export const PLATFORM_BLOCK_CODES = PLATFORM_BLOCKS.map((block) => block.code);

export function platformBlockByCode(code: string): PlatformBlockDefinition | undefined {
  return PLATFORM_BLOCKS.find((block) => block.code === code);
}

/** Cómo se alcanza el manifiesto de un bloque federado, resuelto contra el entorno de HOY. */
export interface BlockManifestEndpointConfig {
  readonly baseUrl: string | undefined;
  readonly manifestPath: string;
  readonly timeoutMs: number;
  /** Cabecera y valor de la credencial. Sin valor, el bloque se reporta como NO CONFIGURADO. */
  readonly authHeader: string;
  readonly authValue: string | undefined;
  /** Cabeceras adicionales exigidas por el bloque remoto (el motor exige tenant). */
  readonly extraHeaders: Readonly<Record<string, string>>;
}

export function manifestConfigFor(code: string): BlockManifestEndpointConfig | null {
  if (code === 'DECISION_ENGINE') {
    return {
      // La integración real manda; si no la hay, la dirección de sólo-observabilidad. Es el mismo
      // orden que aplica la sonda de salud, para que salud y catálogo no discrepen sobre dónde vive
      // el motor: dos respuestas distintas a esa pregunta es peor que ninguna.
      baseUrl: env.DECISION_ENGINE_BASE_URL ?? env.DECISION_ENGINE_HEALTH_BASE_URL,
      manifestPath: env.DECISION_ENGINE_CATALOG_PATH,
      timeoutMs: env.DECISION_ENGINE_TIMEOUT_MS,
      authHeader: 'x-api-key',
      // El plano de GESTIÓN, no el de ejecución. Leer el mapa del motor es una operación de
      // gobierno; la llave que ejecuta decisiones no debe servir también para inventariarlo.
      authValue: env.DECISION_ENGINE_CATALOG_API_KEY ?? env.DECISION_ENGINE_OUTCOME_API_KEY,
      extraHeaders: { 'x-tenant-id': env.DECISION_ENGINE_TENANT_ID },
    };
  }
  if (code === 'ERP_BACKEND') {
    return {
      baseUrl: env.ERP_BACKEND_BASE_URL,
      manifestPath: env.ERP_BACKEND_CATALOG_PATH,
      timeoutMs: env.ERP_BACKEND_TIMEOUT_MS,
      authHeader: 'x-platform-catalog-key',
      authValue: env.ERP_BACKEND_CATALOG_API_KEY,
      extraHeaders: {},
    };
  }
  return null;
}
