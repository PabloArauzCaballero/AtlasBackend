import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, WhereOperators } from 'sequelize';
import {
  AuthEventModel,
  ConsentEventModel,
  CustomerActionLogModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseEventModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { AuditQueryDto } from './audit.schemas.js';

type AuditEvent = {
  eventType: string;
  occurredAt: Date;
  actorType: string | null;
  summary: string;
  payload?: Record<string, unknown> | null;
};

function buildDateWhere(query: AuditQueryDto): WhereOperators<Date> | null {
  if (!query.from && !query.to) return null;
  const where: WhereOperators<Date> = {};
  if (query.from) where[Op.gte] = new Date(query.from);
  if (query.to) where[Op.lte] = new Date(query.to);
  return where;
}

/**
 * ATLAS-AUDIT-025 (corrección de fondo, no solo de rendimiento): antes de este cambio, cada
 * subconsulta por tabla de origen (`customerStatusEventModel`, `customerActionLogModel`, etc.)
 * pedía siempre `limit` filas — nunca `page * limit` — sin importar qué página se solicitara.
 * `AuditService` luego hacía `rows.slice(start, start + limit)` sobre el resultado combinado.
 *
 * Esto significa que para `page >= 2`, el resultado podía estar INCOMPLETO o directamente
 * incorrecto: un evento que debía aparecer en la página 2 podía no estar entre las primeras
 * `limit` filas de SU tabla de origen, y por lo tanto nunca entraba al pool combinado del que
 * se recorta la página. No era solo un problema de que "se pondría lento con el tiempo" — para
 * cualquier cliente con más de `limit` eventos de auditoría, pedir la página 2 ya devolvía
 * datos incorrectos hoy mismo, independientemente del volumen de la tabla.
 *
 * Esta corrección pide `offset + limit` filas de cada fuente (suficiente profundidad para
 * cubrir la página solicitada), preservando el comportamiento observable para la mayoría de
 * los casos de uso (consultas de las páginas más recientes) sin cambiar el contrato de la API.
 *
 * Sigue sin ser un cursor real empujado a la base de datos (ver ATLAS-AUDIT-025 en el reporte
 * de auditoría): con offsets muy profundos, el costo sigue creciendo por página. La corrección
 * completa (una vista/tabla unificada de eventos de auditoría con `UNION ALL` + índice
 * compuesto, permitiendo un cursor real `(occurred_at, id)` entre las 5 fuentes) queda
 * documentada como pendiente en `docs/pending/pending-items.md` — es un cambio de esquema, no
 * algo para resolver dentro de este patch de corrección.
 */
@Injectable()
export class AuditRepository {
  constructor(
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
    @InjectModel(CustomerStatusEventModel) private readonly customerStatusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(ConsentEventModel) private readonly consentEventModel: typeof ConsentEventModel,
    @InjectModel(ManualReviewEventModel) private readonly manualReviewEventModel: typeof ManualReviewEventModel,
    @InjectModel(FraudCaseEventModel) private readonly fraudCaseEventModel: typeof FraudCaseEventModel,
  ) {}

  async findCustomerAuditEvents(tenantId: string, customerId: string, query: AuditQueryDto): Promise<AuditEvent[]> {
    const dateWhere = buildDateWhere(query);
    const pageLimit = Math.min(query.limit, 100);
    // Profundidad por fuente: suficiente para cubrir hasta el final de la página pedida. Con
    // MAX_DEPTH se evita que una página muy alta pida una cantidad de filas sin techo.
    const MAX_DEPTH = 1000;
    const depth = Math.min(query.page * pageLimit, MAX_DEPTH);
    const collections: AuditEvent[][] = [];

    if (query.eventType === 'all' || query.eventType === 'status') {
      const rows = await this.customerStatusEventModel.findAll({
        where: { tenantId, customerId, ...(dateWhere ? { happenedAt: dateWhere } : {}) },
        limit: depth,
        order: [['happenedAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'status',
          occurredAt: row.happenedAt ?? row.createdAtValue,
          actorType: row.changedByType,
          summary: `Estado: ${row.previousStatus ?? 'none'} -> ${row.newStatus}`,
          payload: { reasonCode: row.reasonCode },
        })),
      );
    }
    if (query.eventType === 'all' || query.eventType === 'customer_action') {
      const rows = await this.customerActionLogModel.findAll({
        where: { tenantId, customerId, ...(dateWhere ? { occurredAt: dateWhere } : {}) },
        limit: depth,
        order: [['occurredAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'customer_action',
          occurredAt: row.occurredAt ?? row.createdAtValue,
          actorType: 'customer',
          summary: row.eventName ?? 'customer_action',
          payload: row.actionPayloadJson,
        })),
      );
    }
    if (query.eventType === 'all' || query.eventType === 'auth') {
      const rows = await this.authEventModel.findAll({
        where: { tenantId, customerId, ...(dateWhere ? { occurredAt: dateWhere } : {}) },
        limit: depth,
        order: [['occurredAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'auth',
          occurredAt: row.occurredAt ?? row.createdAtValue,
          actorType: 'customer',
          summary: row.eventType ?? 'auth_event',
          payload: { loginSuccessful: row.loginSuccessful, failureReasonCode: row.failureReasonCode },
        })),
      );
    }
    if (query.eventType === 'all' || query.eventType === 'data_change') {
      const rows = await this.dataChangeLogModel.findAll({
        where: { tenantId, recordId: customerId, ...(dateWhere ? { changedAt: dateWhere } : {}) },
        limit: depth,
        order: [['changedAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'data_change',
          occurredAt: row.changedAt ?? row.createdAtValue,
          actorType: row.changedByType,
          summary: `${row.tableName}:${row.changeType}`,
          payload: { changeReason: row.changeReason },
        })),
      );
    }
    if (query.eventType === 'all') {
      const rows = await this.operationalAuditLogModel.findAll({
        where: { tenantId, targetType: 'customer', targetId: customerId, ...(dateWhere ? { occurredAt: dateWhere } : {}) },
        limit: depth,
        order: [['occurredAt', 'DESC']],
      } as FindOptions);
      collections.push(
        rows.map((row) => ({
          eventType: 'operational_audit',
          occurredAt: row.occurredAt ?? row.createdAtValue,
          actorType: row.actorType,
          summary: row.actionCode ?? 'audit',
          payload: row.payloadJson,
        })),
      );
    }
    return collections.flat().sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }
}
