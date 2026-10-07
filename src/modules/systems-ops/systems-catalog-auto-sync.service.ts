/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el ECOSISTEMA entero, no sólo este backend.
 * @system pone al día el catálogo de sistemas sola: rutas propias al arrancar y manifiestos de los bloques federados.
 */
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../config/env.js';
import { appRole, runsHttpApi } from '../../config/app-role.js';
import { OpenApiCatalogService } from './openapi-catalog.service.js';
import { OpenApiDocumentRegistry } from './openapi-document.registry.js';
import { PlatformCatalogFederationRepository } from './platform-catalog-federation.repository.js';
import { PlatformCatalogFederationService } from './platform-catalog-federation.service.js';
import { FederationOutcome } from './platform-catalog-manifest.types.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { EndpointSeed } from './systems-ops.types.js';

/** El bloque que se describe a sí mismo. Mismo código que en `PLATFORM_BLOCKS`. */
const SELF_CODE = 'ATLAS_BACKEND';
const SELF_SOURCE = 'openapi_contract';
const LOCK_KEY = 'atlas_systems_catalog_auto_sync';
/** `refreshCatalog` también cataloga las rutas propias: toma esta misma llave para no pisarse con la pasada. */
export const CATALOG_SELF_SYNC_LOCK_KEY = LOCK_KEY;
/**
 * La transacción del candado queda ociosa mientras se catalogan cientos de rutas y se federan los bloques
 * por red. Con el `idle_in_transaction_session_timeout` del pool (60 s) Postgres cortaba la sesión a
 * mitad de pasada, el candado se soltaba y otra réplica entraba a la vez. Se amplía sólo para esta
 * transacción, con techo: si el proceso se cuelga, el candado no queda tomado para siempre.
 */
export const CATALOG_LOCK_IDLE_TIMEOUT_SQL = `SET LOCAL idle_in_transaction_session_timeout = '15min'`;

export interface AutoSyncResult {
  readonly trigger: string;
  readonly outcomes: FederationOutcome[];
}

/**
 * Pone al día el catálogo de sistemas sin que nadie tenga que acordarse.
 *
 * ## Por qué hacía falta
 *
 * En TEST (2026-09-28) «Salud de la red» enseñaba «Endpoints 0» para Atlas Backend y «nunca
 * federado» para el motor y el ERP. No era que no hubiera rutas —el proceso tenía 532 en su
 * contrato— sino que el catálogo SÓLO se llenaba al pulsar dos botones del portal, y en un
 * despliegue limpio nadie los había pulsado nunca. El panel decía «cero» cuando la verdad era «no se
 * ha medido», que exige la acción contraria.
 *
 * ## Qué hace
 *
 * 1. Cataloga las rutas de ESTE backend desde el contrato OpenAPI que el propio proceso generó al
 *    arrancar. Por eso corre sólo donde se sirve HTTP: el worker no monta rutas y no tiene contrato.
 * 2. Trae el manifiesto de cada bloque federado con `federateAll(null)`: sin sesión de persona, el
 *    motor se pide con la llave del plano de gestión y el ERP con su llave de catálogo. Si falta una,
 *    el bloque queda registrado como «sin configurar», con el motivo, y no como cero.
 *
 * ## Qué NO hace
 *
 * No pisa lo gobernado. Una ruta que ya existe sólo refresca su parte estructural (método, ruta,
 * contrato); dueño, revisión, riesgo y narrativa son de quien los revisó. Y un candado de
 * PostgreSQL impide que dos réplicas de la API lo hagan a la vez.
 */
