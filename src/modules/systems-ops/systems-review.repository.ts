/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Model, Transaction } from 'sequelize';
import {
  SystemDataEntityCatalogModel,
  SystemDataFieldCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointToolRequirementModel,
  SystemCatalogReviewEventModel,
} from '../../database/models/index.js';
import { ReviewDecisionDto, SystemsReviewQueueDto } from './systems-ops.schemas.js';
import { buildReviewFamilyWhere, ReviewFamily } from './systems-review-where.util.js';

const DATA_ENTITY_METADATA_FIELDS = [
  'businessPurpose',
  'dataOwner',
  'containsPii',
  'containsFinancialData',
  'containsRiskData',
  'containsLegalData',
  'containsDeviceData',
  'containsLocationData',
  'isAuditCritical',
  'retentionPolicyCode',
  'status',
  'reviewStatus',
] as const;

/** Lo que cambia cómo se gobierna la tabla: su cambio deja evento de revisión. */
const GOVERNANCE_FIELDS = new Set<string>([
  'containsPii',
  'containsFinancialData',
  'containsRiskData',
  'containsLegalData',
  'containsDeviceData',
  'containsLocationData',
  'isAuditCritical',
  'retentionPolicyCode',
  'status',
  'reviewStatus',
]);

@Injectable()
export class SystemsReviewRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
    @InjectModel(SystemEndpointDataEntityImpactModel) private readonly dataImpactModel: typeof SystemEndpointDataEntityImpactModel,
    @InjectModel(SystemEndpointFieldImpactModel) private readonly fieldImpactModel: typeof SystemEndpointFieldImpactModel,
    @InjectModel(SystemDataFieldCatalogModel) private readonly dataFieldModel: typeof SystemDataFieldCatalogModel,
    @InjectModel(SystemEndpointToolRequirementModel) private readonly endpointToolModel: typeof SystemEndpointToolRequirementModel,
    @InjectModel(SystemCatalogReviewEventModel) private readonly reviewEventModel: typeof SystemCatalogReviewEventModel,
  ) {}

  async listReviewQueue(query: SystemsReviewQueueDto) {
    const page = { limit: query.limit, offset: (query.page - 1) * query.limit };
    const escape = (value: string) => this.endpointModel.sequelize!.escape(value);
    const family = <T extends Model>(
      kind: ReviewFamily,
      model: { findAndCountAll(options: FindAndCountOptions): Promise<{ rows: T[]; count: number }> },
      orderBy: string,
    ) =>
      query.type === 'all' || query.type === kind
        ? model.findAndCountAll({ where: buildReviewFamilyWhere(kind, query, escape), order: [[orderBy, 'DESC']], ...page })
        : Promise.resolve({ rows: [] as T[], count: 0 });
    const [endpoints, dataEntities, dataImpacts, fieldImpacts, dataColumns, toolRequirements] = await Promise.all([
      family<SystemEndpointCatalogModel>('endpoints', this.endpointModel, 'updatedAtValue'),
      family<SystemDataEntityCatalogModel>('data_entities', this.dataEntityModel, 'updatedAtValue'),
      family<SystemEndpointDataEntityImpactModel>('data_impacts', this.dataImpactModel, 'updatedAtValue'),
      family<SystemEndpointFieldImpactModel>('field_impacts', this.fieldImpactModel, 'id'),
      family<SystemDataFieldCatalogModel>('data_column_impacts', this.dataFieldModel, 'updatedAtValue'),
      family<SystemEndpointToolRequirementModel>('tool_requirements', this.endpointToolModel, 'updatedAtValue'),
    ]);
    return { endpoints, dataEntities, dataImpacts, fieldImpacts, dataColumns, toolRequirements };
  }

  updateEndpointReview(
    endpointId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemEndpointCatalogModel | null> {
    return this.decide<SystemEndpointCatalogModel>(
      this.endpointModel,
      { targetType: 'endpoint', targetId: endpointId, decision, actorId, actorRole, tenantId },
      (row) => {
        row.updatedBy = actorId;
        row.updatedAtValue = new Date();
      },
    );
  }

  updateDataEntityReview(
    entityId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemDataEntityCatalogModel | null> {
    return this.decide<SystemDataEntityCatalogModel>(
      this.dataEntityModel,
      { targetType: 'data_entity', targetId: entityId, decision, actorId, actorRole, tenantId },
      (row) => {
        row.updatedAtValue = new Date();
      },
    );
  }

  updateDataImpactReview(
    impactId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemEndpointDataEntityImpactModel | null> {
    return this.decide<SystemEndpointDataEntityImpactModel>(
      this.dataImpactModel,
      { targetType: 'data_impact', targetId: impactId, decision, actorId, actorRole, tenantId },
      (row) => {
        if (decision.notes) row.notes = decision.notes;
        row.updatedAtValue = new Date();
      },
    );
  }

  updateFieldImpactReview(
    impactId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemEndpointFieldImpactModel | null> {
    return this.decide<SystemEndpointFieldImpactModel>(
      this.fieldImpactModel,
      { targetType: 'field_impact', targetId: impactId, decision, actorId, actorRole, tenantId },
      (row) => {
        if (decision.notes) row.notes = decision.notes;
      },
    );
  }

  updateDataColumnReview(
    columnId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemDataFieldCatalogModel | null> {
    return this.decide<SystemDataFieldCatalogModel>(
      this.dataFieldModel,
      { targetType: 'data_column', targetId: columnId, decision, actorId, actorRole, tenantId },
      (row) => {
        if (decision.notes) row.operationalNotes = decision.notes;
        row.detectedFrom = 'manual';
        row.manuallyEditedAt = new Date();
        row.updatedAtValue = new Date();
      },
    );
  }

  updateToolRequirementReview(
    requirementId: string,
    decision: ReviewDecisionDto,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemEndpointToolRequirementModel | null> {
    return this.decide<SystemEndpointToolRequirementModel>(
      this.endpointToolModel,
      { targetType: 'tool_requirement', targetId: requirementId, decision, actorId, actorRole, tenantId },
      (row) => {
        if (decision.notes) row.notes = decision.notes;
        row.updatedAtValue = new Date();
      },
    );
  }

  /*
   * La metadata de una tabla incluye su estado de revisión y las banderas de gobierno (PII, financiera…).
   * Cambiarlas por aquí sin rastro dejaba aprobar una tabla o quitarle la marca de PII sin evento de
   * revisión: si cambia alguna, queda un evento con el actor y el antes→después de cada bandera.
   */
  updateDataEntityMetadata(
    entityId: string,
    body: Record<string, unknown>,
    actorId: string | null,
    actorRole: string,
    tenantId: string | null,
  ): Promise<SystemDataEntityCatalogModel | null> {
    return this.reviewEventModel.sequelize!.transaction(async (transaction) => {
      const row = await this.dataEntityModel.findByPk(entityId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) return null;
      const fields = row as unknown as Record<string, unknown>;
      const previousStatus = row.reviewStatus;
      const governanceChanges: string[] = [];
      for (const field of DATA_ENTITY_METADATA_FIELDS) {
        if (!(field in body)) continue;
        if (GOVERNANCE_FIELDS.has(field) && fields[field] !== body[field]) {
          governanceChanges.push(`${field}: ${String(fields[field])}→${String(body[field])}`);
        }
        fields[field] = body[field];
      }
      row.updatedAtValue = new Date();
      const saved = await row.save({ transaction });
      if (governanceChanges.length > 0 || row.reviewStatus !== previousStatus) {
        await this.recordReview(
          {
            targetType: 'data_entity',
            targetId: entityId,
            previousStatus,
            previousConfidence: row.confidenceLevel,
            decision: {
              reviewStatus: row.reviewStatus,
              notes: `metadata: ${governanceChanges.join('; ') || 'reviewStatus'}`,
            } as ReviewDecisionDto,
            actorId,
            actorRole,
            tenantId,
          },
          transaction,
        );
      }
      return saved;
    });
  }

  /*
   * La decisión y su evento van en la misma transacción y con la fila bloqueada: si el evento no se
   * escribe, la decisión tampoco queda; y dos revisores a la vez no registran el mismo estado previo
   * para transiciones que nunca ocurrieron. Igual que `SystemFlowsReviewRepository.decide`.
   */
  private decide<T extends Model & { reviewStatus: string; confidenceLevel: string }>(
    model: { findByPk(id: string, options: FindOptions): Promise<T | null> },
    entrada: Omit<Parameters<SystemsReviewRepository['recordReview']>[0], 'previousStatus' | 'previousConfidence'>,
    apply: (row: T) => void,
  ): Promise<T | null> {
    const { targetId, decision } = entrada;
    return this.reviewEventModel.sequelize!.transaction(async (transaction) => {
      const row = await model.findByPk(targetId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) return null;
      const previousStatus = row.reviewStatus;
      const previousConfidence = row.confidenceLevel;
      row.reviewStatus = decision.reviewStatus;
      if (decision.confidenceLevel) row.confidenceLevel = decision.confidenceLevel;
      apply(row);
      const saved = await row.save({ transaction });
      await this.recordReview({ ...entrada, previousStatus, previousConfidence }, transaction);
      return saved;
    });
  }

  /*
   * Argumentos con nombre: la llamada tenía ocho posiciones y cuatro eran `string | null`
   * seguidas —`previousStatus`, `previousConfidence`, `actorId`, `tenantId`—. Intercambiar dos
   * compilaba sin una queja y dejaba el evento de revisión atribuido a otro actor o a otro
   * tenant, que es exactamente lo que este registro existe para poder demostrar.
   */
  private async recordReview(
    entrada: {
      targetType: string;
      targetId: string;
      previousStatus: string | null;
      previousConfidence: string | null;
      decision: ReviewDecisionDto;
      actorId: string | null;
      actorRole: string;
      tenantId: string | null;
    },
    transaction: Transaction,
  ): Promise<void> {
    const { targetType, targetId, previousStatus, previousConfidence, decision, actorId, actorRole, tenantId } = entrada;
    await this.reviewEventModel.create(
      {
        tenantId,
        targetType,
        targetId,
        previousStatus,
        newStatus: decision.reviewStatus,
        previousConfidence,
        newConfidence: decision.confidenceLevel ?? previousConfidence,
        notes: decision.notes ?? null,
        actorId,
        actorRole,
        createdAtValue: new Date(),
      } as never,
      { transaction },
    );
  }
}
