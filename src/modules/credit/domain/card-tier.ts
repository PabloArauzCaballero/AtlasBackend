/**
 * @file Dominio: las tarjetas del cliente (Normal, Silver, Gold, Premium, Black) y cuál tiene cada persona.
 * @business Da a cada cliente una tarjeta que se gana por su comportamiento y que el personal puede ajustar a mano con motivo, sin que eso mueva su límite de crédito.
 * @system función pura; no lee base de datos. La tarjeta es PRESENTACIÓN y estatus: el límite lo sigue decidiendo la política del motor.
 *
 * ## Dos fuentes, una regla
 *
 * 1. AUTOMÁTICA: la tarjeta que corresponde al nivel de relación del cliente (`NUEVO`→Normal … `PREFERENTE`→Black). Se
 *    calcula al leer; no se guarda, así que nunca queda desfasada del puntaje.
 * 2. MANUAL: un ajuste del personal, con motivo, que PREVALECE mientras esté vigente (no revocado ni vencido).
 *
 * ## Por qué un ajuste manual no toca el límite
 *
 * La tarjeta cambia aspecto y estatus, no riesgo. Si subirla a mano subiera el límite, cualquier ajuste saltaría la
 * política de crédito. Por eso `resolveCardTier` no recibe ni devuelve nada del límite.
 */
import type { TierCode } from './relationship-progress.js';

export type CardTierCode = 'NORMAL' | 'SILVER' | 'GOLD' | 'PREMIUM' | 'BLACK';

export type CardTheme = {
  /** Dos o tres colores del degradado de la tarjeta, de arriba-izquierda a abajo-derecha. */
  gradient: readonly string[];
  /** Color del texto y los grabados sobre la tarjeta. */
  ink: string;
  /** Color del filo y del destello. */
  accent: string;
  /** Cómo se llama el acabado, para describirlo a un lector de pantalla. */
  finish: string;
};

export type CardTierDefinition = {
  code: CardTierCode;
  label: string;
  /** El nivel de relación al que corresponde en automático. */
  levelCode: TierCode;
  displayOrder: number;
  description: string;
  /**
   * Ventajas de esta tarjeta. VACÍAS a propósito: no se prometen beneficios comerciales que el negocio no definió.
   * Cuando existan se cargan en el catálogo (`benefits_json`), no en el código.
   */
  benefits: ReadonlyArray<{ text: string; icon?: string }>;
  theme: CardTheme;
};

/**
 * El catálogo de fábrica. La base de datos tiene el suyo por tenant (editable); éste es el respaldo cuando un tenant no
 * lo tiene sembrado, para que ninguna persona se quede sin tarjeta por un tenant nuevo.
 */
export const DEFAULT_CARD_TIERS: readonly CardTierDefinition[] = [
  {
    code: 'NORMAL',
    label: 'Normal',
    levelCode: 'NUEVO',
    displayOrder: 1,
    description: 'La tarjeta con la que empiezas. Se mejora pagando a tiempo.',
    benefits: [],
    theme: { gradient: ['#16314F', '#0C2C50', '#0A2038'], ink: '#E8F4FF', accent: '#5CF0CC', finish: 'azul marino' },
  },
  {
    code: 'SILVER',
    label: 'Silver',
    levelCode: 'EN_CONSTRUCCION',
    displayOrder: 2,
    description: 'Ya hay historia contigo: tus primeros pagos cuentan.',
    benefits: [],
    theme: { gradient: ['#E4E9EF', '#AEB8C4', '#7B8794'], ink: '#10202F', accent: '#FFFFFF', finish: 'plata' },
  },
  {
    code: 'GOLD',
    label: 'Gold',
    levelCode: 'ESTABLECIDO',
    displayOrder: 3,
    description: 'Una relación establecida: pagas, cumples y se nota.',
    benefits: [],
    theme: { gradient: ['#F7E08A', '#D9A93A', '#9C6F14'], ink: '#2A1B02', accent: '#FFF4C2', finish: 'oro' },
  },
  {
    code: 'PREMIUM',
    label: 'Premium',
    levelCode: 'CONSOLIDADO',
    displayOrder: 4,
    description: 'Una relación consolidada: tu historial habla por ti.',
    benefits: [],
    theme: { gradient: ['#2BE0A8', '#14A894', '#0E7377'], ink: '#052033', accent: '#CFFFF0', finish: 'verde esmeralda' },
  },
  {
    code: 'BLACK',
    label: 'Black',
    levelCode: 'PREFERENTE',
    displayOrder: 5,
    description: 'El escalón más alto: la confianza más ganada.',
    benefits: [],
    theme: { gradient: ['#2B2F38', '#14161B', '#050608'], ink: '#F2D98A', accent: '#D9A93A', finish: 'negro con grabado dorado' },
  },
];

export type CardTierOverride = {
  tierCode: CardTierCode;
  /** `null` = sin vencimiento. */
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type ResolvedCardTier = {
  tier: CardTierDefinition;
  source: 'AUTOMATICA' | 'MANUAL';
  /** La tarjeta que le correspondería por su nivel, siempre; sirve para decirle «tu nivel es X» cuando difiere. */
  automaticTier: CardTierDefinition;
};

/** ¿Está vigente un ajuste? No revocado y, si vence, todavía no. */
export function isOverrideActive(override: Pick<CardTierOverride, 'expiresAt' | 'revokedAt'>, now: Date): boolean {
  if (override.revokedAt !== null) return false;
  return override.expiresAt === null || override.expiresAt.getTime() > now.getTime();
}

/**
 * La tarjeta de una persona. `catalog` es el del tenant (o el de fábrica) y debe traer al menos una tarjeta por nivel;
 * si falta la que pide un ajuste manual (se retiró del catálogo), se IGNORA el ajuste y se cae a la automática en vez
 * de dejar a alguien sin tarjeta o con una que ya no existe.
 */
export function resolveCardTier(input: {
  levelCode: TierCode;
  catalog: readonly CardTierDefinition[];
  override: CardTierOverride | null;
  now: Date;
}): ResolvedCardTier {
  const ordenado = [...input.catalog].sort((a, b) => a.displayOrder - b.displayOrder);
  const automatica = ordenado.find((tarjeta) => tarjeta.levelCode === input.levelCode) ?? ordenado[0];
  if (!automatica) throw new Error('El catálogo de tarjetas está vacío: no hay tarjeta que asignar.');

  if (input.override && isOverrideActive(input.override, input.now)) {
    const manual = ordenado.find((tarjeta) => tarjeta.code === input.override!.tierCode);
    if (manual) return { tier: manual, source: 'MANUAL', automaticTier: automatica };
  }
  return { tier: automatica, source: 'AUTOMATICA', automaticTier: automatica };
}

/** El catálogo del tenant si trae las cinco tarjetas de nivel; si está incompleto, el de fábrica. */
export function effectiveCatalog(tenantCatalog: readonly CardTierDefinition[]): readonly CardTierDefinition[] {
  const niveles = new Set(tenantCatalog.map((tarjeta) => tarjeta.levelCode));
  const completo = DEFAULT_CARD_TIERS.every((fabrica) => niveles.has(fabrica.levelCode));
  return completo ? tenantCatalog : DEFAULT_CARD_TIERS;
}
