import { Injectable } from '@nestjs/common';
import { DataEntitySeed, SystemRiskLevel } from './systems-ops.types.js';

const PII_PATTERN = /(customer|identity|contact|auth|consent|privacy|address|evidence|document|phone|email|session|token)/i;
const RISK_PATTERN = /(risk|fraud|watchlist|feature|score|observation|quality|provider|reputation|sim|ip_)/i;
const LEGAL_PATTERN = /(consent|privacy|retention|classification|sensitive|subject_request)/i;
const DEVICE_PATTERN = /(device|fingerprint|sim|ip_reputation|telemetry|metric|behavior)/i;
const LOCATION_PATTERN = /(gps|address|location)/i;
const AUDIT_PATTERN = /(audit|log|event|outbox|job|idempotency|change)/i;
const FINANCIAL_PATTERN = /(payment|purchase|installment|credit|limit|settlement|merchant|mdr|loan|debt|collection)/i;

@Injectable()
export class SystemsCatalogClassifierService {
  classifyTable(tableName: string, modelName: string | null): DataEntitySeed {
    const normalized = tableName.toLowerCase();
    const containsPii = PII_PATTERN.test(normalized);
    const containsRiskData = RISK_PATTERN.test(normalized);
    const containsLegalData = LEGAL_PATTERN.test(normalized);
    const containsDeviceData = DEVICE_PATTERN.test(normalized);
    const containsLocationData = LOCATION_PATTERN.test(normalized);
    const containsFinancialData = FINANCIAL_PATTERN.test(normalized);
    const isAuditCritical = AUDIT_PATTERN.test(normalized) || containsPii || containsRiskData || containsFinancialData;
    return {
      schemaName: 'public',
      tableName,
      modelName,
      entityName: this.toEntityName(tableName),
      module: this.moduleForTable(normalized),
      businessPurpose: `Entidad de datos ${tableName} detectada desde modelos Sequelize. Debe revisarse y aprobarse en el portal SystemsOps.`,
      containsPii,
      containsFinancialData,
      containsRiskData,
      containsLegalData,
      containsDeviceData,
      containsLocationData,
      isAuditCritical,
      detectedFrom: 'model_scan',
      confidenceLevel: 'HIGH',
      reviewStatus: 'AUTO_DETECTED',
    };
  }

  riskLevelForEndpoint(method: string, path: string): SystemRiskLevel {
    const normalized = path.toLowerCase();
    if (/risk|fraud|kyc|identity|external-data|auth\/provision|decision|privacy|consent/.test(normalized)) return 'CRITICAL';
    if (method !== 'GET' && /customer|session|telemetry|notification|events|catalog|jobs/.test(normalized)) return 'HIGH';
    if (method !== 'GET') return 'MEDIUM';
    return 'LOW';
  }

  containsPiiForEndpoint(path: string): boolean {
    return /customer|kyc|identity|contact|consent|privacy|session|auth|telemetry|external-data|notification/i.test(path);
  }

  private moduleForTable(tableName: string): string {
    if (tableName.startsWith('risk') || tableName.includes('feature')) return 'risk';
    if (tableName.includes('fraud') || tableName.includes('watchlist')) return 'fraud';
    if (tableName.includes('consent') || tableName.includes('privacy') || tableName.includes('retention')) return 'legal_privacy';
    if (tableName.includes('device') || tableName.includes('sim') || tableName.includes('ip_reputation')) return 'device_intelligence';
    if (tableName.includes('notification')) return 'notifications';
    if (tableName.includes('catalog') || tableName.includes('definition') || tableName.includes('policy')) return 'catalog_management';
    if (tableName.includes('provider') || tableName.includes('external')) return 'external_data';
    if (tableName.includes('audit') || tableName.includes('log') || tableName.includes('event') || tableName.includes('outbox'))
      return 'audit_runtime';
    if (tableName.includes('customer')) return 'customers';
    return 'systems';
  }

  private toEntityName(tableName: string): string {
    return tableName
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
