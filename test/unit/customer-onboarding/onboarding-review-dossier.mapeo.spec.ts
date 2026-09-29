/**
 * @file Las reglas puras del expediente del alta: enmascarar, comparar lo declarado con el carnet y resumir señales.
 * @business Un «no coincide» falso manda a rechazar a alguien legítimo; un dato en claro de más es una fuga.
 * @system Ejercita `onboarding-review-dossier.mapeo.ts` sin base ni Nest.
 */
import { describe, expect, it } from '@jest/globals';
import {
  aniosDesdeMeses,
  coincideNacimiento,
  coincideNombre,
  enmascararCorreo,
  enmascararTelefono,
  fechaIso,
  isoONulo,
  mediana,
  normalizarTexto,
  numeroONulo,
  rastreoSiempre,
  resumenDePings,
  segundosPorPantalla,
  ultimos4,
  ultimosConsentimientos,
  ultimosPermisos,
} from '../../../src/modules/customer-onboarding/application/onboarding-review-dossier.mapeo.js';

describe('enmascarar', () => {
  it('teléfono y correo nunca en claro; sin dato, null', () => {
    expect(enmascararTelefono('4321')).toBe('•••• 4321');
    expect(enmascararTelefono(null)).toBeNull();
    expect(enmascararCorreo('gmail.com')).toBe('•••@gmail.com');
    expect(enmascararCorreo(undefined)).toBeNull();
  });

  it('del carnet sólo los últimos cuatro, y sólo si hay cuatro', () => {
    expect(ultimos4('1234567-1B')).toBe('671B');
    expect(ultimos4('12')).toBeNull();
    expect(ultimos4(null)).toBeNull();
  });
});

describe('números y fechas', () => {
  it('numeroONulo no convierte basura en cero', () => {
    expect(numeroONulo('12.50')).toBe(12.5);
    expect(numeroONulo(0)).toBe(0);
    expect(numeroONulo('')).toBeNull();
    expect(numeroONulo('abc')).toBeNull();
    expect(numeroONulo(null)).toBeNull();
  });

  it('isoONulo acepta Date y texto; una fecha inválida es null', () => {
    expect(isoONulo(new Date('2026-09-28T10:00:00Z'))).toBe('2026-09-28T10:00:00.000Z');
    expect(isoONulo('2026-09-28T10:00:00Z')).toBe('2026-09-28T10:00:00.000Z');
    expect(isoONulo('mañana')).toBeNull();
    expect(isoONulo(null)).toBeNull();
  });

  it('fechaIso lee ISO y el formato impreso del carnet', () => {
    expect(fechaIso('1999-05-01')).toBe('1999-05-01');
    expect(fechaIso('1999-05-01T00:00:00Z')).toBe('1999-05-01');
    expect(fechaIso('1/5/1999')).toBe('1999-05-01');
    expect(fechaIso('01.05.1999')).toBe('1999-05-01');
    expect(fechaIso('mayo 1999')).toBeNull();
    expect(fechaIso(null)).toBeNull();
  });

  it('mediana par e impar; vacía es null', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });

  it('años desde meses, con un decimal', () => {
    expect(aniosDesdeMeses(18)).toBe(1.5);
    expect(aniosDesdeMeses(null)).toBeNull();
  });
});

describe('carnet frente a lo declarado', () => {
  it('normaliza tildes, mayúsculas y espacios', () => {
    expect(normalizarTexto('  José   Pérez-Añez ')).toBe('JOSE PEREZ ANEZ');
  });

  it('coincide el nombre aunque cambien tildes y mayúsculas', () => {
    expect(coincideNombre({ nombres: 'José Luis', apellidos: 'Pérez' }, { nombres: 'JOSE LUIS', apellidos: 'PEREZ' })).toBe(true);
    expect(coincideNombre({ nombres: 'Ana', apellidos: 'Paz' }, { nombres: 'ANA', apellidos: 'ROJAS' })).toBe(false);
  });

  it('sin uno de los dos lados, «no se pudo comparar» (null), no «no coincide»', () => {
    expect(coincideNombre({ nombres: 'Ana', apellidos: 'Paz' }, null)).toBeNull();
    expect(coincideNombre({ nombres: null, apellidos: null }, { nombres: 'ANA', apellidos: 'PAZ' })).toBeNull();
    expect(coincideNacimiento('1999-05-01', null)).toBeNull();
  });

  it('coincide el nacimiento entre ISO y el formato del carnet', () => {
    expect(coincideNacimiento('1999-05-01', '01/05/1999')).toBe(true);
    expect(coincideNacimiento('1999-05-01', '02/05/1999')).toBe(false);
  });
});

