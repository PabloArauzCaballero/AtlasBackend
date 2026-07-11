import { Injectable } from '@nestjs/common';
import { SystemEndpointCatalogModel, SystemToolCatalogModel } from '../../database/models/index.js';
import { SystemsToolInferenceRepository } from './systems-tool-inference.repository.js';
import { readSourcesForEndpoint } from './systems-source-scan.util.js';

const TOOL_PATTERNS: Array<{
  toolCode: string;
  usageType: string;
  failureImpact: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  isRequired: boolean;
  requiresMock: boolean;
  source: RegExp;
  notes: string;
}> = [
  {
    toolCode: 'JWT',
    usageType: 'AUTH',
    failureImpact: 'CRITICAL',
    isRequired: true,
    requiresMock: false,
    source: /JwtAuthGuard|@Public\(|accessToken|refreshToken|JWT_/i,
    notes: 'Inferido por uso de autenticación JWT/guards/tokens.',
  },
  {
    toolCode: 'ZOD',
    usageType: 'VALIDATION',
    failureImpact: 'HIGH',
    isRequired: true,
    requiresMock: false,
    source: /ZodValidationPipe|\.safeParse\(|z\.object\(/i,
    notes: 'Inferido por validación Zod en DTOs o pipes.',
  },
  {
    toolCode: 'POSTGRES',
    usageType: 'DATABASE',
    failureImpact: 'CRITICAL',
    isRequired: true,
    requiresMock: false,
    source: /@InjectModel|@InjectConnection|sequelize|Model\.|findAndCountAll|findByPk|create\(|update\(/i,
    notes: 'Inferido por acceso a modelos Sequelize o conexión SQL.',
  },
  {
    toolCode: 'SEQUELIZE',
    usageType: 'DATABASE_ORM',
    failureImpact: 'CRITICAL',
    isRequired: true,
    requiresMock: false,
    source: /sequelize-typescript|SequelizeModule|@InjectModel|Model</i,
    notes: 'Inferido por ORM Sequelize.',
  },
  {
    toolCode: 'REDIS',
    usageType: 'CACHE',
    failureImpact: 'HIGH',
    isRequired: false,
    requiresMock: true,
    source: /Redis|ioredis|REDIS_URL|redisClient/i,
    notes: 'Inferido por cliente Redis/cache/rate-limit.',
  },
  {
    toolCode: 'OUTBOX_EVENTS_DB',
    usageType: 'OUTBOX',
    failureImpact: 'HIGH',
    isRequired: false,
    requiresMock: false,
    source: /OutboxEvent|outbox|EventsService|emit\(/i,
    notes: 'Inferido por patrón outbox/eventos persistidos.',
  },
  {
    toolCode: 'IDEMPOTENCY_KEYS_DB',
    usageType: 'IDEMPOTENCY',
    failureImpact: 'CRITICAL',
    isRequired: true,
    requiresMock: false,
    source: /Idempotency|idempotency|x-idempotency-key/i,
    notes: 'Inferido por control de idempotencia.',
  },
  {
    toolCode: 'OPERATIONAL_AUDIT_LOGS',
    usageType: 'OBSERVABILITY',
    failureImpact: 'HIGH',
    isRequired: true,
    requiresMock: false,
    source: /OperationalAuditLog|audit|Audit/i,
    notes: 'Inferido por auditoría operacional.',
  },
  {
    toolCode: 'SYSTEM_ACTION_LOGS',
    usageType: 'OBSERVABILITY',
    failureImpact: 'HIGH',
    isRequired: true,
    requiresMock: false,
    source: /HttpActionLogInterceptor|system_action_logs|SystemActionLog/i,
    notes: 'Inferido por auditoría HTTP SystemsOps.',
  },
  {
    toolCode: 'S3_OR_OBJECT_STORAGE',
    usageType: 'STORAGE',
    failureImpact: 'HIGH',
    isRequired: false,
    requiresMock: true,
    source: /S3|ObjectStorage|bucket|file|evidence|document/i,
    notes: 'Inferido por gestión de archivos/evidencias/documentos.',
  },
  {
    toolCode: 'WHATSAPP_GENERIC',
    usageType: 'NOTIFICATION',
    failureImpact: 'HIGH',
    isRequired: false,
    requiresMock: true,
    source: /WhatsApp|notification|message|delivery|template/i,
    notes: 'Inferido por módulos de mensajería/notificaciones.',
  },
  {
    toolCode: 'INFOCENTER',
    usageType: 'PROVIDER_CALL',
    failureImpact: 'CRITICAL',
    isRequired: false,
    requiresMock: true,
    source: /InfoCenter|bureau|externalProvider|providerRequest|external-data/i,
    notes: 'Inferido por uso de proveedores externos/burós.',
  },
];

type ToolInference = {
  endpointId: string;
  endpointCode: string;
  toolCode: string;
  usageType: string;
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  notes: string;
};

@Injectable()
export class SystemsToolInferenceService {
  constructor(private readonly repository: SystemsToolInferenceRepository) {}

  async infer(input: { persist: boolean }) {
    const [endpoints, tools] = await Promise.all([this.repository.listActiveEndpoints(), this.repository.listTools()]);
    const toolsByCode = new Map(tools.map((tool) => [tool.code, tool]));
    const inferences: ToolInference[] = [];
    let persisted = 0;
    let skippedMissingTools = 0;

    for (const endpoint of endpoints) {
      const source = readSourcesForEndpoint(endpoint);
      if (!source) continue;
      for (const pattern of TOOL_PATTERNS) {
        const tool = toolsByCode.get(pattern.toolCode);
        if (!tool) {
          skippedMissingTools += 1;
          continue;
        }
        if (!pattern.source.test(source) && !pattern.source.test(endpoint.fullPath)) continue;
        const inference = {
          endpointId: String(endpoint.id),
          endpointCode: endpoint.code,
          toolCode: tool.code,
          usageType: pattern.usageType,
          confidenceLevel: this.confidenceFor(endpoint, tool, source),
          notes: pattern.notes,
        } satisfies ToolInference;
        inferences.push(inference);
        if (input.persist) {
          await this.repository.upsertRequirement(endpoint, tool, pattern);
          persisted += 1;
        }
      }
    }

    return {
      inferred: inferences.length,
      persisted,
      skippedMissingTools,
      reviewStatus: input.persist ? 'NEEDS_REVIEW' : 'DRY_RUN',
      items: inferences.slice(0, 500),
    };
  }

  private confidenceFor(endpoint: SystemEndpointCatalogModel, tool: SystemToolCatalogModel, source: string): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (endpoint.riskLevel === 'CRITICAL' && tool.isCritical) return 'HIGH';
    if (source.length > 5000) return 'MEDIUM';
    return 'LOW';
  }
}
