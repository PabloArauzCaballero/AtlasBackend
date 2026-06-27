import { CustomerSessionModel, DeviceModel } from '../../database/models/index.js';
import { CreateCustomerSessionResponseDto, CustomerSessionResponseDto } from './sessions.dtos.js';

function toIsoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function toCustomerSessionResponse(session: CustomerSessionModel): CustomerSessionResponseDto {
  return {
    id: String(session.id),
    tenantId: String(session.tenantId),
    customerId: session.customerId === null ? null : String(session.customerId),
    deviceId: session.deviceId === null ? null : String(session.deviceId),
    channel: session.channel,
    authMethod: session.authMethod,
    startedAt: toIsoOrNull(session.startedAt),
    endedAt: toIsoOrNull(session.endedAt),
    sessionStatus: session.sessionStatus,
  };
}

export function toCreateSessionResponse(input: {
  session: CustomerSessionModel;
  device: DeviceModel;
}): CreateCustomerSessionResponseDto {
  return {
    session: toCustomerSessionResponse(input.session),
    device: {
      id: String(input.device.id),
      riskStatus: input.device.riskStatus,
      tenantReuseCount: input.device.tenantReuseCount,
    },
  };
}
