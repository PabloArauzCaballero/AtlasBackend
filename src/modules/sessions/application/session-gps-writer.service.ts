import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { SessionGpsResult } from '../sessions.dtos.js';
import { SessionsRepository } from '../sessions.repository.js';
import { decimal, toDate } from './sessions.shared.js';

@Injectable()
export class SessionGpsWriterService {
  constructor(private readonly sessionsRepository: SessionsRepository) {}

  async createSessionGpsIfAllowed(input: {
    tenantId: string;
    customerId: string;
    sessionId: string;
    gpsObservation: { lat: number; lng: number; accuracyMeters?: number; capturedAt?: string } | undefined;
    canStoreGps: boolean;
    defaultCapturedAt: Date;
    transaction: Transaction;
  }): Promise<SessionGpsResult> {
    if (!input.gpsObservation) {
      return { gpsObservationId: null, gpsObservationCreated: false, gpsObservationSkippedReason: 'gps_not_provided' };
    }
    if (!input.canStoreGps) {
      return { gpsObservationId: null, gpsObservationCreated: false, gpsObservationSkippedReason: 'location_permission_not_granted' };
    }

    const addressContext = await this.sessionsRepository.findCurrentAddressContext(input.tenantId, input.customerId, {
      transaction: input.transaction,
    });
    const capturedAt = toDate(input.gpsObservation.capturedAt, input.defaultCapturedAt);
    const gps = await this.sessionsRepository.createGpsObservation(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        sessionId: input.sessionId,
        customerAddressId: addressContext.addressId,
        addressVersionId: addressContext.addressVersionId,
        gpsLat: decimal(input.gpsObservation.lat, 7) ?? '0.0000000',
        gpsLng: decimal(input.gpsObservation.lng, 7) ?? '0.0000000',
        gpsAccuracyMeters: decimal(input.gpsObservation.accuracyMeters, 2),
        capturedAt,
      },
      { transaction: input.transaction },
    );

    return { gpsObservationId: String(gps.id), gpsObservationCreated: true, gpsObservationSkippedReason: null };
  }
}
