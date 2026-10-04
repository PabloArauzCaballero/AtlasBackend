/**
 * @file Caso de uso: la tarjeta del cliente (catálogo, resolución y ajuste manual del personal).
 * @business Dice qué tarjeta tiene cada persona —la que gana por su nivel o la que el personal le puso, con motivo— y deja constancia de cada cambio manual. No toca el límite de crédito.
 * @system lee `catalog.card_tiers` (con respaldo de fábrica), aplica la regla pura de `domain/card-tier.ts` y escribe `credit.customer_card_tier_overrides` y la auditoría operativa en una sola transacción.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CardTierModel, CustomerCardTierOverrideModel, OperationalAuditLogModel } from '../../../database/models/index.js';
import {
  effectiveCatalog,
  isOverrideActive,
  resolveCardTier,
  type CardTierCode,
  type CardTierDefinition,
  type ResolvedCardTier,
} from '../domain/card-tier.js';
import type { TierCode } from '../domain/relationship-progress.js';

export const CARD_TIER_OVERRIDE_SET = 'credit.card_tier.override_set';
export const CARD_TIER_OVERRIDE_REVOKED = 'credit.card_tier.override_revoked';

/** Quién hace el cambio, tal como lo escribe la auditoría operativa. */
export type CardTierActor = { actorType: 'internal_user' | 'platform_user'; internalUserId: string | null; platformUserId: string | null };

export function actorOf(user: AuthenticatedUser): CardTierActor {
  if (user.internalUserId) return { actorType: 'internal_user', internalUserId: user.internalUserId, platformUserId: null };
  return { actorType: 'platform_user', internalUserId: null, platformUserId: user.platformUserId ?? null };
}

export type CardTierView = ResolvedCardTier & {
  /** Desde cuándo y hasta cuándo vale el ajuste manual, si lo hay y está vigente. */
  manual: { since: Date; expiresAt: Date | null } | null;
};

const toDefinition = (row: CardTierModel): CardTierDefinition => ({
  code: row.tierCode as CardTierCode,
  label: row.label,
  levelCode: row.levelCode as TierCode,
  displayOrder: row.displayOrder,
  description: row.description,
  benefits: row.benefitsJson ?? [],
  theme: row.themeJson,
});

