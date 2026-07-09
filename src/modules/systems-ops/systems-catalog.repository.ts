import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import {
  SystemDataEntityCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointToolRequirementModel,
  SystemToolCatalogModel,
  SystemDataFieldCatalogModel,
  SystemDataRelationshipCatalogModel,
  SystemOperationalRuleCatalogModel,
  SystemDomainCatalogModel,
  SystemEndpointPayloadContractModel,
} from '../../database/models/index.js';
import { SystemsListQueryDto } from './systems-ops.schemas.js';
import { DataEntitySeed, EndpointSeed, ToolSeed } from './systems-ops.types.js';
import { buildDataEntityWhere, buildEndpointTextWhere, buildToolWhere } from './systems-repository-where.util.js';

export type UpsertDataImpactInput = {
  endpointId: string;
  dataEntityId: string;
  operationType: string;
  impactLevel: string;
  isPrimaryEntity?: boolean;
  affectsCustomerState?: boolean;
  affectsFinancialState?: boolean;
  affectsRiskState?: boolean;
  affectsLegalState?: boolean;
  affectsDeviceState?: boolean;
  affectsNotificationState?: boolean;
  requiresStressTest?: boolean;
  notes?: string | null;
  detectedFrom?: string;
  confidenceLevel?: string;
  reviewStatus?: string;
};

