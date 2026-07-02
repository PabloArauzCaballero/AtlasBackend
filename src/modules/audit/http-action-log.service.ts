import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { OperationalAuditLogModel } from '../../database/models/index.js';
import { redactSensitiveObject } from '../../common/utils/privacy/redaction.util.js';

export type HttpActionLogInput = {
  tenantId: string | null;
  actorType: string | null;
  actorInternalUserId: string | null;
  actorPlatformUserId: string | null;
  actionCode: string;
  targetType: string;
  targetId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

@Injectable()
export class HttpActionLogService {
  constructor(
    @InjectModel(OperationalAuditLogModel)
    private readonly auditModel: typeof OperationalAuditLogModel,
  ) {}

  async createHttpAction(input: HttpActionLogInput): Promise<void> {
    await this.auditModel.create({
      tenantId: input.tenantId,
      actorType: input.actorType,
      actorInternalUserId: input.actorInternalUserId,
      actorPlatformUserId: input.actorPlatformUserId,
      actionCode: input.actionCode,
      targetType: input.targetType,
      targetId: input.targetId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      payloadJson: redactSensitiveObject(input.payload) as Record<string, unknown>,
      occurredAt: input.occurredAt,
      createdAtValue: input.occurredAt,
    } as never);
  }
}
