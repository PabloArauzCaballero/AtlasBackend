/**
 * @file Mapeo: traduce el dominio de la tarjeta a las respuestas HTTP.
 * @business Decide qué de la tarjeta ve el cliente y qué ve el personal: el cliente NO ve el motivo ni quién hizo el ajuste.
 * @system funciones puras de presentación.
 */
import type { CustomerCardTierOverrideModel } from '../../database/models/index.js';
import { glowOf, type CardTierDefinition } from './domain/card-tier.js';
import type { CardTierView } from './application/card-tier.service.js';

const definition = (tarjeta: CardTierDefinition, vigente: boolean, catalog: readonly CardTierDefinition[]) => ({
  code: tarjeta.code,
  label: tarjeta.label,
  levelCode: tarjeta.levelCode,
  displayOrder: tarjeta.displayOrder,
  description: tarjeta.description,
  benefits: tarjeta.benefits,
  // El fulgor sale siempre: el escrito en el catálogo o, si no lo hay, el que le toca por su orden.
  theme: { ...tarjeta.theme, glow: glowOf(tarjeta, catalog) },
  current: vigente,
});

/** Lo que ve el CLIENTE: su tarjeta, si es ganada o puesta por Atlas, y el escalón completo. Nunca el motivo del ajuste. */
export function toCustomerCardResponse(view: CardTierView, catalog: readonly CardTierDefinition[]) {
  return {
    ...definition(view.tier, true, catalog),
    source: view.source,
    /** La que le correspondería por su nivel; si difiere de `code`, la app dice «tu nivel es X». */
    automatic: { code: view.automaticTier.code, label: view.automaticTier.label },
    manual: view.manual ? { since: view.manual.since, expiresAt: view.manual.expiresAt } : null,
    catalog: [...catalog]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((tarjeta) => definition(tarjeta, tarjeta.code === view.tier.code, catalog)),
  };
}

/** Lo que ve el PERSONAL: lo del cliente más el historial completo con motivos, autores y revocaciones. */
export function toOperationsCardResponse(
  view: CardTierView,
  catalog: readonly CardTierDefinition[],
  history: readonly CustomerCardTierOverrideModel[],
) {
  return {
    ...toCustomerCardResponse(view, catalog),
    history: history.map((ajuste) => ({
      overrideId: String(ajuste.id),
      tierCode: ajuste.tierCode,
      reason: ajuste.reason,
      setByInternalUserId: ajuste.setByInternalUserId,
      validFrom: ajuste.validFrom,
      expiresAt: ajuste.expiresAt,
      revokedAt: ajuste.revokedAt,
      revokedByInternalUserId: ajuste.revokedByInternalUserId,
      revokeReason: ajuste.revokeReason,
    })),
  };
}
