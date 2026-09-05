import { describe, expect, it } from '@jest/globals';
import { haversineMeters } from '../../../src/modules/customer-device-signals/application/customer-location-tracking.service.js';
import {
  normalizeEmailForHash,
  normalizePhoneForHash,
} from '../../../src/common/utils/contact/phone-normalization.util.js';

/**
 * La distancia al domicilio declarado, y la normalización que la acompaña.
 *
 * Las dos son cálculos silenciosos: si están mal, no falla nada. La distancia sale un número
 * plausible pero equivocado —y es el número sobre el que el motor decide si alguien está donde
 * dice— y la normalización, si diverge de la de la app, deja el cruce de teléfonos en cero para
 * siempre sin que ningún error lo delate.
 */
describe('haversineMeters', () => {
  it('devuelve cero para el mismo punto', () => {
    const punto = { lat: -17.783327, lng: -63.182140 };
    expect(haversineMeters(punto, punto)).toBeCloseTo(0, 6);
  });

  it('mide un grado de latitud en unos 111 km, a cualquier longitud', () => {
    // Es el caso que distingue el haversine de una aproximación plana: la plana da bien la latitud
    // y se degrada en longitud al alejarse del ecuador.
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
    expect(haversineMeters({ lat: -17, lng: -63 }, { lat: -18, lng: -63 })).toBeCloseTo(111_195, -2);
  });

  it('acorta un grado de longitud a la latitud de Santa Cruz', () => {
    // A -17,8° un grado de longitud son ~106 km, no 111. Una aproximación plana daría 111 y una
    // solicitud a 5 km de casa parecería estar a 10.
    const distancia = haversineMeters({ lat: -17.78, lng: -63.0 }, { lat: -17.78, lng: -62.0 });
    expect(distancia).toBeGreaterThan(105_000);
    expect(distancia).toBeLessThan(107_000);
  });

  it('mide distancias cortas con precisión de metros, que es lo que se usa de verdad', () => {
    // La pregunta real no es «¿está en Bolivia?» sino «¿está en su casa o a tres cuadras?».
    const distancia = haversineMeters({ lat: -17.783327, lng: -63.182140 }, { lat: -17.784327, lng: -63.182140 });
    expect(distancia).toBeCloseTo(111.2, 0);
  });
});

describe('normalizePhoneForHash', () => {
  it('da el mismo resultado escriba como escriba la agenda', () => {
    expect(normalizePhoneForHash('+591 7 650-0122')).toBe('76500122');
    expect(normalizePhoneForHash('591 76500122')).toBe('76500122');
    expect(normalizePhoneForHash('(591) 7650 0122')).toBe('76500122');
    expect(normalizePhoneForHash('76500122 ')).toBe('76500122');
  });

  it('NO le quita el 591 a un número nacional que empieza por 591', () => {
    // `5915678` son siete dígitos: recortarlos dejaría `5678`, que no es un teléfono. Sin la guarda,
    // un fijo que empiece por 591 se convierte en otro número y su hash deja de cruzar con el suyo.
    expect(normalizePhoneForHash('5915678')).toBe('5915678');
    expect(normalizePhoneForHash('59156789')).toBe('59156789');
  });

  it('descarta lo que no puede ser un teléfono', () => {
    expect(normalizePhoneForHash('123')).toBeNull();
    expect(normalizePhoneForHash('')).toBeNull();
    expect(normalizePhoneForHash(null)).toBeNull();
    expect(normalizePhoneForHash('sin numero')).toBeNull();
  });
});

describe('normalizeEmailForHash', () => {
  it('recorta y baja a minúsculas, y nada más', () => {
    expect(normalizeEmailForHash('  Maria@Ferreteria.BO ')).toBe('maria@ferreteria.bo');
  });

  it('descarta lo que no tiene forma de correo', () => {
    // No se tocan alias ni puntos a propósito: `a.b@gmail.com` y `ab@gmail.com` llegan al mismo
    // buzón, pero decidirlo aquí sería aplicar la regla de un proveedor a todos.
    expect(normalizeEmailForHash('no-es-un-correo')).toBeNull();
    expect(normalizeEmailForHash('')).toBeNull();
  });
});
