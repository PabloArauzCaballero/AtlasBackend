/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza deja constancia de cada entrega del dispositivo, para poder demostrar después qué se recibió y con qué permiso.
 * @system escribe el paso de onboarding y la traza de auditoría que acompañan a cada lote.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import {
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
} from '../../../database/models/index.js';

/**
 * El diario del módulo, con modelos propios y no con el repositorio de onboarding.
 *
 * Estas tres tablas las escriben media docena de módulos y ninguno se las presta: importar el
 * repositorio de `customer-onboarding` sólo para anotar un paso ataría este módulo a un contenedor
 * de inyección que arrastra veinte servicios de alta, y haría que un cambio en el alta pudiera
 * romper la sincronización de la agenda. Tres modelos y tres métodos salen más baratos.
 */
@Injectable()
export class DeviceSignalsJournalRepository {
  constructor(
    @InjectModel(OnboardingFlowModel)
    private readonly flowModel: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel)
    private readonly stepEventModel: typeof OnboardingStepEventModel,
    @InjectModel(OperationalAuditLogModel)
    private readonly auditLogModel: typeof OperationalAuditLogModel,
  ) {}

  findLatestOnboardingFlow(
    tenantId: string,
    customerId: string,
    options: { transaction?: Transaction } = {},
  ): Promise<OnboardingFlowModel | null> {
    return this.flowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  createStepEvent(
    values: {
      tenantId: string;
      onboardingFlowId: string | null;
      stepCode: string;
      eventType: string;
      happenedAt: Date;
      payloadJson: Record<string, unknown> | null;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<OnboardingStepEventModel> {
    return this.stepEventModel.create(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        stepCode: values.stepCode,
        eventType: values.eventType,
        startedAt: values.happenedAt,
        endedAt: null,
        durationMs: null,
        errorCount: 0,
        payloadJson: values.payloadJson,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createAuditLog(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      ipAddress: string | null;
      payloadJson: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<OperationalAuditLogModel> {
    return this.auditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: values.ipAddress,
        userAgent: null,
        payloadJson: values.payloadJson,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  /**
   * Las dos anotaciones de una sincronización de agenda, dentro de la misma transacción.
   *
   * El paso de onboarding cuenta la historia del expediente —qué se entregó, cuánto y con cuántos
   * otros expedientes comparte números—; la traza de auditoría cuenta quién lo pidió, desde qué IP y
   * con qué consentimiento. Son dos lectores distintos y por eso son dos filas, no una.
   *
   * `rawContactsStored: true` va en la traza siempre y por construcción. Que la fila lo afirme
   * importa el día que alguien tenga que demostrar qué se guardó —una auditoría, una solicitud de
   * acceso, una consulta del regulador—: la alternativa es leer el código de la versión que corría
   * entonces.
   */
  async recordAddressBookSync(
    values: {
      tenantId: string;
      customerId: string;
      actorType: string;
      actorInternalUserId: string | null;
      ipAddress: string | null;
      onboardingFlowId: string | null;
      computationRunId: string;
      consentId: string;
      algorithmVersion: string;
      isFinalBatch: boolean;
      /** `limited` cuando iOS 18 dejó ver sólo los contactos elegidos. */
      accessScope: 'all' | 'limited';
      totalContactsInDevice: number;
      created: number;
      updated: number;
      totalStored: number;
      /** Cuántos otros expedientes comparten algún número. `null` si no tocaba medirlo en este lote. */
      customersSharingContacts: number | null;
      occurredAt: Date;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    await this.createStepEvent(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        stepCode: 'address_book_synced',
        eventType: values.isFinalBatch ? 'completed' : 'in_progress',
        happenedAt: values.occurredAt,
        payloadJson: {
          algorithmVersion: values.algorithmVersion,
          accessScope: values.accessScope,
          batchSize: values.created + values.updated,
          totalContactsInDevice: values.totalContactsInDevice,
          totalStored: values.totalStored,
          ...(values.customersSharingContacts === null
            ? {}
            : { customersSharingContacts: values.customersSharingContacts }),
        },
      },
      options,
    );

    await this.createAuditLog(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actionCode: 'customer_device_signals.address_book_sync',
        targetType: 'customer',
        targetId: values.customerId,
        ipAddress: values.ipAddress,
        payloadJson: {
          computationRunId: values.computationRunId,
          consentId: values.consentId,
          created: values.created,
          updated: values.updated,
          rawContactsStored: true,
        },
        occurredAt: values.occurredAt,
      },
      options,
    );
  }
}
