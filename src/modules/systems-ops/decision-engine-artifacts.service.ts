/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza deja ver, desde el portal, qué política está decidiendo crédito ahora mismo.
 * @system cruza artefactos y despliegues del motor de decisión para exponer los que están activos.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import {
  ActiveArtifactReport,
  ActiveArtifactRow,
  artifactPageSchema,
  deploymentPageSchema,
  DecisionEngineArtifact,
  DecisionEngineDeployment,
} from './decision-engine-artifacts.types.js';

/**
 * Los artefactos ACTIVOS del motor de decisión, con el despliegue que los hace activos.
 *
 * ## Por qué esto vive en el portal y no sólo en la consola del motor
 *
 * «Qué política está decidiendo crédito ahora mismo» es la pregunta que abre cualquier
 * investigación sobre una aprobación o un rechazo, y hasta ahora sólo se podía contestar entrando
 * al motor. Desde el panel de Atlas —donde están el cliente, la solicitud y el log de la llamada—
 * no había forma de saber contra qué versión se decidió sin cambiar de producto y de sesión.
 *
 * ## Por qué se cruzan DOS listados y no basta con uno
 *
 * `/v1/artifacts` dice qué existe y en qué estado está su última versión; `/v1/deployments` dice
 * cuál está desplegado, en qué ambiente, desde cuándo y con qué reparto de tráfico. Un artefacto
 * «DEPLOYED_TO_PROD» cuyo despliegue fue superado sigue diciendo eso en su estado, así que fiarse
 * sólo del primero enseñaría como vigente una política que ya no decide nada. El despliegue ACTIVO
 * es la única fuente que responde «esto es lo que corre».
 *
 * ## Por qué nunca lanza
 *
 * Es una vista de observabilidad. Si el motor no responde, la pantalla debe decir «el motor no
 * responde» —con el motivo— y no romper el panel: el operador que la abre suele estar precisamente
 * investigando por qué el motor no responde.
 */
@Injectable()
export class DecisionEngineArtifactsService {
  private readonly logger = new Logger(DecisionEngineArtifactsService.name);

