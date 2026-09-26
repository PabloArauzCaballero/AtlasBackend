/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business El precio que se le muestra a alguien y el que se le cobra tienen que salir del mismo sitio.
 * @system traduce la tasa y el tramo que el Motor tarificó a las columnas del expediente (Frente 3A).
 */
import { DecisionResponse } from '../../decision-engine/decision-engine.types.js';
import { unitRateToPercent } from '../../decision-engine/rate-units.js';

/**
 * `null`/`undefined` NUNCA es una tasa de 0 %: `Number(null) === 0` en JavaScript, así que sin este
 * corte explícito un Motor que publica `annual_percentage_rate: null` —por ejemplo, un rechazo sin
 * precio— se leería como una tarificación real al 0 %, exactamente el defecto que este Frente vino
 * a cerrar (T-1) sólo movido de sitio: de "sin tasa cobra gratis" a "sin tasa el Motor la inventa".
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export type PricedRateAndTier = { pricedRate: string | null; pricingTier: string | null };

/**
 * Lo que el Motor tarificó para ESTA ejecución, leído de `output` (Frente 3A, punto 4 del plan
 * `_plan-motor-decisiones-tasa-2026-09-25`).
 *
 * `annual_percentage_rate` llega en TANTO POR UNO (mismo contrato que `usury_cap_rate` en
 * `underwriting-features.service.ts`) y se convierte a PORCENTAJE aquí — el único punto de
 * conversión de vuelta, igual que `product_base_annual_rate` es el único punto de ida
 * (`credit-decision-engine.service.ts`). `null` cuando el Motor no lo publicó (un motor caído, un
 * artefacto anterior a v2, o un rechazo sin precio): no se inventa una tasa que nadie decidió.
 *
 * Se lee de `output` y no del nivel superior de la respuesta porque es donde el resto del código ya
 * lee este mismo vocabulario del Motor (`credit-line-recalculation.service.ts`, para la línea de
 * crédito): es la única convención establecida en el repo para estos dos campos, y no hay swagger
 * ni ejemplo fijado del artefacto v2 en la fecha en la que esto se escribió — si el Motor los publica
 * en otra forma, se reconcilia aquí, en un solo sitio.
 */
export function pricedRateAndTier(response: DecisionResponse | null): PricedRateAndTier {
  const output = (response?.output ?? {}) as Record<string, unknown>;
  return {
    pricedRate: pricedRateUnitToPercentNumber(output.annual_percentage_rate)?.toFixed(4) ?? null,
    pricingTier: str(output.pricing_tier),
  };
}

/**
 * La MISMA conversión de `pricedRateAndTier`, como número sin formatear — para quien escriba su
 * propia precisión decimal en vez de la de `credit_applications` (`credit-line-recalculation.service.ts`,
 * hacia `credit_lines.annual_percentage_rate`, DECIMAL(6,2) en vez de DECIMAL(7,4)).
 *
 * Que las dos lean `annual_percentage_rate` por este ÚNICO camino es lo que hace posible la prueba
 * "lo que se muestra = lo que se cobra" (T-2): la línea de crédito (lo que ve el cliente ANTES de
 * pedir) y la solicitud (lo que decide el préstamo que se le desembolsa) parten del mismo campo del
 * Motor, con la misma conversión de unidades — nunca dos números que casualmente coinciden.
 */
export function pricedRateUnitToPercentNumber(rateUnit: unknown): number | null {
  const parsed = num(rateUnit);
  return parsed === null ? null : unitRateToPercent(parsed);
}
