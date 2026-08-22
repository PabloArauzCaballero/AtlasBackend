/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza convierte lo que el expediente ya guarda en los rasgos con los que se segmenta a un comercio.
 * @system proyecta los datos verificados del partner a los atributos de segmentación.
 */
import type { PartnerBranchModel, PartnerProfileModel } from '../../../database/models/index.js';

/**
 * Los rasgos con los que se segmenta a un comercio, derivados de su EXPEDIENTE.
 *
 * ## Por qué desde el expediente y no desde lo que alguien declare
 *
 * El comercio ya declaró todo esto al abrir su expediente —rubro, dónde opera, con qué cobra— y
 * parte quedó VERIFICADO. Volver a preguntárselo en cada petición no sólo repite trabajo: permite
 * que la respuesta cambie según quién pregunte, y entonces el segmento deja de describir al
 * comercio y pasa a describir lo que el comercio dice de sí mismo en ese momento.
 *
 * ## La diferencia con la proyección de la cuenta comercial
 *
 * La cuenta B2B del ERP proyecta lo COMERCIAL —rubro, tamaño, antigüedad—. Esto proyecta lo
 * VERIFICADO: si el expediente está aprobado, si tiene cobro por QR activo, en cuántas ciudades
 * opera. Son dos capas del mismo comercio y se derivan por separado a propósito: un segmento de
 * «comercios con cobro operativo» no puede salir de la ficha comercial, porque la ficha no sabe
 * si el QR se aprobó.
 */
export interface PartnerAudienceTraits {
  /** Rubro declarado en el expediente. */
  readonly merchantCategory?: string;
  /** Ciudad de la primera sucursal; la referencia cuando el comercio opera en varias. */
  readonly city?: string;
  /** Cuántas ciudades distintas: distingue al comercio de barrio del que tiene red. */
  readonly cityCount: number;
  readonly branchCount: number;
  readonly posTerminalCount: number;
  /**
   * Si el expediente está aprobado. Es el rasgo que ninguna otra capa puede dar, y el que hace
   * honesto un segmento de «comercios verificados».
   */
  readonly verified: boolean;
  /** Si tiene cobro por QR vigente —del negocio y bancario—, que es lo que le permite cobrar. */
  readonly qrPaymentsReady: boolean;
  /** Banda por número de locales. Se segmenta por banda por lo mismo que el tamaño: el número
   * exacto no significa nada para nadie y afina de más sobre un universo pequeño. */
  readonly networkBand: 'UNICO' | 'PEQUENA_RED' | 'RED';
}

/** Bandas de red por número de locales. */
export function networkBand(branchCount: number): PartnerAudienceTraits['networkBand'] {
  if (branchCount <= 1) return 'UNICO';
  if (branchCount <= 5) return 'PEQUENA_RED';
  return 'RED';
}

/**
 * Proyecta el expediente a sus rasgos de segmentación.
 *
 * No inventa nada: lo que el expediente no guarda queda ausente, y un segmento que lo exija
 * simplemente no se dará por cumplido — que es lo correcto. Rellenar con un valor por defecto
 * metería al comercio en segmentos que nadie comprobó.
 */
export function projectPartnerAudience(input: {
  profile: PartnerProfileModel;
  branches: readonly PartnerBranchModel[];
  /** Sólo los QR VIGENTES: uno reemplazado no permite cobrar. */
  liveQrKinds: readonly string[];
  posTerminalCount: number;
}): PartnerAudienceTraits {
  const cities = new Set(input.branches.map((branch) => branch.city).filter((city): city is string => Boolean(city)));

  return {
    ...(input.profile.businessCategory ? { merchantCategory: input.profile.businessCategory } : {}),
    ...(input.branches[0]?.city ? { city: input.branches[0].city } : {}),
    cityCount: cities.size,
    branchCount: input.branches.length,
    posTerminalCount: input.posTerminalCount,
    verified: input.profile.onboardingStatus === 'approved',
    /*
     * Hacen falta LOS DOS: el del negocio identifica al comercio y el bancario dice a qué cuenta
     * va el dinero. Con uno solo no se cobra, así que dar por «listo para cobrar» a quien tiene
     * medio circuito metería en la campaña a comercios que no pueden completar una venta.
     */
    qrPaymentsReady: input.liveQrKinds.includes('business') && input.liveQrKinds.includes('bank'),
    networkBand: networkBand(input.branches.length),
  };
}
