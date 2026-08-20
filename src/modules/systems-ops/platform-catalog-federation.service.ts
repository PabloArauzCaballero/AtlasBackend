/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system trae el manifiesto de cada bloque del ecosistema y lo refleja en el catálogo unificado.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_BLOCKS, platformBlockByCode } from './platform-blocks.constants.js';
import { PlatformCatalogFederationClient } from './platform-catalog-federation.client.js';
import { PlatformCatalogFederationRepository } from './platform-catalog-federation.repository.js';
import { CatalogManifest, FederationOutcome } from './platform-catalog-manifest.types.js';

/** Niveles de riesgo que admite el catálogo. Lo que llegue fuera de la lista se degrada, no se cuela. */
const RISK_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * Refleja en ESTE catálogo lo que cada bloque federado dice de sí mismo.
 *
 * ## Por qué se copia en vez de consultar en vivo
 *
 * El portal filtra, pagina, ordena y cruza el catálogo con revisiones, dueños y narrativa de
 * gobierno que sólo existen aquí. Resolver eso pidiéndole la lista al otro backend en cada pantalla
 * ataría la usabilidad del panel a la latencia —y a la disponibilidad— de un tercero: con el ERP
 * caído, el catálogo entero dejaría de paginar. Copiar significa que el panel sigue contestando y
 * el bloque aparece marcado con la fecha de su última federación, que es información honesta.
 *
 * ## Qué se importa y qué NO se toca
 *
 * Se importa lo estructural —ruta, verbo, módulo, tabla, columnas, clasificación inferida— y se
 * marca con `detectedFrom: 'block_manifest'` y confianza MEDIA. Lo GOBERNADO (dueño, revisión,
 * narrativa) no se sobreescribe nunca: si una persona revisó y aprobó una tabla del ERP, la
 * siguiente federación no puede devolverla a «auto detectado» y borrar ese trabajo.
 */
@Injectable()
export class PlatformCatalogFederationService {
  private readonly logger = new Logger(PlatformCatalogFederationService.name);

  constructor(
    private readonly client: PlatformCatalogFederationClient,
    private readonly repository: PlatformCatalogFederationRepository,
  ) {}

  /**
   * Federa todos los bloques que no son este backend. Nunca lanza: cada bloque reporta su desenlace.
   *
   * `callerToken` es la sesión de quien pulsó el botón, y se reenvía a los bloques que tratan a este
   * backend como su proveedor de identidad. Así el motor audita a la PERSONA que pidió el catálogo y
   * aplica sus roles, en vez de ver una llave de servicio compartida por todo el que entre al panel.
   */
  async federateAll(callerToken: string | null): Promise<FederationOutcome[]> {
    const targets = PLATFORM_BLOCKS.filter((block) => block.kind === 'FEDERATED');
    const outcomes: FederationOutcome[] = [];
    for (const block of targets) outcomes.push(await this.federateBlock(block.code, callerToken));
    return outcomes;
  }

  async federateBlock(systemCode: string, callerToken: string | null): Promise<FederationOutcome> {
    const definition = platformBlockByCode(systemCode);
    if (!definition || definition.kind !== 'FEDERATED') {
      const outcome = failure(systemCode, 'ERROR', `${systemCode} no es un bloque federable de este ecosistema.`);
      await this.repository.recordOutcome(outcome);
      return outcome;
    }

    const result = await this.client.fetchManifest(systemCode, callerToken);
    if (!result.ok) {
      const outcome = failure(systemCode, result.status, result.message);
      await this.repository.recordOutcome(outcome);
      this.logger.warn(`Federación de ${systemCode}: ${result.status} — ${result.message}`);
      return outcome;
    }

    const outcome = await this.ingest(systemCode, result.manifest);
    await this.repository.recordOutcome(outcome);
    this.logger.log(`Federación de ${systemCode}: ${outcome.endpointsImported} endpoints y ${outcome.dataEntitiesImported} entidades.`);
    return outcome;
  }

  private async ingest(systemCode: string, manifest: CatalogManifest): Promise<FederationOutcome> {
    const now = new Date();
    const service = manifest.block.service ?? systemCode.toLowerCase();

    await this.ingestEndpoints(systemCode, manifest, service, now);
    await this.ingestDataEntities(systemCode, manifest, service, now);

    await this.repository.deprecateMissingEndpoints(
      systemCode,
      manifest.endpoints.map((endpoint) => endpoint.code),
    );
    await this.repository.deprecateMissingDataEntities(
      systemCode,
      manifest.dataEntities.map((entity) => `${entity.schemaName}.${entity.tableName}`),
    );

    return {
      systemCode,
      status: 'OK',
      message: `${manifest.block.name} respondió con ${manifest.endpoints.length} endpoints y ` + `${manifest.dataEntities.length} tablas.`,
      endpointsImported: manifest.endpoints.length,
      dataEntitiesImported: manifest.dataEntities.length,
      remoteVersion: manifest.block.version ?? null,
      remoteCommit: manifest.block.commit ?? null,
    };
  }