@Injectable()
export class SystemsCatalogRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemToolCatalogModel) private readonly toolModel: typeof SystemToolCatalogModel,
    @InjectModel(SystemEndpointToolRequirementModel) private readonly endpointToolModel: typeof SystemEndpointToolRequirementModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
    @InjectModel(SystemEndpointDataEntityImpactModel) private readonly dataImpactModel: typeof SystemEndpointDataEntityImpactModel,
    @InjectModel(SystemEndpointFieldImpactModel) private readonly fieldImpactModel: typeof SystemEndpointFieldImpactModel,
    @InjectModel(SystemDataFieldCatalogModel) private readonly dataFieldModel: typeof SystemDataFieldCatalogModel,
    @InjectModel(SystemDataRelationshipCatalogModel) private readonly relationshipModel: typeof SystemDataRelationshipCatalogModel,
    @InjectModel(SystemOperationalRuleCatalogModel) private readonly operationalRuleModel: typeof SystemOperationalRuleCatalogModel,
    @InjectModel(SystemDomainCatalogModel) private readonly domainModel: typeof SystemDomainCatalogModel,
    @InjectModel(SystemEndpointPayloadContractModel) private readonly payloadContractModel: typeof SystemEndpointPayloadContractModel,
  ) {}

  async listEndpoints(query: SystemsListQueryDto) {
    const result = await this.endpointModel.findAndCountAll({
      where: buildEndpointTextWhere(query),
      order: [
        ['module', 'ASC'],
        ['method', 'ASC'],
        ['fullPath', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findEndpointById(endpointId: string): Promise<SystemEndpointCatalogModel | null> {
    return this.endpointModel.findByPk(endpointId);
  }

  findEndpointByMethodAndPath(method: string, fullPath: string): Promise<SystemEndpointCatalogModel | null> {
    return this.endpointModel.findOne({ where: { method: method.toUpperCase(), fullPath } } as FindOptions);
  }

  async upsertEndpoint(seed: EndpointSeed): Promise<void> {
    const now = new Date();
    await this.endpointModel.upsert({
      code: seed.code,
      module: seed.module,
      controllerName: seed.controllerName ?? null,
      handlerName: seed.handlerName ?? null,
      method: seed.method,
      routePath: seed.fullPath.replace(/^\/api\/v[0-9]+\//, '/'),
      fullPath: seed.fullPath,
      routeName: seed.routeName,
      businessPurpose: seed.businessPurpose,
      businessAction: seed.businessAction ?? null,
      expectedResponseSummary: seed.expectedResponseSummary ?? null,
      technicalPurpose:
        seed.technicalPurpose ??
        `Ejecuta ${seed.method} ${seed.fullPath} dentro del módulo ${seed.module}. Debe mantener contrato de entrada, salida, permisos y trazabilidad coherentes con el catálogo de sistemas.`,
      businessValue: seed.businessValue ?? seed.businessPurpose,
      auditStrategy:
        seed.auditStrategy ??
        `Auditar requestId, actor, roles, parámetros no sensibles, entidades afectadas, resultado HTTP y errores para reconstruir el uso de ${seed.fullPath}.`,
      decisionUseCases: seed.decisionUseCases ?? [
        'operación del portal interno',
        'soporte y diagnóstico',
        'auditoría de acciones',
        'control de riesgo operativo',
      ],
      inputPayloadContract: seed.inputPayloadContract ?? {
        body: seed.minPayloadSchema ?? {},
        query: seed.queryParamsSchema ?? {},
        path: seed.pathParamsSchema ?? {},
        headers: seed.headersSchema ?? {},
      },
      outputContract: seed.outputContract ?? {
        expectedStatusCodes: seed.expectedStatusCodes ?? [200],
        summary: seed.expectedResponseSummary ?? 'Respuesta documentada por catálogo y smoke tests.',
      },
      payloadOriginSummary:
        seed.payloadOriginSummary ??
        'Los valores de entrada provienen de body, query, path o headers validados por DTO/Zod cuando aplica; los metadatos técnicos los completa el backend.',
      sideEffectsSummary:
        seed.sideEffectsSummary ??
        (seed.method === 'GET'
          ? 'Lectura sin escritura de negocio esperada.'
          : 'Puede escribir estado operacional, auditoría, eventos internos o tablas de dominio según el caso de uso.'),
      metadataCompletenessScore: seed.metadataCompletenessScore ?? 75,
      expectedStatusCodes: seed.expectedStatusCodes ?? [200],
      minPayloadSchema: seed.minPayloadSchema ?? {},
      queryParamsSchema: seed.queryParamsSchema ?? {},
      pathParamsSchema: seed.pathParamsSchema ?? {},
      headersSchema: seed.headersSchema ?? {},
      requiresAuth: seed.requiresAuth ?? true,
      allowedRoles: seed.allowedRoles ?? [],
      containsPii: seed.containsPii ?? false,
      piiFields: seed.piiFields ?? [],
      riskLevel: seed.riskLevel ?? 'LOW',
      isDestructive: seed.isDestructive ?? false,
      isReadonly: seed.isReadonly ?? seed.method === 'GET',
      idempotencyRequired: seed.idempotencyRequired ?? false,
      requiresStressTest: seed.requiresStressTest ?? false,
      requiresIntegrationTest: seed.requiresIntegrationTest ?? false,
      isTestableFromPortal: seed.isTestableFromPortal ?? false,
      testEnvironmentOnly: seed.testEnvironmentOnly ?? true,
      ownerTeam: seed.ownerTeam ?? 'systems',
      status: seed.status ?? 'ACTIVE',
      version: 'v1',
      detectedFrom: seed.detectedFrom ?? 'manual_seed',
      confidenceLevel: seed.confidenceLevel ?? 'MEDIUM',
      reviewStatus: seed.reviewStatus ?? 'NEEDS_REVIEW',
      sourceFile: seed.sourceFile ?? null,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }

  async markDeprecatedCandidates(activeKeys: Set<string>): Promise<number> {
    const rows = await this.endpointModel.findAll({ attributes: ['id', 'method', 'fullPath', 'reviewStatus', 'status'] } as FindOptions);
    let updated = 0;
    for (const row of rows) {
      const key = `${row.method} ${row.fullPath}`;
      if (!activeKeys.has(key) && row.status === 'ACTIVE' && row.reviewStatus !== 'APPROVED') {
        row.status = 'DEPRECATED_CANDIDATE';
        row.updatedAtValue = new Date();
        await row.save();
        updated += 1;
      }
    }
    return updated;
  }

  async listTools(query: SystemsListQueryDto) {
    const result = await this.toolModel.findAndCountAll({
      where: buildToolWhere(query),
      order: [['code', 'ASC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findToolById(toolId: string): Promise<SystemToolCatalogModel | null> {
    return this.toolModel.findByPk(toolId);
  }

  findToolByCode(code: string): Promise<SystemToolCatalogModel | null> {
    return this.toolModel.findOne({ where: { code } } as FindOptions);
  }

  async upsertTool(seed: ToolSeed): Promise<void> {
    const now = new Date();
    await this.toolModel.upsert({
      code: seed.code,
      name: seed.name,
      type: seed.type,
      provider: seed.provider ?? null,
      purpose: seed.purpose,
      description:
        seed.description ??
        `${seed.name} se registra como herramienta de soporte del backend Atlas. Debe contar con owner, variables requeridas, estado operativo y evidencia de prueba cuando sea crítica.`,
      businessValue: seed.businessValue ?? seed.purpose,
      technicalUsage: seed.technicalUsage ?? `Usada por servicios o procesos del backend para ${seed.purpose.toLowerCase()}.`,
      auditNotes:
        seed.auditNotes ??
        'Debe quedar registrada cuando participe en decisiones críticas, integraciones externas, autenticación, almacenamiento, colas, pruebas o auditoría.',
      failureRisks:
        seed.failureRisks ??
        (seed.isCritical
          ? 'Falla crítica: puede degradar operación, seguridad, trazabilidad o disponibilidad del portal.'
          : 'Falla controlada: debe monitorearse y documentarse según su estado operativo.'),
      requiredEnvVars: seed.requiredEnvVars ?? [],
      hasSandbox: seed.hasSandbox ?? false,
      healthcheckRoute: seed.healthcheckRoute ?? null,
      requiresCredentials: seed.requiresCredentials ?? false,
      isCritical: seed.isCritical ?? false,
      status: seed.status ?? 'ACTIVE',
      ownerTeam: seed.ownerTeam ?? 'systems',
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }

  async listDataEntities(query: SystemsListQueryDto) {
    const result = await this.dataEntityModel.findAndCountAll({
      where: buildDataEntityWhere(query),
      order: [
        ['module', 'ASC'],
        ['tableName', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findDataEntityById(entityId: string): Promise<SystemDataEntityCatalogModel | null> {
    return this.dataEntityModel.findByPk(entityId);
  }

  findDataEntityByTable(schemaName: string, tableName: string): Promise<SystemDataEntityCatalogModel | null> {
    return this.dataEntityModel.findOne({ where: { schemaName, tableName } } as FindOptions);
  }

  async updateDataEntityMetadata(
    entityId: string,
    body: Record<string, unknown>,
  ): Promise<SystemDataEntityCatalogModel | null> {
    const entity = await this.dataEntityModel.findByPk(entityId);
    if (!entity) return null;

    const updatableFields = [
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

    for (const field of updatableFields) {
      if (field in body) {
        (entity as never)[field] = body[field] as never;
      }
    }
    entity.updatedAtValue = new Date();
    await entity.save();
    return entity;
  }

  async upsertDataEntity(seed: DataEntitySeed): Promise<void> {
    const now = new Date();
    await this.dataEntityModel.upsert({
      schemaName: seed.schemaName,
      tableName: seed.tableName,
      modelName: seed.modelName ?? null,
      entityName: seed.entityName,
      module: seed.module,
      businessPurpose: seed.businessPurpose,
      description: seed.description ?? seed.businessPurpose,
      technicalPurpose:
        seed.technicalPurpose ??
        `Tabla ${seed.schemaName}.${seed.tableName} registrada en el catálogo operativo para que endpoints, campos, relaciones y reglas puedan auditarse.`,
      businessProcess: seed.businessProcess ?? `Proceso operativo del módulo ${seed.module}.`,
      whyStore: seed.whyStore ?? 'Se guarda para sostener trazabilidad, continuidad operativa, auditoría y análisis posterior del negocio.',
      whoUses: seed.whoUses ?? ['sistemas', 'operaciones', 'riesgo', 'auditoría'],
      auditUsage: seed.auditUsage ?? 'Permite reconstruir quién consultó o modificó el dato, cuándo ocurrió y qué endpoint participó.',
      analysisUsage:
        seed.analysisUsage ?? 'Permite segmentar, medir calidad, construir reportes y detectar patrones operativos o de riesgo.',
      decisionUsage:
        seed.decisionUsage ??
        'Sirve para decisiones operativas del portal, priorización, control interno o investigación según el dominio.',
      dataNature: seed.dataNature ?? 'OPERACIONAL',
      domainCode: seed.domainCode ?? null,
      dataGrain: seed.dataGrain ?? `Una fila representa un registro operacional de ${seed.tableName}.`,
      sourceSystem: seed.sourceSystem ?? 'atlas_backend',
      operationalRulesJson: seed.operationalRulesJson ?? [],
      qualityRulesJson: seed.qualityRulesJson ?? [],
      keyRelationshipsSummary: seed.keyRelationshipsSummary ?? null,
      relationshipRationale: seed.relationshipRationale ?? null,
      internationalizationNotes:
        seed.internationalizationNotes ??
        'Usar tenant, país, moneda, zona horaria, idioma y políticas locales cuando el modelo escale a otros mercados.',
      dataOwner: seed.dataOwner ?? 'systems',
      containsPii: seed.containsPii,
      containsFinancialData: seed.containsFinancialData,
      containsRiskData: seed.containsRiskData,
      containsLegalData: seed.containsLegalData,
      containsDeviceData: seed.containsDeviceData,
      containsLocationData: seed.containsLocationData,
      isAuditCritical: seed.isAuditCritical,
      retentionPolicyCode: seed.retentionPolicyCode ?? null,
      status: seed.status ?? 'ACTIVE',
      detectedFrom: seed.detectedFrom,
      confidenceLevel: seed.confidenceLevel,
      reviewStatus: seed.reviewStatus,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }

  findToolRequirementsByEndpoint(endpointId: string): Promise<SystemEndpointToolRequirementModel[]> {
    return this.endpointToolModel.findAll({ where: { endpointId }, order: [['id', 'ASC']] } as FindOptions);
  }

  findDataImpactsByEndpoint(endpointId: string): Promise<SystemEndpointDataEntityImpactModel[]> {
    return this.dataImpactModel.findAll({
      where: { endpointId },
      order: [
        ['impactLevel', 'DESC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  findFieldImpactsByEndpoint(endpointId: string): Promise<SystemEndpointFieldImpactModel[]> {
    return this.fieldImpactModel.findAll({ where: { endpointId }, order: [['fieldName', 'ASC']] } as FindOptions);
  }

  findFieldImpactsByDataEntity(dataEntityId: string): Promise<SystemEndpointFieldImpactModel[]> {
    return this.fieldImpactModel.findAll({ where: { dataEntityId }, order: [['fieldName', 'ASC']] } as FindOptions);
  }

  findDataImpactsByEntity(dataEntityId: string): Promise<SystemEndpointDataEntityImpactModel[]> {
    return this.dataImpactModel.findAll({
      where: { dataEntityId },
      order: [
        ['impactLevel', 'DESC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  async listDataFields(query: SystemsListQueryDto) {
    const search = query.q?.trim();
    const result = await this.dataFieldModel.findAndCountAll({
      where: search
        ? {
            [Op.or]: [
              { tableName: { [Op.iLike]: `%${search}%` } },
              { columnName: { [Op.iLike]: `%${search}%` } },
              { businessMeaning: { [Op.iLike]: `%${search}%` } },
              { domainCode: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {},
      order: [
        ['tableName', 'ASC'],
        ['ordinalPosition', 'ASC'],
        ['columnName', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findFieldsByEntity(dataEntityId: string): Promise<SystemDataFieldCatalogModel[]> {
    return this.dataFieldModel.findAll({
      where: { dataEntityId },
      order: [
        ['ordinalPosition', 'ASC'],
        ['columnName', 'ASC'],
      ],
    } as FindOptions);
  }

  findFieldsByTable(schemaName: string, tableName: string): Promise<SystemDataFieldCatalogModel[]> {
    return this.dataFieldModel.findAll({
      where: { schemaName, tableName },
      order: [
        ['ordinalPosition', 'ASC'],
        ['columnName', 'ASC'],
      ],
    } as FindOptions);
  }

  async listRelationships(query: SystemsListQueryDto) {
    const search = query.q?.trim();
    const result = await this.relationshipModel.findAndCountAll({
      where: search
        ? {
            [Op.or]: [
              { sourceTable: { [Op.iLike]: `%${search}%` } },
              { targetTable: { [Op.iLike]: `%${search}%` } },
              { businessReason: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {},
      order: [
        ['sourceTable', 'ASC'],
        ['targetTable', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  async findRelationshipsByTable(schemaName: string, tableName: string): Promise<SystemDataRelationshipCatalogModel[]> {
    return this.relationshipModel.findAll({
      where: {
        [Op.or]: [
          { sourceSchema: schemaName, sourceTable: tableName },
          { targetSchema: schemaName, targetTable: tableName },
        ],
      },
      order: [
        ['sourceTable', 'ASC'],
        ['targetTable', 'ASC'],
      ],
    } as FindOptions);
  }

  async listOperationalRules(query: SystemsListQueryDto) {
    const search = query.q?.trim();
    const result = await this.operationalRuleModel.findAndCountAll({
      where: search
        ? {
            [Op.or]: [
              { ruleCode: { [Op.iLike]: `%${search}%` } },
              { tableName: { [Op.iLike]: `%${search}%` } },
              { endpointCode: { [Op.iLike]: `%${search}%` } },
              { description: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {},
      order: [
        ['scopeType', 'ASC'],
        ['ruleType', 'ASC'],
        ['ruleCode', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findOperationalRulesByTable(schemaName: string, tableName: string): Promise<SystemOperationalRuleCatalogModel[]> {
    return this.operationalRuleModel.findAll({
      where: { schemaName, tableName },
      order: [
        ['severity', 'DESC'],
        ['ruleType', 'ASC'],
      ],
    } as FindOptions);
  }

  async listDomains(query: SystemsListQueryDto) {
    const search = query.q?.trim();
    const result = await this.domainModel.findAndCountAll({
      where: search
        ? {
            [Op.or]: [
              { domainCode: { [Op.iLike]: `%${search}%` } },
              { domainName: { [Op.iLike]: `%${search}%` } },
              { description: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {},
      order: [['domainCode', 'ASC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findDomainByCode(domainCode: string): Promise<SystemDomainCatalogModel | null> {
    return this.domainModel.findOne({ where: { domainCode } } as FindOptions);
  }

  findPayloadContractsByEndpoint(endpointId: string): Promise<SystemEndpointPayloadContractModel[]> {
    return this.payloadContractModel.findAll({
      where: { endpointId },
      order: [
        ['contractType', 'ASC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  async upsertDataImpact(values: UpsertDataImpactInput): Promise<void> {
    const now = new Date();
    await this.dataImpactModel.upsert({
      endpointId: values.endpointId,
      dataEntityId: values.dataEntityId,
      operationType: values.operationType,
      impactLevel: values.impactLevel,
      isPrimaryEntity: values.isPrimaryEntity ?? false,
      isTransactional: values.operationType !== 'READ',
      rollbackRequired: values.operationType !== 'READ',
      affectsCustomerState: values.affectsCustomerState ?? false,
      affectsFinancialState: values.affectsFinancialState ?? false,
      affectsRiskState: values.affectsRiskState ?? false,
      affectsLegalState: values.affectsLegalState ?? false,
      affectsDeviceState: values.affectsDeviceState ?? false,
      affectsNotificationState: values.affectsNotificationState ?? false,
      requiresAuditLog: true,
      requiresRegressionTest: values.operationType !== 'READ',
      requiresStressTest: values.requiresStressTest ?? false,
      notes: values.notes ?? null,
      detectedFrom: values.detectedFrom ?? 'docs',
      confidenceLevel: values.confidenceLevel ?? 'MEDIUM',
      reviewStatus: values.reviewStatus ?? 'NEEDS_REVIEW',
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }
}
