import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Transaction } from 'sequelize';
import { CustomerSessionModel } from '../../../database/models/index.js';
import { toOffset } from '../../../common/utils/pagination/pagination.util.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `sessions.repository.ts`. Responsabilidad única:
 * ciclo de vida de la sesión (alta, cierre, búsqueda). Split mecánico, sin cambio de comportamiento.
 */
@Injectable()
export class SessionsLifecycleRepository {
  constructor(@InjectModel(CustomerSessionModel) private readonly customerSessionModel: typeof CustomerSessionModel) {}

  createSession(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      sessionTokenHash: string;
      channel: string;
      authMethod: string;
      ipAddress: string | null;
      userAgent: string | null;
      gpsLat: string | null;
      gpsLng: string | null;
      gpsAccuracyMeters: string | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerSessionModel> {
    return this.customerSessionModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        sessionTokenHash: values.sessionTokenHash,
        channel: values.channel,
        authMethod: values.authMethod,
        startedAt: values.now,
        endedAt: null,
        ipAddress: values.ipAddress,
        userAgent: values.userAgent,
        gpsLat: values.gpsLat,
        gpsLng: values.gpsLng,
        gpsAccuracyMeters: values.gpsAccuracyMeters,
        sessionStatus: 'active',
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  findSessionById(
    tenantId: string,
    customerId: string,
    sessionId: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerSessionModel | null> {
    return this.customerSessionModel.findOne({
      where: { tenantId, customerId, id: sessionId },
      transaction: options.transaction,
    } as FindOptions);
  }

  findSessionForOperations(tenantId: string, sessionId: string): Promise<CustomerSessionModel | null> {
    return this.customerSessionModel.findOne({ where: { tenantId, id: sessionId } } as FindOptions);
  }

  findLatestActiveSession(tenantId: string, customerId: string): Promise<CustomerSessionModel | null> {
    return this.customerSessionModel.findOne({
      where: { tenantId, customerId, sessionStatus: 'active' },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  async endSession(session: CustomerSessionModel, endedAt: Date, options: RepositoryOptions): Promise<CustomerSessionModel> {
    session.endedAt = endedAt;
    session.sessionStatus = 'ended';
    return session.save({ transaction: options.transaction });
  }

  findCustomerSessions(input: { tenantId: string; customerId: string; page: number; limit: number }) {
    return this.customerSessionModel.findAndCountAll({
      where: { tenantId: input.tenantId, customerId: input.customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: input.limit,
      offset: toOffset({ page: input.page, limit: input.limit }),
    } as FindAndCountOptions);
  }
}