  private async ingestEndpoints(systemCode: string, manifest: CatalogManifest, service: string, now: Date): Promise<void> {
    for (const endpoint of manifest.endpoints) {
      await this.repository.upsertEndpointRow(
        {
          code: endpoint.code,
          systemCode,
          backendService: service,
          module: endpoint.module,
          controllerName: endpoint.controllerName ?? null,
          handlerName: endpoint.handlerName ?? null,
          method: endpoint.method.toUpperCase(),
          routePath: endpoint.fullPath,
          fullPath: endpoint.fullPath,
          routeName: `${endpoint.method.toUpperCase()} ${endpoint.fullPath}`,
          businessPurpose: endpoint.summary?.trim() || `${endpoint.method.toUpperCase()} ${endpoint.fullPath}`,
          requiresAuth: endpoint.requiresAuth,
          allowedRoles: endpoint.allowedRoles,
          riskLevel: normalizeRisk(endpoint.riskLevel),
          isDestructive: endpoint.isDestructive,
          isReadonly: endpoint.isReadonly,
          // Nunca probable desde el portal: el ejecutor de pruebas de este backend sólo habla con su
          // propio host permitido. Marcarlo `true` ofrecería un botón que siempre falla.
          isTestableFromPortal: false,
          detectedFrom: 'block_manifest',
          updatedAtValue: now,
        },
        {
          ownerTeam: `${systemCode.toLowerCase()}-team`,
          status: 'ACTIVE',
          confidenceLevel: 'MEDIUM',
          reviewStatus: 'AUTO_DETECTED',
          version: manifest.block.version ?? 'unknown',
          createdAtValue: now,
          // Lo que el manifiesto NO dice. Van vacíos y no con un valor plausible: escribir `[200]`
          // en los códigos esperados sería afirmar un contrato que nadie declaró, y el catálogo
          // dejaría de distinguir «el bloque dijo que devuelve 200» de «nadie lo ha mirado». Al ser
          // `insertOnly`, lo que un revisor complete aquí sobrevive a las federaciones siguientes.
          expectedStatusCodes: [],
          minPayloadSchema: {},
          queryParamsSchema: {},
          pathParamsSchema: {},
          headersSchema: {},
          containsPii: false,
          piiFields: [],
          idempotencyRequired: false,
          requiresStressTest: false,
          requiresIntegrationTest: false,
          testEnvironmentOnly: false,
        },
      );
    }
  }

  private async ingestDataEntities(systemCode: string, manifest: CatalogManifest, service: string, now: Date): Promise<void> {
    for (const entity of manifest.dataEntities) {
      await this.repository.upsertDataEntityRow(
        {
          systemCode,
          schemaName: entity.schemaName,
          tableName: entity.tableName,
          entityName: entity.entityName,
          module: entity.module,
          sourceSystem: service,
          detectedFrom: 'block_manifest',
          updatedAtValue: now,
        },
        {
          businessPurpose: entity.businessPurpose?.trim() || `Tabla ${entity.schemaName}.${entity.tableName} del bloque ${systemCode}.`,
          dataOwner: `${systemCode.toLowerCase()}-team`,
          containsPii: entity.containsPii,
          containsFinancialData: entity.containsFinancialData,
          containsRiskData: entity.containsRiskData,
          // El manifiesto no clasifica estas tres. Van en falso porque la columna no admite nulo,
          // NO porque conste que la tabla no las tiene — y por eso la fila entra como AUTO_DETECTED,
          // que es lo que la pone delante de una persona en la cola de revisión.
          containsLegalData: false,
          containsDeviceData: false,
          containsLocationData: false,
          isAuditCritical: entity.isAuditCritical,
          status: 'ACTIVE',
          confidenceLevel: 'MEDIUM',
          reviewStatus: 'AUTO_DETECTED',
          createdAtValue: now,
        },
      );
    }
  }
}

function failure(systemCode: string, status: FederationOutcome['status'], message: string): FederationOutcome {
  return { systemCode, status, message, endpointsImported: 0, dataEntitiesImported: 0, remoteVersion: null, remoteCommit: null };
}

function normalizeRisk(value: string): string {
  const upper = value.toUpperCase();
  return RISK_LEVELS.has(upper) ? upper : 'MEDIUM';
}