@Injectable()
export class SystemsCatalogAutoSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SystemsCatalogAutoSyncService.name);
  private initialTimer: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<AutoSyncResult | null> | null = null;

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly registry: OpenApiDocumentRegistry,
    private readonly openApiCatalog: OpenApiCatalogService,
    private readonly catalogRepository: SystemsCatalogRepository,
    private readonly federationRepository: PlatformCatalogFederationRepository,
    private readonly federation: PlatformCatalogFederationService,
  ) {}

  onApplicationBootstrap(): void {
    if (!runsHttpApi()) {
      this.logger.log(`Puesta al día del catálogo no arrancada: APP_ROLE=${appRole()} no sirve HTTP y no tiene contrato de rutas.`);
      return;
    }
    if (!env.SYSTEMS_CATALOG_AUTO_SYNC_ENABLED) {
      this.logger.log('Puesta al día del catálogo desactivada (SYSTEMS_CATALOG_AUTO_SYNC_ENABLED=false).');
      return;
    }
    const delay = env.SYSTEMS_CATALOG_AUTO_SYNC_INITIAL_DELAY_MS;
    const every = env.SYSTEMS_CATALOG_AUTO_SYNC_INTERVAL_MS;
    this.logger.log(`Puesta al día del catálogo: primera pasada en ${delay} ms y luego cada ${every} ms.`);
    // Con retraso y fuera del arranque: la API tiene que estar escuchando antes de salir a pedirle
    // nada a los vecinos, y un bloque lento no puede retrasar el healthcheck del despliegue.
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.run('arranque');
      this.timer = setInterval(() => void this.run('programada'), every);
      this.timer.unref?.();
    }, delay);
    this.initialTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
    await this.inFlight?.catch(() => undefined);
  }

  /** Una pasada completa. Nunca lanza: devuelve `null` si otra réplica ya la está haciendo. */
  run(trigger: string): Promise<AutoSyncResult | null> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runWithLock(trigger)
      .catch((error: unknown) => {
        this.logger.warn(`Puesta al día del catálogo (${trigger}) falló: ${describe(error)}`);
        return null;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async runWithLock(trigger: string): Promise<AutoSyncResult | null> {
    const lock = await this.sequelize.transaction();
    try {
      const [row] = await this.sequelize.query<{ acquired: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext(:key)) AS acquired`, {
        replacements: { key: LOCK_KEY },
        type: QueryTypes.SELECT,
        transaction: lock,
      });
      if (!row?.acquired) {
        this.logger.log(`Puesta al día del catálogo (${trigger}) omitida: otra réplica la está haciendo.`);
        return null;
      }
      await this.sequelize.query(CATALOG_LOCK_IDLE_TIMEOUT_SQL, { transaction: lock });
      const self = await this.syncSelf();
      const federated = await this.federation.federateAll(null);
      const outcomes = [self, ...federated];
      this.logger.log(
        `Puesta al día del catálogo (${trigger}): ` +
          outcomes.map((outcome) => `${outcome.systemCode}=${outcome.status}/${outcome.endpointsImported}`).join(', '),
      );
      return { trigger, outcomes };
    } finally {
      await lock.rollback().catch(() => undefined);
    }
  }

  /**
   * Cataloga las rutas propias y deja constancia en la misma bitácora que los bloques federados,
   * para que el panel pueda distinguir «0 rutas» de «nunca se leyeron».
   */
  async syncSelf(): Promise<FederationOutcome> {
    const outcome = await this.catalogSelf().catch((error: unknown) =>
      failure(`No se pudieron catalogar las rutas propias: ${describe(error)}`),
    );
    await this.federationRepository.recordOutcome(outcome);
    return outcome;
  }

  private async catalogSelf(): Promise<FederationOutcome> {
    const document = this.registry.get();
    if (!document) return failure('Este proceso no generó su contrato de rutas, así que no hay de dónde catalogarlas.');

    const seeds = this.openApiCatalog.buildSeeds(document);
    const now = new Date();
    for (const seed of seeds) {
      const existing = await this.federationRepository.findEndpointByCode(seed.code);
      if (existing) await this.federationRepository.refreshEndpointStructure(existing, structuralFromSeed(seed, now));
      else await this.catalogRepository.upsertEndpoint(seed);
    }
    const retired = await this.federationRepository.deprecateMissingEndpoints(
      SELF_CODE,
      seeds.map((seed) => seed.code),
      SELF_SOURCE,
    );
    const tables = await this.federationRepository.countDataEntities(SELF_CODE);
    return {
      systemCode: SELF_CODE,
      status: 'OK',
      message:
        `Atlas Backend leyó ${seeds.length} rutas de su propio contrato` + (retired > 0 ? ` y retiró ${retired} que ya no existen.` : '.'),
      endpointsImported: seeds.length,
      dataEntitiesImported: tables,
      remoteVersion: null,
      remoteCommit: null,
    };
  }
}

/**
 * Lo que el contrato sabe de verdad y debe refrescarse en cada pasada: forma de la ruta y contrato
 * de entrada. Todo lo demás de la fila (propósito, riesgo, dueño, revisión) es gobierno.
 */
export function structuralFromSeed(seed: EndpointSeed, now: Date): Record<string, unknown> {
  return {
    module: seed.module,
    method: seed.method,
    routePath: seed.fullPath.replace(/^\/api\/v[0-9]+\//, '/'),
    fullPath: seed.fullPath,
    routeName: seed.routeName,
    expectedStatusCodes: seed.expectedStatusCodes ?? [],
    minPayloadSchema: seed.minPayloadSchema ?? {},
    queryParamsSchema: seed.queryParamsSchema ?? {},
    pathParamsSchema: seed.pathParamsSchema ?? {},
    headersSchema: seed.headersSchema ?? {},
    ...(seed.inputPayloadContract ? { inputPayloadContract: seed.inputPayloadContract } : {}),
    requiresAuth: seed.requiresAuth ?? true,
    isDestructive: seed.isDestructive ?? false,
    isReadonly: seed.isReadonly ?? seed.method === 'GET',
    idempotencyRequired: seed.idempotencyRequired ?? false,
    detectedFrom: SELF_SOURCE,
    updatedAtValue: now,
  };
}

function failure(message: string): FederationOutcome {
  return {
    systemCode: SELF_CODE,
    status: 'ERROR',
    message,
    endpointsImported: 0,
    dataEntitiesImported: 0,
    remoteVersion: null,
    remoteCommit: null,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
