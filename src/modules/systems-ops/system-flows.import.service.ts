/**
 * @file Servicio de aplicación: carga el artefacto de `flows:derive` en el catálogo de Flujos.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system reemplaza por bloque los endpoints, pantallas y hallazgos derivados, dentro de una transacción.
 */
import { Injectable } from '@nestjs/common';
import { flowRowFor } from './system-flows.mapper.js';
import { SystemFlowsRepository } from './system-flows.repository.js';
import { findingKeyFor } from './system-flows.risk.util.js';
import { ImportEndpointsDto, ImportFindingsDto, ImportScreensDto } from './system-flows.schemas.js';

@Injectable()
export class SystemFlowsImportService {
  constructor(private readonly repository: SystemFlowsRepository) {}

  importEndpoints(dto: ImportEndpointsDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      const record = await this.repository.createImport(
        {
          scope: 'endpoints',
          systemCode: dto.systemCode,
          analyzedCommit: dto.analyzedCommit ?? null,
          analyzedBranch: dto.analyzedBranch ?? null,
          contentHash: dto.contentHash ?? null,
          rowsReceived: dto.endpoints.length,
          rowsUpserted: 0,
          rowsRemoved: 0,
          createdBy: actor,
        },
        tx,
      );
      const rows = dto.endpoints.map((endpoint) =>
        flowRowFor(dto.systemCode, endpoint, {
          analyzedCommit: dto.analyzedCommit,
          analyzedBranch: dto.analyzedBranch,
          importId: record.id,
        }),
      );
      const result = await this.repository.replaceFlows(dto.systemCode, rows, tx);
      await this.repository.recountFindings(dto.systemCode, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result };
    });
  }

  importScreens(dto: ImportScreensDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      const record = await this.repository.createImport(
        {
          scope: 'screens',
          systemCode: dto.clientCode,
          analyzedCommit: dto.analyzedCommit ?? null,
          analyzedBranch: null,
          contentHash: null,
          rowsReceived: dto.screens.length,
          rowsUpserted: 0,
          rowsRemoved: 0,
          createdBy: actor,
        },
        tx,
      );
      const rows = dto.screens.map((screen) => ({
        clientCode: dto.clientCode,
        route: screen.route,
        sourceFile: screen.file ?? null,
        navLabel: screen.navLabel ?? null,
        navPermissions: screen.navPermissions,
        navRoles: screen.navRoles,
        analyzedCommit: dto.analyzedCommit ?? null,
        importId: record.id,
      }));
      const result = await this.repository.replaceScreens(dto.clientCode, rows, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result };
    });
  }

  importFindings(dto: ImportFindingsDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      const record = await this.repository.createImport(
        {
          scope: 'findings',
          systemCode: dto.systemCode,
          analyzedCommit: dto.analyzedCommit ?? null,
          analyzedBranch: null,
          contentHash: null,
          rowsReceived: dto.findings.length,
          rowsUpserted: 0,
          rowsRemoved: 0,
          createdBy: actor,
        },
        tx,
      );
      const rows = dto.findings
        .filter((finding) => finding.systemCode === dto.systemCode)
        .map((finding) => ({
          findingKey: findingKeyFor(finding),
          kind: finding.kind,
          severity: finding.severity,
          systemCode: finding.systemCode,
          ref: finding.ref,
          module: finding.module ?? null,
          summary: finding.summary,
          extraJson: finding.extra ?? {},
          knownSince: finding.knownSince ?? null,
          importId: record.id,
        }));
      const result = await this.repository.replaceFindings(dto.systemCode, rows, tx);
      await this.repository.recountFindings(dto.systemCode, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result, ignored: dto.findings.length - rows.length };
    });
  }
}
