export type OutboxEventStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'cancelled';

export type EventRegistryItem = {
  code: string;
  family: string;
  version: number;
  description: string;
  defaultPriority: number;
  allowedAggregateTypes: string[];
};

export type PublishEventInput = {
  tenantId: string | null;
  eventCode: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  priority?: number;
  availableAt?: Date;
  maxAttempts?: number;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  sourceModule?: string | null;
  sourceAction?: string | null;
};

export type ProcessEventsInput = {
  tenantId?: string | null;
  limit: number;
  dryRun: boolean;
  workerId?: string;
};

export type ProcessEventsResult = {
  selected: number;
  processed: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  eventIds: string[];
};
