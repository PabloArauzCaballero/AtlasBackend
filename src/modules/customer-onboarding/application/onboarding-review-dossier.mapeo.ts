/**
 * @file Funciones puras del expediente del alta: enmascarar, comparar lo declarado con lo leído y resumir señales.
 * @business Que el analista vea en segundos si el carnet dice lo mismo que la persona declaró y qué hizo el teléfono, sin ver datos que no necesita.
 * @system sin base ni Nest: cada regla se prueba con un test directo (`onboarding-review-dossier.mapeo.spec.ts`).
 */
import type { LatLng, OnboardingReviewDossier } from './onboarding-review-dossier.types.js';

/** Umbral de la política del alta: por debajo de esta edad, mayor riesgo. */
export const EDAD_DE_MAYOR_RIESGO = 23;

export function numeroONulo(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export function isoONulo(fecha: Date | string | null | undefined): string | null {
  if (!fecha) return null;
  const valor = fecha instanceof Date ? fecha : new Date(fecha);
  return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
}

/** `•••• 1234`. Sin los cuatro últimos no hay nada que enseñar. */
export function enmascararTelefono(ultimos4: string | null | undefined): string | null {
  return ultimos4 ? `•••• ${ultimos4}` : null;
}

/** `•••@dominio.com`. El dominio basta para ver un correo desechable. */
export function enmascararCorreo(dominio: string | null | undefined): string | null {
  return dominio ? `•••@${dominio}` : null;
}

export function ultimos4(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').replace(/[^0-9A-Za-z]/g, '');
  return limpio.length >= 4 ? limpio.slice(-4) : null;
}

/** Mayúsculas, sin tildes y con un solo espacio: «José  Pérez» y «JOSE PEREZ» son el mismo nombre. */
export function normalizarTexto(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Si el nombre declarado es el del carnet. `null` si falta cualquiera de los dos lados: «no se pudo
 * comparar» no es «no coincide».
 */
export function coincideNombre(
  declarado: { nombres: string | null; apellidos: string | null },
  leido: { nombres: string | null; apellidos: string | null } | null,
): boolean | null {
  if (!leido) return null;
  const a = normalizarTexto(`${declarado.nombres ?? ''} ${declarado.apellidos ?? ''}`);
  const b = normalizarTexto(`${leido.nombres ?? ''} ${leido.apellidos ?? ''}`);
  if (!a || !b) return null;
  return a === b;
}

/** `YYYY-MM-DD` desde ISO o desde `DD/MM/YYYY` (y con `-` o `.`), que es como viene impreso el carnet. */
export function fechaIso(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const texto = valor.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texto);
  if (local) return `${local[3]}-${local[2]!.padStart(2, '0')}-${local[1]!.padStart(2, '0')}`;
  return null;
}

export function coincideNacimiento(declarada: string | null, leida: string | null): boolean | null {
  const a = fechaIso(declarada);
  const b = fechaIso(leida);
  if (!a || !b) return null;
  return a === b;
}

export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((x, y) => x - y);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 0 ? (orden[medio - 1]! + orden[medio]!) / 2 : orden[medio]!;
}

export type PingLeido = {
  captureMode: string;
  isMocked: boolean;
  capturedAt: Date;
  gpsLat: string;
  gpsLng: string;
  distanceToDeclaredMeters: string | null;
};

