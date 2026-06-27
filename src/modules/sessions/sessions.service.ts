import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { buildPaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CreateCustomerSessionResponseDto, PaginatedCustomerSessionsResponseDto } from './sessions.dtos.js';
import { toCreateSessionResponse, toCustomerSessionResponse } from './sessions.mapper.js';
import { SessionsRepository } from './sessions.repository.js';
import { CreateCustomerSessionDto, ListCustomerSessionsQueryDto } from './sessions.schemas.js';

function assertCustomerAccess(customerId: string, currentUser: AuthenticatedUser): void {
  if (currentUser.role === 'customer' && currentUser.customerId !== customerId) {
    throw new ForbiddenException('El token del cliente no corresponde a la sesión solicitada.');
  }
}

function numberToDecimalString(value: number | undefined): string | null {
  return value === undefined ? null : String(value);
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly customersRepository: CustomersRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async createCustomerSession(input: {
    tenantId: string;
    customerId: string;
    body: CreateCustomerSessionDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }): Promise<CreateCustomerSessionResponseDto> {
    assertCustomerAccess(input.customerId, input.currentUser);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado para registrar sesión.');
    }

    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      let globalDevice = await this.sessionsRepository.findGlobalDevice(
        input.body.deviceFingerprintHash,
        input.body.fingerprintVersion,
        { transaction },
      );

      if (!globalDevice) {
        globalDevice = await this.sessionsRepository.createGlobalDevice(
          {
            deviceFingerprint: input.body.deviceFingerprintHash,
            fingerprintVersion: input.body.fingerprintVersion,
            now,
          },
          { transaction },
        );
      } else {
        await this.sessionsRepository.touchGlobalDevice(globalDevice, now, { transaction });
      }

      let device = await this.sessionsRepository.findDevice(
        input.tenantId,
        input.body.deviceFingerprintHash,
        input.body.fingerprintVersion,
        { transaction },
      );

      if (!device) {
        device = await this.sessionsRepository.createDevice(
          {
            tenantId: input.tenantId,
            globalDeviceFingerprintId: String(globalDevice.id),
            deviceFingerprint: input.body.deviceFingerprintHash,
            fingerprintVersion: input.body.fingerprintVersion,
            now,
          },
          { transaction },
        );
      } else {
        await this.sessionsRepository.touchDevice(device, now, { transaction });
      }

      let link = await this.sessionsRepository.findCustomerDeviceLink(input.tenantId, input.customerId, String(device.id), {
        transaction,
      });

      if (!link) {
        link = await this.sessionsRepository.createCustomerDeviceLink(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            deviceId: String(device.id),
            now,
          },
          { transaction },
        );
      }

      const session = await this.sessionsRepository.createSession(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          deviceId: String(device.id),
          sessionTokenHash: sha256Hex(randomUUID()),
          channel: input.body.channel,
          authMethod: input.body.authMethod,
          ipAddress: input.ipAddress,
          userAgent: input.body.userAgent ?? null,
          gpsLat: numberToDecimalString(input.body.gpsLat),
          gpsLng: numberToDecimalString(input.body.gpsLng),
          gpsAccuracyMeters: numberToDecimalString(input.body.gpsAccuracyMeters),
          now,
        },
        { transaction },
      );

      await this.sessionsRepository.touchCustomerDeviceLink(link, String(session.id), now, { transaction });

      if (input.body.deviceSnapshot) {
        await this.sessionsRepository.createDeviceSnapshot(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            deviceId: String(device.id),
            sessionId: String(session.id),
            brand: input.body.deviceSnapshot.brand ?? null,
            model: input.body.deviceSnapshot.model ?? null,
            osFamily: input.body.deviceSnapshot.osFamily ?? null,
            osVersion: input.body.deviceSnapshot.osVersion ?? null,
            appVersion: input.body.deviceSnapshot.appVersion ?? null,
            isRooted: input.body.deviceSnapshot.isRooted ?? null,
            isEmulator: input.body.deviceSnapshot.isEmulator ?? null,
            vpnDetected: input.body.deviceSnapshot.vpnDetected ?? null,
            now,
          },
          { transaction },
        );
      }

      return toCreateSessionResponse({ session, device });
    });
  }

  async listCustomerSessions(input: {
    tenantId: string;
    customerId: string;
    query: ListCustomerSessionsQueryDto;
    currentUser: AuthenticatedUser;
  }): Promise<PaginatedCustomerSessionsResponseDto> {
    assertCustomerAccess(input.customerId, input.currentUser);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const result = await this.sessionsRepository.findCustomerSessions({
      tenantId: input.tenantId,
      customerId: input.customerId,
      page: input.query.page,
      limit: input.query.limit,
    });

    return {
      items: result.rows.map(toCustomerSessionResponse),
      meta: buildPaginationMeta({ page: input.query.page, limit: input.query.limit }, result.count),
    };
  }
}
