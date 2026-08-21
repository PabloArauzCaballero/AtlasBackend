/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system compone la salud de la RED de bloques: quién responde, qué aporta al catálogo y qué se pierde si cae.
 */
import { Injectable } from '@nestjs/common';
import { SystemBlockFederationStateModel } from '../../database/models/index.js';
import { PLATFORM_BLOCKS, PlatformBlockDefinition } from './platform-blocks.constants.js';
import { PlatformCatalogFederationRepository } from './platform-catalog-federation.repository.js';
import { SystemsHealthService } from './systems-health.service.js';
import { SystemsHealthStatus } from './systems-ops.dtos.js';

/** Estado con el que el panel pinta cada bloque. Ordenados de peor a mejor para el veredicto global. */
export type BlockLiveState = 'DOWN' | 'DEGRADED' | 'NOT_CONFIGURED' | 'UP';

export interface NetworkBlockReport {
  systemCode: string;
  name: string;
  repository: string;
  kind: string;
  purpose: string;
  degradation: string;
  liveState: BlockLiveState;
  /** Mensaje del probe de salud, o la explicación de por qué no hay probe. */
  healthMessage: string;
  isCritical: boolean;
  catalog: {
    endpoints: number;
    dataEntities: number;
    federationStatus: string;
    federationMessage: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    remoteVersion: string | null;
    remoteCommit: string | null;
  };
}

export interface BlockCatalogSummary {
  systemCode: string;
  name: string;
  repository: string;
  kind: string;
  purpose: string;
  endpoints: number;
  dataEntities: number;
  federationStatus: string;
  lastSuccessAt: string | null;
}

export interface NetworkHealthReport {
  generatedAt: string;
  overallState: BlockLiveState;
  blocksUp: number;
  blocksDown: number;
  blocksNotConfigured: number;
  blocks: NetworkBlockReport[];
}

/**
 * La salud de la RED, que no es la suma de la salud de las herramientas.
 *
 * «Salud de herramientas» contesta «¿responde este servicio?» para veintiocho piezas, la mayoría
 * librerías y tablas de este mismo proceso. La pregunta que nadie podía contestar era otra: «¿está
 * completo el ecosistema?» — si los tres bloques están en pie, si cada uno está aportando su parte
 * del catálogo, y qué deja de funcionar cuando uno falta. Un panel lleno de verdes decía «todo
 * bien» mientras el ERP llevaba semanas sin federar una sola tabla, porque nadie preguntaba eso.
 *
 * Reutiliza `SystemsHealthService.getToolsHealth()` en vez de sondear por su cuenta: dos códigos
 * distintos preguntando lo mismo acaban dando dos respuestas distintas, y durante un incidente eso
 * es peor que no tener panel.
 */
@Injectable()
export class SystemsNetworkHealthService {
  constructor(
    private readonly health: SystemsHealthService,
    private readonly federation: PlatformCatalogFederationRepository,
  ) {}

  /**
   * Los bloques y lo que cada uno aporta, sin sondear a nadie.
   *
   * El portal lo usa para construir el filtro «bloque» del catálogo y de los endpoints, y esa
   * pantalla se abre constantemente. Salir a preguntarle la salud a dos servicios remotos cada vez
   * que alguien abre un desplegable pondría la latencia de un tercero en el camino de un filtro; el
   * estado vivo se pide aparte, en la pestaña que existe justamente para eso.
   *
   * Emite SIEMPRE los tres bloques, aunque alguno tenga cero filas: un bloque ausente del filtro es
   * indistinguible de un bloque que no existe, y era justo esa ausencia la que hacía que el catálogo
   * pareciera completo cuando no lo estaba.
   */
  async listBlocks(): Promise<BlockCatalogSummary[]> {
    const [counts, states] = await Promise.all([this.federation.countsByBlock(), this.federation.listStates()]);
    const stateByCode = new Map(states.map((state) => [state.systemCode, state]));

    return PLATFORM_BLOCKS.map((definition) => {
      const state = stateByCode.get(definition.code);
      return {
        systemCode: definition.code,
        name: definition.name,
        repository: definition.repository,
        kind: definition.kind,
        purpose: definition.purpose,
        endpoints: counts.endpoints.get(definition.code) ?? 0,
        dataEntities: counts.dataEntities.get(definition.code) ?? 0,
        federationStatus: federationStatusOf(definition, state),
        lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
      };
    });
  }

