/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Guarda el expediente y su historia: lo que cambió, quién lo cambió y en qué orden.
 * @system escribe `support_cases` y añade eventos encadenados por hash con secuencia atómica.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { CreationAttributes, Op, QueryTypes, Transaction, WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportCaseEventModel, SupportCaseModel } from '../../database/models/index.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { redactSensitiveObject } from '../../common/utils/privacy/redaction.util.js';
import { caseEventHash, eventContentHashOf } from './domain/support-hash-chain.js';
import type { SupportCaseEventType } from './support.constants.js';
import { SupportCaseSearch, supportCaseSearchConditions } from './support-case-list.where.js';

const CASES = `${atlasSchemaFor('support_cases')}.support_cases`;
const RESOLUTIONS = `${atlasSchemaFor('support_resolutions')}.support_resolutions`;

export type RepositoryOptions = { transaction?: Transaction };

export interface AppendCaseEventInput {
  tenantId: string;
  caseId: string;
  eventType: SupportCaseEventType;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
}

export interface ListCasesFilter {
  tenantId: string;
  customerId?: string | null;
  partnerProfileId?: string | null;
  queueId?: string | null;
  categoryId?: string | null;
  caseType?: string | null;
  assigneeAgentId?: string | null;
  statuses?: readonly string[];
  priorities?: readonly string[];
  openedByActorId?: string | null;
  resolutionCode?: string | null;
  rootCauseCode?: string | null;
  q?: SupportCaseSearch['q'];
  restrictedVisibleTo?: SupportCaseSearch['restrictedVisibleTo'];
  limit: number;
  cursorOpenedAt?: Date | null;
  cursorId?: string | null;
}