/** Pings ordenados del más viejo al más nuevo. */
export function resumenDePings(pings: readonly PingLeido[]): OnboardingReviewDossier['ubicacion']['pings'] {
  const distancias = pings.map((ping) => numeroONulo(ping.distanceToDeclaredMeters)).filter((d): d is number => d !== null);
  const ultimo = pings.at(-1);
  const lat = numeroONulo(ultimo?.gpsLat);
  const lng = numeroONulo(ultimo?.gpsLng);
  const ultimaPosicion: LatLng | null = lat !== null && lng !== null ? { lat, lng } : null;
  const med = mediana(distancias);
  return {
    total: pings.length,
    primerPlano: pings.filter((ping) => ping.captureMode !== 'background').length,
    segundoPlano: pings.filter((ping) => ping.captureMode === 'background').length,
    simulados: pings.filter((ping) => ping.isMocked).length,
    primero: isoONulo(pings[0]?.capturedAt),
    ultimo: isoONulo(ultimo?.capturedAt),
    ultimaPosicion,
    distanciaMedianaAlDomicilioM: med === null ? null : Math.round(med),
    distanciaMaximaAlDomicilioM: distancias.length === 0 ? null : Math.round(Math.max(...distancias)),
  };
}

export type PermisoLeido = { permissionCode: string | null; granted: boolean | null; respondedAt: Date | null; requestedAt: Date | null };

/** La ÚLTIMA decisión de cada permiso. Entra del más nuevo al más viejo. */
export function ultimosPermisos(eventos: readonly PermisoLeido[]): OnboardingReviewDossier['permisos'] {
  const vistos = new Set<string>();
  const salida: OnboardingReviewDossier['permisos'] = [];
  for (const evento of eventos) {
    if (!evento.permissionCode || vistos.has(evento.permissionCode)) continue;
    vistos.add(evento.permissionCode);
    salida.push({
      permiso: evento.permissionCode,
      decision: evento.granted === true ? 'concedido' : evento.granted === false ? 'denegado' : 'sin_respuesta',
      fecha: isoONulo(evento.respondedAt ?? evento.requestedAt),
    });
  }
  return salida;
}

/**
 * Si la persona dejó el rastreo de ubicación «siempre» (en segundo plano). Sale del permiso que la app
 * registra con `background`/`always` en el código. `null` si nunca se le preguntó.
 */
export function rastreoSiempre(permisos: OnboardingReviewDossier['permisos']): boolean | null {
  const permiso = permisos.find((p) => /background|always|segundo_plano/i.test(p.permiso) && /locat|ubicac/i.test(p.permiso));
  if (!permiso || permiso.decision === 'sin_respuesta') return null;
  return permiso.decision === 'concedido';
}

export type ConsentimientoLeido = {
  purposeCode: string | null;
  granted: boolean | null;
  grantedAt: Date | null;
  revokedAt: Date | null;
  createdAtValue: Date;
};

/** La decisión VIGENTE por finalidad. Entra del más nuevo al más viejo. */
export function ultimosConsentimientos(filas: readonly ConsentimientoLeido[]): OnboardingReviewDossier['consentimientos'] {
  const vistos = new Set<string>();
  const salida: OnboardingReviewDossier['consentimientos'] = [];
  for (const fila of filas) {
    if (!fila.purposeCode || vistos.has(fila.purposeCode)) continue;
    vistos.add(fila.purposeCode);
    const decision = fila.revokedAt ? 'revocado' : fila.granted ? 'concedido' : 'denegado';
    salida.push({ finalidad: fila.purposeCode, decision, fecha: isoONulo(fila.revokedAt ?? fila.grantedAt ?? fila.createdAtValue) });
  }
  return salida;
}

/** Los tiempos por pantalla del resumen de comportamiento, en segundos y de la más larga a la más corta. */
export function segundosPorPantalla(
  pantallas: Record<string, { totalMs: number }> | null | undefined,
): { pantalla: string; segundos: number }[] {
  return Object.entries(pantallas ?? {})
    .map(([pantalla, tiempo]) => ({ pantalla, segundos: Math.round((Number(tiempo?.totalMs) || 0) / 1000) }))
    .sort((a, b) => b.segundos - a.segundos);
}

/** Años en el trabajo desde los meses declarados, con un decimal. */
export function aniosDesdeMeses(meses: number | null): number | null {
  return meses === null ? null : Math.round((meses / 12) * 10) / 10;
}