  async getNetworkHealth(): Promise<NetworkHealthReport> {
    const [tools, counts, states] = await Promise.all([
      this.health.getToolsHealth(),
      this.federation.countsByBlock(),
      this.federation.listStates(),
    ]);

    const toolsByCode = new Map(tools.map((tool) => [tool.code, tool]));
    const stateByCode = new Map(states.map((state) => [state.systemCode, state]));

    const blocks = PLATFORM_BLOCKS.map((definition) =>
      toBlockReport(
        definition,
        definition.toolCode ? toolsByCode.get(definition.toolCode) : undefined,
        stateByCode.get(definition.code),
        counts,
      ),
    );

    return {
      generatedAt: new Date().toISOString(),
      overallState: worstOf(blocks.map((block) => block.liveState)),
      blocksUp: blocks.filter((block) => block.liveState === 'UP').length,
      blocksDown: blocks.filter((block) => block.liveState === 'DOWN').length,
      blocksNotConfigured: blocks.filter((block) => block.liveState === 'NOT_CONFIGURED').length,
      blocks,
    };
  }
}

type BlockCounts = { endpoints: Map<string, number>; dataEntities: Map<string, number> };

function toBlockReport(
  definition: PlatformBlockDefinition,
  tool: SystemsHealthStatus | undefined,
  state: SystemBlockFederationStateModel | undefined,
  counts: BlockCounts,
): NetworkBlockReport {
  return {
    systemCode: definition.code,
    name: definition.name,
    repository: definition.repository,
    kind: definition.kind,
    purpose: definition.purpose,
    degradation: definition.degradation,
    liveState: liveStateOf(definition, tool),
    healthMessage: healthMessageOf(definition, tool),
    isCritical: tool?.isCritical ?? definition.kind === 'SELF',
    catalog: toCatalogSummary(definition, state, counts),
  };
}

function toCatalogSummary(
  definition: PlatformBlockDefinition,
  state: SystemBlockFederationStateModel | undefined,
  counts: BlockCounts,
): NetworkBlockReport['catalog'] {
  return {
    endpoints: counts.endpoints.get(definition.code) ?? 0,
    dataEntities: counts.dataEntities.get(definition.code) ?? 0,
    federationStatus: federationStatusOf(definition, state),
    federationMessage: state?.lastMessage ?? null,
    lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    remoteVersion: state?.remoteVersion ?? null,
    remoteCommit: state?.remoteCommit ?? null,
  };
}

/**
 * Este backend no se federa: se introspecciona. Decirlo con un estado propio evita que el panel lo
 * muestre como «nunca ejecutado», que sería cierto y a la vez completamente engañoso.
 */
function federationStatusOf(definition: PlatformBlockDefinition, state: SystemBlockFederationStateModel | undefined): string {
  if (definition.kind === 'SELF') return 'SELF_INTROSPECTED';
  return state?.lastStatus ?? 'NEVER_RUN';
}

/**
 * Este backend está vivo por definición —si no lo estuviera, nadie leería esta respuesta—, así que
 * no se sondea a sí mismo. Para los federados manda su herramienta del catálogo, que ya distingue
 * «no configurado» de «no responde»; sin herramienta asociada no se inventa un verde.
 */
function liveStateOf(definition: PlatformBlockDefinition, tool: SystemsHealthStatus | undefined): BlockLiveState {
  if (definition.kind === 'SELF') return 'UP';
  if (!tool) return 'NOT_CONFIGURED';
  if (tool.checkType === 'CONFIGURATION') return 'NOT_CONFIGURED';
  if (tool.isHealthy === true) return 'UP';
  if (tool.isHealthy === false) return 'DOWN';
  return 'NOT_CONFIGURED';
}

function healthMessageOf(definition: PlatformBlockDefinition, tool: SystemsHealthStatus | undefined): string {
  if (definition.kind === 'SELF') {
    return 'Es este mismo proceso: si esta respuesta llegó, el bloque está en pie.';
  }
  return (
    tool?.healthMessage ??
    `${definition.name} no tiene una herramienta de catálogo asociada en este despliegue, así que no hay sonda que consultar.`
  );
}

const SEVERITY: readonly BlockLiveState[] = ['DOWN', 'DEGRADED', 'NOT_CONFIGURED', 'UP'];

function worstOf(states: readonly BlockLiveState[]): BlockLiveState {
  for (const candidate of SEVERITY) {
    if (states.includes(candidate)) return candidate;
  }
  return 'UP';
}