@Injectable()
export class SupportCaseRepository {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(SupportCaseModel) private readonly cases: typeof SupportCaseModel,
    @InjectModel(SupportCaseEventModel) private readonly events: typeof SupportCaseEventModel,
  ) {}

  create(values: CreationAttributes<SupportCaseModel>, options: RepositoryOptions = {}): Promise<SupportCaseModel> {
    return this.cases.create(values, { transaction: options.transaction });
  }

  findById(tenantId: string, caseId: string, options: RepositoryOptions = {}): Promise<SupportCaseModel | null> {
    return this.cases.findOne({ where: { tenantId, id: caseId, deleted: false }, transaction: options.transaction });
  }

  findByNumber(tenantId: string, caseNumber: string): Promise<SupportCaseModel | null> {
    return this.cases.findOne({ where: { tenantId, caseNumber, deleted: false } });
  }

  async requireById(tenantId: string, caseId: string, options: RepositoryOptions = {}): Promise<SupportCaseModel> {
    const found = await this.findById(tenantId, caseId, options);
    if (!found) throw new NotFoundException({ code: 'SUPPORT_CASE_NOT_FOUND', caseId });
    return found;
  }

  /**
   * Bloquea la fila del caso antes de decidir sobre ella.
   *
   * Toda transición pasa por aquí: sin el `FOR UPDATE`, dos agentes que resuelven el mismo caso a la
   * vez leerían ambos `IN_PROGRESS`, ambos validarían la transición y ambos escribirían — dejando
   * dos resoluciones y un solo caso.
   */
  async lockById(tenantId: string, caseId: string, transaction: Transaction): Promise<SupportCaseModel> {
    const found = await this.cases.findOne({
      where: { tenantId, id: caseId, deleted: false },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!found) throw new NotFoundException({ code: 'SUPPORT_CASE_NOT_FOUND', caseId });
    return found;
  }

  async update(tenantId: string, caseId: string, values: Partial<SupportCaseModel>, options: RepositoryOptions = {}): Promise<void> {
    await this.cases.update({ ...values, updatedAtValue: new Date() } as Partial<SupportCaseModel>, {
      where: { tenantId, id: caseId },
      transaction: options.transaction,
    });
  }

  /**
   * Añade un evento a la historia del caso, encadenado al anterior.
   *
   * La secuencia se obtiene incrementando `last_event_sequence` en la misma sentencia que la lee:
   * dos eventos simultáneos —el cierre del agente y el aviso de SLA del temporizador— reciben
   * números distintos sin que ninguno tenga que esperar a leer un COUNT.
   *
   * El payload se REDACTA antes de guardarse. Un `payload_json` es el vector clásico por el que la
   * PII acaba en exportaciones y logs: aquí entra ya limpio, no se limpia al salir.
   */
  async appendEvent(input: AppendCaseEventInput, transaction: Transaction): Promise<SupportCaseEventModel> {
    const [sequenceRow] = await this.sequelize.query<{ last_event_sequence: string }>(
      `UPDATE ${CASES}
          SET last_event_sequence = last_event_sequence + 1, last_activity_at = NOW(), _updated_at = NOW()
        WHERE _tenant_id = :tenantId AND _id = :caseId
      RETURNING last_event_sequence;`,
      { replacements: { tenantId: input.tenantId, caseId: input.caseId }, type: QueryTypes.SELECT, transaction },
    );
    if (!sequenceRow) throw new NotFoundException({ code: 'SUPPORT_CASE_NOT_FOUND', caseId: input.caseId });

    const sequenceNumber = String(sequenceRow.last_event_sequence);
    const previous = await this.events.findOne({
      where: { caseId: input.caseId },
      order: [['sequence_number', 'DESC']],
      transaction,
    });

    const occurredAt = new Date();
    const safePayload = redactSensitiveObject(input.payload) as Record<string, unknown>;
    const contentHash = eventContentHashOf(input.eventType, safePayload);
    const eventHash = caseEventHash({
      caseId: input.caseId,
      sequenceNumber,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId,
      occurredAtIso: occurredAt.toISOString(),
      contentHash,
      previousHash: previous?.eventHash ?? null,
    });

    return this.events.create(
      {
        tenantId: input.tenantId,
        caseId: input.caseId,
        sequenceNumber,
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId,
        occurredAt,
        payloadJson: safePayload,
        previousHash: previous?.eventHash ?? null,
        eventHash,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
      } as CreationAttributes<SupportCaseEventModel>,
      { transaction },
    );
  }

  listEvents(caseId: string, limit = 200): Promise<SupportCaseEventModel[]> {
    return this.events.findAll({ where: { caseId }, order: [['sequence_number', 'ASC']], limit });
  }

  /**
   * Listado por cursor `(openedAt, id)` y nunca por OFFSET.
   *
   * Un backlog de soporte crece sin techo y se pagina hacia atrás: con OFFSET, la página 200 obliga
   * a Postgres a descartar 4 000 filas antes de devolver 20, y un caso nuevo desplaza todo lo que el
   * agente estaba mirando.
   */
  listCases(filter: ListCasesFilter): Promise<SupportCaseModel[]> {
    const where = this.listWhere(filter);
    const cursor =
      filter.cursorOpenedAt && filter.cursorId
        ? {
            [Op.or]: [
              { openedAt: { [Op.lt]: filter.cursorOpenedAt } },
              { openedAt: filter.cursorOpenedAt, id: { [Op.lt]: filter.cursorId } },
            ],
          }
        : {};

    return this.cases.findAll({
      where: { ...where, ...cursor },
      order: [
        ['opened_at', 'DESC'],
        ['_id', 'DESC'],
      ],
      limit: filter.limit,
    });
  }

  /**
   * Los contadores de la bandeja sobre el filtro ENTERO, no sobre la página: la bandeja pagina por
   * cursor y no conoce su total, así que las tarjetas «visibles» contaban sólo las 20 filas cargadas.
   */
  async summarizeCases(filter: Omit<ListCasesFilter, 'limit' | 'cursorOpenedAt' | 'cursorId'>) {
    const where = this.listWhere(filter);
    const andAlso = (extra: WhereOptions) => ({ ...where, [Op.and]: [...(where[Op.and] ?? []), extra] });
    const count = (extra: WhereOptions) => this.cases.count({ where: andAlso(extra) });
    const [total, highPriority, unassigned] = await Promise.all([
      count({}),
      count({ priority: { [Op.in]: ['P1', 'P2'] } }),
      count({ currentAssigneeAgentId: null }),
    ]);
    return { total, highPriority, unassigned };
  }

  private listWhere(filter: Omit<ListCasesFilter, 'limit'>): Record<string | symbol, unknown> & { [Op.and]?: WhereOptions[] } {
    const where: WhereOptions = { tenantId: filter.tenantId, deleted: false };
    const conditions: Record<string, unknown> = {};

    if (filter.customerId) conditions.subjectCustomerId = filter.customerId;
    if (filter.partnerProfileId) conditions.subjectPartnerProfileId = filter.partnerProfileId;
    if (filter.queueId) conditions.queueId = filter.queueId;
    if (filter.categoryId) conditions.categoryId = filter.categoryId;
    if (filter.caseType) conditions.caseType = filter.caseType;
    if (filter.assigneeAgentId) conditions.currentAssigneeAgentId = filter.assigneeAgentId;
    if (filter.openedByActorId) conditions.openedByActorId = filter.openedByActorId;
    if (filter.statuses?.length) conditions.status = { [Op.in]: filter.statuses };
    if (filter.priorities?.length) conditions.priority = { [Op.in]: filter.priorities };

    const byResolution = this.resolutionCondition(filter);
    if (byResolution) conditions.id = byResolution;

    const search = supportCaseSearchConditions(filter.tenantId, filter, (value) => this.sequelize.escape(value));
    return { ...where, ...conditions, ...(search.length ? { [Op.and]: search } : {}) };
  }

  /**
   * Filtrar por cómo se resolvió, cuando la resolución no vive en el caso.
   *
   * `resolution_code` y `root_cause_code` están en `support_resolutions`, una fila por resolución y
   * con las anteriores marcadas `superseded_at`: un caso reabierto y vuelto a resolver tiene varias.
   * Se filtra sólo por la VIGENTE, porque preguntar «cuántos cerramos por causa desconocida» y que
   * cuente también la explicación que ya fue reemplazada daría un número más alto que la realidad.
   *
   * Los códigos llegan validados contra el catálogo cerrado en Zod; aun así se escapan, porque una
   * subconsulta construida por concatenación no debe depender de que el esquema de arriba no cambie.
   */
  private resolutionCondition(filter: Omit<ListCasesFilter, 'limit'>): WhereOptions | null {
    const clauses: string[] = [];
    if (filter.resolutionCode) clauses.push(`resolution_code = ${this.sequelize.escape(filter.resolutionCode)}`);
    if (filter.rootCauseCode) clauses.push(`root_cause_code = ${this.sequelize.escape(filter.rootCauseCode)}`);
    if (!clauses.length) return null;

    return {
      [Op.in]: this.sequelize.literal(
        `(SELECT case_id FROM ${RESOLUTIONS} WHERE _tenant_id = ${this.sequelize.escape(filter.tenantId)}
            AND _deleted = FALSE AND superseded_at IS NULL AND ${clauses.join(' AND ')})`,
      ),
    } as unknown as WhereOptions;
  }

  /** Casos abiertos del mismo sujeto sobre la misma entidad: alimenta el aviso de duplicado. */
  findOpenCasesForCustomer(tenantId: string, customerId: string, caseType: string): Promise<SupportCaseModel[]> {
    return this.cases.findAll({
      where: {
        tenantId,
        subjectCustomerId: customerId,
        caseType,
        deleted: false,
        status: { [Op.notIn]: ['CLOSED', 'CANCELLED'] },
      },
      order: [['opened_at', 'DESC']],
      limit: 5,
    });
  }
}
