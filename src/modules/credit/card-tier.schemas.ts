/**
 * @file Contratos Zod: valida entrada y define el tipo del caso de uso.
 * @business Exige que todo ajuste manual de una tarjeta lleve un motivo con cuerpo y, si vence, una fecha futura.
 * @system esquemas de las rutas de operaciones de la tarjeta del cliente.
 */
import { z } from 'zod';

export const CARD_TIER_CODES = ['NORMAL', 'SILVER', 'GOLD', 'PREMIUM', 'BLACK'] as const;

/** Un motivo corto («ok», «vip») no se puede auditar: 10 caracteres es el mínimo que también exige la base. */
const motivo = z.string().trim().min(10, 'El motivo debe explicar el cambio (mínimo 10 caracteres).').max(500);

export const setCardTierOverrideSchema = z
  .object({
    tierCode: z.enum(CARD_TIER_CODES),
    reason: motivo,
    /** ISO 8601. Sin él, el ajuste no vence: dura hasta que alguien lo revoque. */
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type SetCardTierOverrideDto = z.infer<typeof setCardTierOverrideSchema>;

export const revokeCardTierOverrideSchema = z.object({ reason: motivo }).strict();
export type RevokeCardTierOverrideDto = z.infer<typeof revokeCardTierOverrideSchema>;
