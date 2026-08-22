/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system declara los tipos del paquete de contexto multidominio que se siembra.
 */
import type { Sequelize } from 'sequelize-typescript';

export type JsonRecord = Record<string, unknown>;

export type ManifestChunk = {
  catalogCode: string;
  relativePath: string;
  itemCount: number;
  bytes: number;
};

export type PackageManifest = {
  schemaVersion: string;
  loadingStrategy: string;
  totalItems: number;
  chunkCount: number;
  chunks: ManifestChunk[];
};

export type BootstrapSeed = {
  schemaVersion: string;
  environmentScope: string;
  loadingStrategy: string;
  contextSources: JsonRecord[];
  contextCatalogs: JsonRecord[];
  contextCatalogVersions: JsonRecord[];
};

export type SupportingSeed = {
  schemaVersion: string;
  versionCode: string;
  dimensionItems: JsonRecord[];
  profileItems: JsonRecord[];
};

export type ItemsSeed = {
  schemaVersion: string;
  catalogCode: string;
  versionCode: string;
  loadingStrategy: string;
  count: number;
  items: JsonRecord[];
};

export type ReferenceSeed = {
  count: number;
  items: JsonRecord[];
};

export type PackageEntrypoint = {
  package: {
    buildVersion: string;
    environmentScope: string;
    status: string;
    primaryDataCount: number;
  };
};

export type ContextSeedLoadReport = {
  packageBuildVersion: string;
  chunksLoaded: number;
  chunksSkipped: number;
  materializedItems: number;
  supportingItems: number;
  aliases: number;
  riskMappings: number;
  dryRun: boolean;
};

export type ContextSeedLoadOptions = {
  packageDirectory: string;
  sequelize?: Sequelize;
  dryRun?: boolean;
  force?: boolean;
  allowProduction?: boolean;
  log?: (message: string) => void;
};