@Injectable()
export class CardTierService {
  constructor(
    @InjectModel(CardTierModel) private readonly tiers: typeof CardTierModel,
    @InjectModel(CustomerCardTierOverrideModel) private readonly overrides: typeof CustomerCardTierOverrideModel,
    @InjectModel(OperationalAuditLogModel) private readonly audit: typeof OperationalAuditLogModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /** El catálogo del tenant; si no trae las cinco tarjetas de nivel, el de fábrica. Sólo lo activo. */
  async catalog(tenantId: string, options: { transaction?: Transaction } = {}): Promise<readonly CardTierDefinition[]> {
    const rows = await this.tiers.findAll({
      where: { tenantId, deleted: false, isActive: true },
      order: [['displayOrder', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
    return effectiveCatalog(rows.map(toDefinition));
  }

  private openOverride(tenantId: string, customerId: string, transaction?: Transaction) {
    return this.overrides.findAll({
      where: { tenantId, customerId, revokedAt: null, deleted: false },
      order: [['validFrom', 'DESC']],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    } as FindOptions);
  }

  /** La tarjeta de una persona dado su nivel: la automática, o el ajuste manual si está vigente. */
  async resolveFor(tenantId: string, customerId: string, levelCode: TierCode, now: Date = new Date()): Promise<CardTierView> {
    const [catalog, abiertos] = await Promise.all([this.catalog(tenantId), this.openOverride(tenantId, customerId)]);
    const vigente = abiertos.find((ajuste) => isOverrideActive({ expiresAt: ajuste.expiresAt, revokedAt: ajuste.revokedAt }, now)) ?? null;
    const resolved = resolveCardTier({
      levelCode,
      catalog,
      override: vigente ? { tierCode: vigente.tierCode as CardTierCode, expiresAt: vigente.expiresAt, revokedAt: vigente.revokedAt } : null,
      now,
    });
    return {
      ...resolved,
      manual: resolved.source === 'MANUAL' && vigente ? { since: vigente.validFrom, expiresAt: vigente.expiresAt } : null,
    };
  }

  /** Todos los ajustes manuales de una persona, el más reciente primero: quién, por qué, cuándo y si se revocó. */
  history(tenantId: string, customerId: string): Promise<CustomerCardTierOverrideModel[]> {
    return this.overrides.findAll({
      where: { tenantId, customerId, deleted: false },
      order: [['validFrom', 'DESC']],
    } as FindOptions);
  }

  /**
   * Pone una tarjeta a mano. Si ya había un ajuste abierto —vigente o vencido sin revocar— se revoca primero, en la
   * MISMA transacción, para que nunca haya dos mandando (el índice único parcial lo garantiza además en la base).
   */
  async setOverride(input: {
    tenantId: string;
    customerId: string;
    tierCode: CardTierCode;
    reason: string;
    expiresAt: Date | null;
    actor: CardTierActor;
    now?: Date;
  }): Promise<CustomerCardTierOverrideModel> {
    const now = input.now ?? new Date();
    if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException({ code: 'CARD_TIER_EXPIRY_IN_PAST', message: 'El vencimiento debe ser una fecha futura.' });
    }
    return this.sequelize.transaction(async (transaction) => {
      const catalog = await this.catalog(input.tenantId, { transaction });
      if (!catalog.some((tarjeta) => tarjeta.code === input.tierCode)) {
        throw new BadRequestException({
          code: 'CARD_TIER_NOT_FOUND',
          message: 'Esa tarjeta no existe en el catálogo.',
          tierCode: input.tierCode,
        });
      }
      for (const previo of await this.openOverride(input.tenantId, input.customerId, transaction)) {
        const vencido = !isOverrideActive({ expiresAt: previo.expiresAt, revokedAt: null }, now);
        await previo.update(
          {
            revokedAt: now,
            revokedByInternalUserId: input.actor.internalUserId,
            revokeReason: vencido
              ? `Venció el ${previo.expiresAt?.toISOString().slice(0, 10) ?? 'plazo'}; se reemplaza por uno nuevo.`
              : `Reemplazado por un ajuste nuevo a ${input.tierCode}.`,
          },
          { transaction },
        );
      }
      const creado = await this.overrides.create(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          tierCode: input.tierCode,
          reason: input.reason.trim(),
          setByInternalUserId: input.actor.internalUserId,
          validFrom: now,
          expiresAt: input.expiresAt,
          createdAtValue: now,
          deleted: false,
        },
        { transaction },
      );
      await this.record({
        actionCode: CARD_TIER_OVERRIDE_SET,
        ajuste: creado,
        actor: input.actor,
        occurredAt: now,
        payload: { tierCode: input.tierCode, reason: input.reason.trim(), expiresAt: input.expiresAt?.toISOString() ?? null },
        transaction,
      });
      return creado;
    });
  }

  /** Quita el ajuste manual vigente: la persona vuelve a la tarjeta que le corresponde por su nivel. */
  async revokeOverride(input: { tenantId: string; customerId: string; reason: string; actor: CardTierActor; now?: Date }): Promise<void> {
    const now = input.now ?? new Date();
    await this.sequelize.transaction(async (transaction) => {
      const abiertos = await this.openOverride(input.tenantId, input.customerId, transaction);
      if (abiertos.length === 0) {
        throw new NotFoundException({
          code: 'CARD_TIER_OVERRIDE_NOT_FOUND',
          message: 'Este cliente no tiene un ajuste manual de tarjeta que revocar.',
        });
      }
      for (const ajuste of abiertos) {
        await ajuste.update(
          { revokedAt: now, revokedByInternalUserId: input.actor.internalUserId, revokeReason: input.reason.trim() },
          { transaction },
        );
        await this.record({
          actionCode: CARD_TIER_OVERRIDE_REVOKED,
          ajuste,
          actor: input.actor,
          occurredAt: now,
          payload: { tierCode: ajuste.tierCode, reason: input.reason.trim() },
          transaction,
        });
      }
    });
  }

  private record(entrada: {
    actionCode: string;
    ajuste: CustomerCardTierOverrideModel;
    actor: CardTierActor;
    occurredAt: Date;
    payload: Record<string, unknown>;
    transaction: Transaction;
  }) {
    const { actionCode, ajuste, actor, occurredAt, payload, transaction } = entrada;
    return this.audit.create(
      {
        tenantId: ajuste.tenantId,
        actorType: actor.actorType,
        actorInternalUserId: actor.internalUserId,
        actorPlatformUserId: actor.platformUserId,
        actionCode,
        targetType: 'customer',
        targetId: ajuste.customerId,
        ipAddress: null,
        userAgent: null,
        payloadJson: { overrideId: ajuste.id, ...payload },
        occurredAt,
        createdAtValue: occurredAt,
      },
      { transaction },
    );
  }
}