  /**
   * @param callerToken Sesión de quien abre la pantalla. Se reenvía porque el motor identifica a
   * quien pregunta verificando ese token contra este mismo backend: así la lectura queda auditada a
   * nombre de la persona y sujeta a SUS roles, no a los de una llave compartida por todo el panel.
   */
  async listActiveArtifacts(callerToken: string | null): Promise<ActiveArtifactReport> {
    const baseUrl = env.DECISION_ENGINE_BASE_URL ?? env.DECISION_ENGINE_HEALTH_BASE_URL;

    if (!baseUrl || !callerToken) {
      return {
        generatedAt: new Date().toISOString(),
        status: 'NOT_CONFIGURED',
        message: baseUrl
          ? 'La petición llegó sin sesión que reenviar al motor, y el motor identifica a quien pregunta por su ' + 'token de ATLAS.'
          : 'El motor de decisión no tiene dirección configurada en este despliegue, así que no hay a quién ' +
            'preguntarle por sus artefactos. No es lo mismo que no tener ninguno.',
        environmentFilter: env.DECISION_ENGINE_ENVIRONMENT_CODE ?? null,
        items: [],
      };
    }

    try {
      const [artifacts, deployments] = await Promise.all([
        this.fetchJson(baseUrl, env.DECISION_ENGINE_ARTIFACTS_PATH, callerToken, artifactPageSchema),
        this.fetchJson(baseUrl, `${env.DECISION_ENGINE_DEPLOYMENTS_PATH}?status=ACTIVE`, callerToken, deploymentPageSchema),
      ]);
      return {
        generatedAt: new Date().toISOString(),
        status: 'OK',
        message: `El motor reporta ${deployments.items.length} despliegue(s) activo(s) sobre ${artifacts.items.length} artefacto(s) catalogado(s).`,
        environmentFilter: env.DECISION_ENGINE_ENVIRONMENT_CODE ?? null,
        items: join(artifacts.items, deployments.items),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error desconocido';
      this.logger.warn(`No se pudieron leer los artefactos del motor: ${message}`);
      return {
        generatedAt: new Date().toISOString(),
        status: 'UNREACHABLE',
        message: `El motor de decisión no contestó a la consulta de artefactos: ${message}`,
        environmentFilter: env.DECISION_ENGINE_ENVIRONMENT_CODE ?? null,
        items: [],
      };
    }
  }

  private async fetchJson<T>(baseUrl: string, path: string, callerToken: string, schema: { parse(value: unknown): T }): Promise<T> {
    const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.DECISION_ENGINE_CATALOG_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        // Sin `x-tenant-id`: verificando el token, el motor toma el inquilino del perfil y no de una
        // cabecera — y ahí está la garantía de que quien llama no puede atribuirse uno ajeno.
        headers: { accept: 'application/json', authorization: `Bearer ${callerToken}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
      return schema.parse(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Une cada despliegue activo con el artefacto al que pertenece.
 *
 * El despliegue MANDA sobre el listado de artefactos: una fila existe porque hay algo desplegado,
 * no porque exista un artefacto con estado prometedor. Si el artefacto no aparece en el listado
 * —permisos, paginación, una carrera con una alta reciente— la fila se emite igual con lo que trae
 * el propio despliegue: enseñar «hay algo corriendo y no sé cómo se llama» es más útil, y más
 * honesto, que ocultar que hay algo corriendo.
 */
function join(artifacts: readonly DecisionEngineArtifact[], deployments: readonly DecisionEngineDeployment[]): ActiveArtifactRow[] {
  const byCode = new Map(artifacts.map((artifact) => [artifact.artifactCode, artifact]));

  return deployments.map((deployment) => {
    const code = deployment.artifactVersion?.artifact?.artifactCode ?? null;
    return toRow(deployment, code, code ? byCode.get(code) : undefined);
  });
}

function toRow(deployment: DecisionEngineDeployment, code: string | null, artifact: DecisionEngineArtifact | undefined): ActiveArtifactRow {
  return {
    deploymentId: deployment.id,
    ...identityOf(deployment, code, artifact),
    ...deploymentFieldsOf(deployment),
    trafficRules: trafficOf(deployment),
  };
}

/** Quién es el artefacto: nombre, tipo, dueño y versión desplegada. */
function identityOf(
  deployment: DecisionEngineDeployment,
  code: string | null,
  artifact: DecisionEngineArtifact | undefined,
): Pick<
  ActiveArtifactRow,
  'artifactCode' | 'artifactName' | 'artifactType' | 'ownerTeam' | 'versionNumber' | 'semanticVersion' | 'versionStatus' | 'lastValidatedAt'
> {
  const version = deployment.artifactVersion;
  return {
    artifactCode: code ?? '(desconocido)',
    artifactName: firstText(artifact?.name, version?.artifact?.name) ?? '(no reportado por el motor)',
    artifactType: firstText(artifact?.artifactType),
    ownerTeam: firstText(artifact?.ownerTeam),
    versionNumber: version?.versionNumber ?? null,
    semanticVersion: firstText(artifact?.latestVersion),
    // El estado de la VERSION DESPLEGADA, no el de la ultima del artefacto: se separan en cuanto
    // alguien empieza a trabajar en la siguiente, y el que decide es este.
    versionStatus: firstText(version?.status, artifact?.latestStatus),
    lastValidatedAt: firstText(artifact?.lastValidatedAt),
  };
}

/** Cuándo, dónde y por quién se puso a decidir. */
function deploymentFieldsOf(
  deployment: DecisionEngineDeployment,
): Pick<
  ActiveArtifactRow,
  'environmentCode' | 'deploymentStatus' | 'deploymentMode' | 'isActive' | 'effectiveFrom' | 'effectiveTo' | 'deployedBy' | 'deployedAt'
> {
  return {
    environmentCode: firstText(deployment.environment?.code) ?? deployment.environmentId,
    deploymentStatus: deployment.deploymentStatus,
    deploymentMode: deployment.deploymentMode,
    isActive: deployment.isActive,
    effectiveFrom: deployment.effectiveFrom,
    effectiveTo: firstText(deployment.effectiveTo),
    deployedBy: deployment.deployedBy,
    deployedAt: deployment.deployedAt,
  };
}

/**
 * Reparto de tráfico. Con más de una regla el artefacto NO decide el 100 % de los casos, y eso
 * cambia por completo cómo se lee cualquier métrica de resultado suya.
 */
function trafficOf(deployment: DecisionEngineDeployment): ActiveArtifactRow['trafficRules'] {
  const rules = deployment.traffic ?? [];
  return rules.map((rule) => ({
    segmentKey: firstText(rule.segmentKey),
    trafficPercentage: rule.trafficPercentage ?? null,
    priority: rule.priority ?? null,
  }));
}

/**
 * Primer valor presente, o `null`. Existe para que estas proyecciones no sean una cadena de `??`:
 * el motor devuelve el mismo dato en dos sitios según la ruta, y encadenarlos en cada campo
 * convertía la función en algo que el gate de complejidad rechazaba con razón.
 */
function firstText(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}
