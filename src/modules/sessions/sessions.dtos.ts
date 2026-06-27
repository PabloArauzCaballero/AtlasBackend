import { PaginationMeta } from '../../common/utils/pagination/pagination.util.js';

export type CustomerSessionResponseDto = {
  id: string;
  tenantId: string;
  customerId: string | null;
  deviceId: string | null;
  channel: string | null;
  authMethod: string | null;
  startedAt: string | null;
  endedAt: string | null;
  sessionStatus: string | null;
};

export type CreateCustomerSessionResponseDto = {
  session: CustomerSessionResponseDto;
  device: {
    id: string;
    riskStatus: string | null;
    tenantReuseCount: number | null;
  };
};

export type PaginatedCustomerSessionsResponseDto = {
  items: CustomerSessionResponseDto[];
  meta: PaginationMeta;
};
