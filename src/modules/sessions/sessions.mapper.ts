import { CustomerDeviceLinkModel, CustomerSessionModel, DeviceModel } from '../../database/models/index.js';
import { SessionGpsResult, StartSessionResponseDto } from './sessions.dtos.js';

export function toStartSessionResponse(input: {
  customerId: string;
  session: CustomerSessionModel;
  device: DeviceModel;
  link: CustomerDeviceLinkModel | null;
  gps: SessionGpsResult;
  nextStep: string;
}): StartSessionResponseDto {
  return {
    customerId: input.customerId,
    sessionId: String(input.session.id),
    deviceId: String(input.device.id),
    sessionStatus: input.session.sessionStatus ?? 'active',
    gpsObservationId: input.gps.gpsObservationId,
    gpsObservationCreated: input.gps.gpsObservationCreated,
    gpsObservationSkippedReason: input.gps.gpsObservationSkippedReason,
    deviceTrustLevel: input.link?.trustLevel ?? 'new',
    nextStep: input.nextStep,
  };
}