describe('señales del teléfono', () => {
  const ping = (captureMode: string, isMocked: boolean, at: string, distancia: string | null, lat = '-17.7', lng = '-63.1') => ({
    captureMode,
    isMocked,
    capturedAt: new Date(at),
    gpsLat: lat,
    gpsLng: lng,
    distanceToDeclaredMeters: distancia,
  });

  it('resume los pings: planos, simulados, extremos, última posición y distancias', () => {
    const resumen = resumenDePings([
      ping('foreground', false, '2026-09-28T10:00:00Z', '100'),
      ping('background', true, '2026-09-28T11:00:00Z', null),
      ping('session_start', false, '2026-09-28T12:00:00Z', '300.4', '-17.8', '-63.2'),
    ]);
    expect(resumen).toEqual({
      total: 3,
      primerPlano: 2,
      segundoPlano: 1,
      simulados: 1,
      primero: '2026-09-28T10:00:00.000Z',
      ultimo: '2026-09-28T12:00:00.000Z',
      ultimaPosicion: { lat: -17.8, lng: -63.2 },
      distanciaMedianaAlDomicilioM: 200,
      distanciaMaximaAlDomicilioM: 300,
    });
  });

  it('sin pings todo es cero o null, nunca inventado', () => {
    expect(resumenDePings([])).toEqual({
      total: 0,
      primerPlano: 0,
      segundoPlano: 0,
      simulados: 0,
      primero: null,
      ultimo: null,
      ultimaPosicion: null,
      distanciaMedianaAlDomicilioM: null,
      distanciaMaximaAlDomicilioM: null,
    });
  });

  it('se queda con la ÚLTIMA decisión de cada permiso', () => {
    const permisos = ultimosPermisos([
      { permissionCode: 'camera', granted: true, respondedAt: new Date('2026-09-28T10:05:00Z'), requestedAt: null },
      { permissionCode: 'location_background', granted: false, respondedAt: null, requestedAt: new Date('2026-09-28T10:04:00Z') },
      { permissionCode: 'camera', granted: false, respondedAt: new Date('2026-09-28T10:00:00Z'), requestedAt: null },
      { permissionCode: 'contacts', granted: null, respondedAt: null, requestedAt: null },
      { permissionCode: null, granted: true, respondedAt: null, requestedAt: null },
    ]);
    expect(permisos).toEqual([
      { permiso: 'camera', decision: 'concedido', fecha: '2026-09-28T10:05:00.000Z' },
      { permiso: 'location_background', decision: 'denegado', fecha: '2026-09-28T10:04:00.000Z' },
      { permiso: 'contacts', decision: 'sin_respuesta', fecha: null },
    ]);
    expect(rastreoSiempre(permisos)).toBe(false);
  });

  it('rastreo «siempre»: concedido, o null si nunca se preguntó', () => {
    expect(rastreoSiempre([{ permiso: 'location_always', decision: 'concedido', fecha: null }])).toBe(true);
    expect(rastreoSiempre([{ permiso: 'ubicacion_segundo_plano', decision: 'sin_respuesta', fecha: null }])).toBeNull();
    expect(rastreoSiempre([{ permiso: 'camera', decision: 'concedido', fecha: null }])).toBeNull();
  });

  it('el consentimiento vigente por finalidad: revocado gana a concedido', () => {
    const creado = new Date('2026-09-01T00:00:00Z');
    expect(
      ultimosConsentimientos([
        {
          purposeCode: 'location_tracking',
          granted: true,
          grantedAt: creado,
          revokedAt: new Date('2026-09-20T00:00:00Z'),
          createdAtValue: creado,
        },
        { purposeCode: 'device_address_book', granted: false, grantedAt: null, revokedAt: null, createdAtValue: creado },
        { purposeCode: 'location_tracking', granted: true, grantedAt: creado, revokedAt: null, createdAtValue: creado },
        { purposeCode: null, granted: true, grantedAt: null, revokedAt: null, createdAtValue: creado },
      ]),
    ).toEqual([
      { finalidad: 'location_tracking', decision: 'revocado', fecha: '2026-09-20T00:00:00.000Z' },
      { finalidad: 'device_address_book', decision: 'denegado', fecha: '2026-09-01T00:00:00.000Z' },
    ]);
  });

  it('segundos por pantalla, de la más larga a la más corta', () => {
    expect(segundosPorPantalla({ identidad: { totalMs: 61_400 }, perfil: { totalMs: 90_000 }, rara: { totalMs: Number.NaN } })).toEqual([
      { pantalla: 'perfil', segundos: 90 },
      { pantalla: 'identidad', segundos: 61 },
      { pantalla: 'rara', segundos: 0 },
    ]);
    expect(segundosPorPantalla(null)).toEqual([]);
  });
});
