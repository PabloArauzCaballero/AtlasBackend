/**
 * @file Servicio de aplicación: carga el artefacto de `flows:derive` en el catálogo de Flujos.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system reemplaza por bloque los endpoints, pantallas y hallazgos derivados, dentro de una transacción.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { flowRowFor } from './system-flows.mapper.js';
import { SystemFlowsFreshnessRepository } from './system-flows.freshness.repository.js';
import { SystemFlowsReviewRepository } from './system-flows.review.repository.js';
import { SystemFlowsGateRepository } from './system-flows.gate.repository.js';
import { motivosDeRevision } from './system-flows.review.util.js';
import { SystemFlowsRepository } from './system-flows.repository.js';
import { findingKeyFor } from './system-flows.risk.util.js';
import { ImportEndpointsDto, ImportFindingsDto, ImportScreensDto } from './system-flows.schemas.js';

/**
 * Una carga con otro número de filas del que declara su artefacto está truncada: se para antes de escribir, porque lo
 * que falta se daría por retirado (flujos, pantallas) o por resuelto (hallazgos) sin que nadie lo tocara.
 */
function exigirCompleta(alcance: string, bloque: string, recibidas: number, declaradas: number): void {
  if (recibidas === declaradas) return;
  throw new BadRequestException(
    `La carga de ${alcance} de ${bloque} trae ${recibidas} fila(s) y su artefacto declara ${declaradas}: está truncada.`,
  );
}

@Injectable()
export class SystemFlowsImportService {
  constructor(
    private readonly repository: SystemFlowsRepository,
    private readonly freshness: SystemFlowsFreshnessRepository,
    private readonly review: SystemFlowsReviewRepository,
    private readonly gate: SystemFlowsGateRepository,
  ) {}

  importEndpoints(dto: ImportEndpointsDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      exigirCompleta('endpoints', dto.systemCode, dto.endpoints.length, dto.declaredCount);
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
      // La frescura se decide ANTES de escribir, comparando la huella guardada con la que trae la
      // recarga: después ya no se sabría cuál era la anterior. Un flujo cuyo código cambió desde que
      // se verificó pasa a STALE; el resto se queda como estaba, que es lo que hace útil el aviso.
      // Una carga vacía retiraría el catálogo entero del bloque, y con él cada revisión humana. Si el bloque
      // se retiró de verdad hay que hacerlo a propósito, no por un artefacto truncado.
      if (!rows.length && (await this.review.catalogSize(dto.systemCode, tx)) > 0) {
        throw new BadRequestException(
          `La carga no trae endpoints y ${dto.systemCode} tiene flujos catalogados: se borrarían todos, con sus revisiones.`,
        );
      }
      const removedDecisions = await this.review.decisionsToBeRemoved(
        dto.systemCode,
        rows.map((row) => row.flowId),
        tx,
      );
      // Un artefacto truncado pero no vacío también retiraría flujos, y con ellos sus decisiones. Se para, salvo
      // que quien carga confirme que el bloque cambió de verdad.
      if (removedDecisions > 0 && !dto.allowRemovingDecisions) {
        throw new BadRequestException(
          `La carga retiraría ${removedDecisions} flujo(s) de ${dto.systemCode} con revisión humana. Si el bloque cambió de verdad, repítela con allowRemovingDecisions.`,
        );
      }
      const cambiados = await this.freshness.markStaleByDepsHash(dto.systemCode, rows, tx);
      const result = await this.repository.replaceFlows(dto.systemCode, rows, tx);
      // A revisión humana: riesgo alto con un análisis que no se puede dar por bueno solo. Sólo a los
      // que nadie ha tocado; una decisión ya tomada no la pisa una recarga.
      const needsReview = await this.review.markForReview(
        rows.filter((row) => motivosDeRevision(row).length).map((row) => row.flowId),
        tx,
      );
      // Y lo ya decidido cuyo código cambió vuelve a la cola: aprobar un flujo era aprobar ESE código.
      const reopenedReviews =
        (await this.review.reopen(cambiados, tx)) +
        (await this.review.reopenWithoutReviewedHash(
          rows.filter((row) => row.depsHash).map((row) => row.flowId),
          tx,
        ));
      // Y lo que se queda sin motivo sin que nadie lo revisara sale de la cola, en vez de quedarse sin explicación.
      const releasedReviews = await this.review.release(
        rows.filter((row) => !motivosDeRevision(row).length).map((row) => row.flowId),
        tx,
      );
      await this.repository.recountFindings(dto.systemCode, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result, stale: cambiados.length, needsReview, reopenedReviews, releasedReviews, removedDecisions };
    });
  }

  importScreens(dto: ImportScreensDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      exigirCompleta('pantallas', dto.clientCode, dto.screens.length, dto.declaredCount);
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
      // Un artefacto de antes de leer el menú trae las pantallas sin puertas. Cargarlo borraría las del catálogo, y la
      // deriva de RBAC saldría en verde por no tener nada con qué comparar.
      const conPuerta = await this.gate.gatedScreensOfClient(dto.clientCode, tx);
      if (conPuerta > 0 && !dto.allowRemovingMenuGates && !rows.some((row) => row.navPermissions.length || row.navRoles.length)) {
        throw new BadRequestException(
          `La carga deja sin puertas de menú a ${dto.clientCode}, que tiene ${conPuerta} pantalla(s) con puerta: ¿es un artefacto viejo? Si el menú dejó de restringir de verdad, repítela con allowRemovingMenuGates.`,
        );
      }
      const result = await this.repository.replaceScreens(dto.clientCode, rows, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result };
    });
  }

  importFindings(dto: ImportFindingsDto, actor: string | null) {
    return this.repository.transaction(async (tx) => {
      exigirCompleta('hallazgos', dto.systemCode, dto.findings.length, dto.declaredCount);
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
      // Los hallazgos que no vienen se dan por resueltos. Una carga sin ninguno —vacía, truncada o de otro
      // bloque— resolvería todos los abiertos, y la compuerta vería «0 escrituras desprotegidas».
      if (!rows.length && (await this.gate.openFindingsOfSystem(dto.systemCode, tx)) > 0) {
        throw new BadRequestException(
          `La carga no trae hallazgos de ${dto.systemCode} y hay abiertos: se darían todos por resueltos sin que nadie los resolviera.`,
        );
      }
      const result = await this.repository.replaceFindings(dto.systemCode, rows, tx);
      await this.repository.recountFindings(dto.systemCode, tx);
      await record.update({ rowsUpserted: result.upserted, rowsRemoved: result.removed }, { transaction: tx });
      return { importId: record.id, ...result, ignored: dto.findings.length - rows.length };
    });
  }
}
